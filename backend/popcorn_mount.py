"""
Popcorn (Bone Spatial Studio, ../popcorn) served by this API at /popcorn.

The Visium HD bone-lesion application runs here as its hosted (public) variant: it reads data only from its data
folders and the synthetic demo, keeps at most a few analyses queued, and starts each analysis in a worker subprocess
without this server's secrets (popcorn/README.md, "Online"). The front end reaches it through the Next.js rewrite of
/popcorn.

Environment:
  POPCORN_ENABLED          0 turns it off (default 1)
  POPCORN_DIR              the Popcorn project folder (default: ./popcorn in the image, ../popcorn in the repository)
  POPCORN_WORKSPACE        projects, runs and demo data (default: <user_data>/popcorn)
  POPCORN_DATA_DIRS        folders with Space Ranger outputs, separated by os.pathsep (default: <workspace>/data)
  POPCORN_MAX_ACTIVE_RUNS  analyses queued or running at once (default 2)
  POPCORN_MAX_RUN_MINUTES  an analysis running longer is stopped (default 30)
  POPCORN_MAX_UPLOAD_MB    data a project may upload (default 3072)
  POPCORN_MIN_FREE_MB      disk space uploads always leave free (default 4096)
  POPCORN_HOME_URL         the site the Popcorn sidebar links back to (default /)

Analyses are queued in this process, so the API must run as one process (WORKERS=1, the image's default): a second
uvicorn worker finds the workspace locked and answers 503 under /popcorn.
"""
from __future__ import annotations

import asyncio
import contextlib
import html
import logging
import os
import sys
from pathlib import Path

from fastapi import FastAPI
from starlette.responses import HTMLResponse, JSONResponse

log = logging.getLogger("popcorn")

MOUNT_PATH = "/popcorn"
HERE = Path(__file__).resolve().parent


def _popcorn_dir() -> Path | None:
    given = os.environ.get("POPCORN_DIR", "").strip()
    candidates = [Path(given)] if given else [HERE / "popcorn", HERE.parent / "popcorn"]
    return next((c.resolve() for c in candidates if (c / "webapp" / "server.py").is_file()), None)


def _lock_workspace(workspace: Path):
    """An open file holding an exclusive lock on the workspace for this process, or None when another process (a
    second uvicorn worker) holds it."""
    fh = open(workspace / ".server.lock", "a+b")
    try:
        if os.name == "nt":
            import msvcrt
            fh.seek(0)
            msvcrt.locking(fh.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        fh.close()
        return None
    return fh


def _unavailable(reason: str):
    """ASGI application answering every request under /popcorn with 503 and `reason`."""
    page = ("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>Popcorn</title></head>"
            "<body style=\"font-family:system-ui;padding:32px\"><h1>Popcorn is not available</h1>"
            f"<p>{html.escape(reason)}</p><p><a href=\"/\">Back</a></p></body></html>")

    async def app(scope, receive, send):
        if scope["type"] != "http":
            return
        if scope["path"].rstrip("/").endswith("/api") or "/api/" in scope["path"]:
            response = JSONResponse({"detail": f"Popcorn is not available: {reason}"}, status_code=503)
        else:
            response = HTMLResponse(page, status_code=503)
        await response(scope, receive, send)

    return app


def mount_popcorn(app: FastAPI, default_workspace: str) -> None:
    """Mount Popcorn at /popcorn of `app` and run its job runner with `app`'s lifespan. Never raises: when Popcorn
    cannot start, /popcorn answers 503 with the reason and the rest of the API is unaffected."""
    if os.environ.get("POPCORN_ENABLED", "1").strip() == "0":
        app.mount(MOUNT_PATH, _unavailable("it is switched off on this server (POPCORN_ENABLED=0)."))
        return
    try:
        sub = _create(default_workspace)
    except Exception as exc:  # a missing package or folder must not take the rest of the API down
        log.exception("Popcorn cannot start")
        sub = _unavailable(f"it cannot start on this server ({type(exc).__name__}: {exc}).")
    app.mount(MOUNT_PATH, sub)
    jobs = getattr(getattr(sub, "state", None), "jobs", None)
    if jobs is None:
        return

    # a mounted application's own lifespan does not run: start and stop Popcorn's job runner with the API's
    outer = app.router.lifespan_context

    @contextlib.asynccontextmanager
    async def lifespan(a):
        async with outer(a) as state:
            jobs.start()
            try:
                yield state
            finally:
                await asyncio.to_thread(jobs.stop)

    app.router.lifespan_context = lifespan


def _create(default_workspace: str):
    root = _popcorn_dir()
    if root is None:
        raise FileNotFoundError("the popcorn folder (POPCORN_DIR) was not found")
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    from webapp.jobs import kill_workers_with_server
    from webapp.server import Hosted, create_app

    workspace = Path(os.environ.get("POPCORN_WORKSPACE", "").strip() or default_workspace).expanduser()
    workspace.mkdir(parents=True, exist_ok=True)
    lock = _lock_workspace(workspace)
    if lock is None:
        return _unavailable("another process of this server already runs it; start the API with one worker "
                            "(WORKERS=1).")
    given = [d for d in os.environ.get("POPCORN_DATA_DIRS", "").split(os.pathsep) if d.strip()]
    data_dirs = tuple(Path(d.strip()).expanduser() for d in given) or (workspace / "data",)
    for d in data_dirs:
        d.mkdir(parents=True, exist_ok=True)
    hosted = Hosted(data_dirs=data_dirs,
                    max_active_runs=max(1, int(os.environ.get("POPCORN_MAX_ACTIVE_RUNS", "2"))),
                    max_run_minutes=max(1.0, float(os.environ.get("POPCORN_MAX_RUN_MINUTES", "30"))),
                    max_upload_mb=max(1, int(os.environ.get("POPCORN_MAX_UPLOAD_MB", "3072"))),
                    min_free_mb=max(0, int(os.environ.get("POPCORN_MIN_FREE_MB", "4096"))),
                    home_url=os.environ.get("POPCORN_HOME_URL", "/").strip() or None,
                    home_label="Back to Geno Intelligence")
    kill_workers_with_server()
    sub = create_app(workspace, hosted=hosted)
    sub.state.workspace_lock = lock  # held for the life of the process
    log.info("Popcorn at %s: workspace %s, data %s", MOUNT_PATH, workspace, ", ".join(map(str, data_dirs)))
    return sub
