"""
tests/test_hosted.py
====================
The hosted (public) server of create_app(hosted=Hosted(...)) (docs/ARCHITECTURE.md, section 5): data only from its
data folders and the demo data, a capped run queue, workers without the server's environment, and the application
mounted below a path prefix (/popcorn) of another one. tests/fake_worker.py stands in for the analysis worker.
"""
from __future__ import annotations

import os
import time
import warnings
from pathlib import Path

import pytest
from fastapi import FastAPI

with warnings.catch_warnings():  # Starlette 1.x prefers httpx2 for its TestClient; httpx still works
    warnings.filterwarnings("ignore", message=".*httpx.*")
    from fastapi.testclient import TestClient

from webapp import jobs as jobs_module  # noqa: E402
from webapp.server import Hosted, create_app  # noqa: E402

FAKE = "tests.fake_worker"
PUBLIC = "https://popcorn.example.org"  # any host: a hosted server has no loopback-only gate
TIMEOUT = 60.0


def real(path) -> str:
    return os.path.realpath(path)


@pytest.fixture
def data_dir(tmp_path, tiny_demo):
    """A data folder of the hosted server holding the tiny demo sections, plus a subfolder."""
    d = tmp_path / "data"
    d.mkdir()
    (d / "sub").mkdir()
    return Path(tiny_demo["root"]), d


@pytest.fixture
def hosted(tmp_path, data_dir):
    demo_root, extra = data_dir
    app = create_app(tmp_path / "ws", worker_module=FAKE,
                     hosted=Hosted(data_dirs=(extra, demo_root), max_active_runs=1, home_url="/"))
    with TestClient(app, base_url=PUBLIC) as c:
        yield c


def new_project(client, name: str = "P", **config) -> dict:
    r = client.post("/api/projects", json={"name": name, "config": config})
    assert r.status_code == 200, r.text
    return r.json()


def demo_config(tiny_demo: dict, **extra) -> dict:
    samples = [dict(s) for s in tiny_demo["samples"]]
    return {"data_root": str(tiny_demo["root"]), "samples": samples, "reference_sample": samples[0]["id"], **extra}


def wait_for(client, rid: str, statuses: set[str]) -> dict:
    deadline = time.monotonic() + TIMEOUT
    while True:
        rec = client.get(f"/api/runs/{rid}").json()
        if rec["status"] in statuses:
            return rec
        assert time.monotonic() < deadline, f"run {rid} stayed {rec['status']}"
        time.sleep(0.1)


def test_health_and_defaults(hosted, data_dir):
    extra = data_dir[1]
    health = hosted.get("/api/health").json()
    assert health["ok"] and health["workspace"] is None and health["platform"] is None
    assert health["hosted"]["max_active_runs"] == 1 and health["hosted"]["home_url"] == "/"
    assert [real(d) for d in health["hosted"]["data_dirs"]][1] == real(extra)
    # new projects start in the server's first own data folder, not in the project root
    assert real(hosted.get("/api/defaults").json()["config"]["data_root"]) == real(extra)
    r = hosted.post("/api/projects", json={"name": "fresh"})
    assert real(r.json()["config"]["data_root"]) == real(extra)


def test_data_inside_the_data_folders(hosted, tiny_demo):
    p = new_project(hosted, **demo_config(tiny_demo))
    report = hosted.post(f"/api/projects/{p['id']}/validate").json()
    assert report["ok"], report["errors"]
    sid = tiny_demo["samples"][0]["id"]
    assert hosted.get(f"/api/projects/{p['id']}/samples/{sid}/image").status_code == 200
    r = hosted.post(f"/api/projects/{p['id']}/explore/samples", json={})
    assert r.status_code == 200, r.text


def test_data_outside_the_data_folders(hosted, tiny_demo, tmp_path):
    outside = tmp_path / "elsewhere"
    outside.mkdir()
    ok = new_project(hosted, **demo_config(tiny_demo))
    sid = tiny_demo["samples"][0]["id"]
    escaping = [dict(s) for s in tiny_demo["samples"]]
    escaping[0]["path"] = str(Path("..") / ".." / "anything")
    cases = {
        "data_root": demo_config(tiny_demo, data_root=str(outside)),
        "absolute sample": {**demo_config(tiny_demo), "samples": [{**escaping[0], "path": str(outside)}]},
        "sample with ..": {**demo_config(tiny_demo), "samples": escaping},
        "growth-plate polygons": demo_config(tiny_demo, sensitivity_analyses={
            "compartments": {"growth_plate_masks": {sid: str(outside / "gp.geojson")}}}),
    }
    for what, cfg in cases.items():
        p = new_project(hosted, **cfg)
        r = hosted.post(f"/api/projects/{p['id']}/validate")
        assert r.status_code == 403 and "reads data only from" in r.json()["detail"], what
        assert hosted.post(f"/api/projects/{p['id']}/runs").status_code == 403, what
        # unsaved settings of the data explorer are checked the same way
        r = hosted.post(f"/api/projects/{ok['id']}/explore/samples", json={"config": cfg})
        assert r.status_code == 403, what
    r = hosted.post(f"/api/projects/{ok['id']}/detect-samples", json={"data_root": str(outside)})
    assert r.status_code == 403
    # a region file outside the data folders is not taken
    (outside / "roi.geojson").write_text('{"type": "FeatureCollection", "features": []}', encoding="utf-8")
    p = new_project(hosted, **demo_config(tiny_demo, roi={"use_drawn": True,
                                                          "masks": {sid: str(outside / "roi.geojson")}}))
    r = hosted.post(f"/api/projects/{p['id']}/runs")
    assert r.status_code == 409 and "does not exist in" in r.json()["detail"]


def test_folder_browser(hosted, data_dir, tmp_path):
    demo_root, extra = data_dir
    home = hosted.get("/api/fs/list").json()
    assert real(home["path"]) == real(extra) and home["parent"] is None
    assert {real(r) for r in home["roots"]} >= {real(extra), real(demo_root)}
    assert [e["name"] for e in home["entries"]] == ["sub"]
    sub = hosted.get("/api/fs/list", params={"path": str(extra / "sub")}).json()
    assert real(sub["parent"]) == real(extra)
    for path in (str(tmp_path), str(Path.home()), str(extra / ".." / ".."), "relative", str(tmp_path / "missing")):
        assert hosted.get("/api/fs/list", params={"path": path}).status_code == 403, path
    link = extra / "link"
    try:
        link.symlink_to(tmp_path, target_is_directory=True)
    except (OSError, NotImplementedError):
        return  # Windows without the symlink privilege
    assert hosted.get("/api/fs/list", params={"path": str(link)}).status_code == 403


def test_run_queue_is_capped(hosted):
    p = new_project(hosted, fake_sleep=60)
    first = hosted.post(f"/api/projects/{p['id']}/runs").json()
    r = hosted.post(f"/api/projects/{p['id']}/runs")
    assert r.status_code == 429 and "already queued or running" in r.json()["detail"]
    assert hosted.post(f"/api/runs/{first['id']}/cancel").json()["status"] == "cancelled"
    second = hosted.post(f"/api/projects/{p['id']}/runs", json={"label": "again"})
    assert second.status_code == 200, second.text
    hosted.post(f"/api/runs/{second.json()['id']}/cancel")
    wait_for(hosted, second.json()["id"], {"cancelled", "succeeded"})


def test_run_time_limit(tmp_path):
    app = create_app(tmp_path / "ws", worker_module=FAKE, hosted=Hosted(max_run_minutes=2 / 60))
    with TestClient(app, base_url=PUBLIC) as c:
        p = new_project(c, fake_sleep=60)
        rec = wait_for(c, c.post(f"/api/projects/{p['id']}/runs").json()["id"], {"failed", "succeeded"})
        assert rec["status"] == "failed" and rec["error"].startswith("stopped after")
        assert c.get("/api/health").json()["hosted"]["max_run_minutes"] == 2 / 60


def test_clean_worker_environment(monkeypatch):
    monkeypatch.setenv("MONGODB_URI", "mongodb://user:secret@db")
    monkeypatch.setenv("CLERK_SECRET_KEY", "sk_live_x")
    monkeypatch.setenv("LC_ALL", "C.UTF-8")
    full = jobs_module.worker_env(True)
    clean = jobs_module.worker_env(True, clean=True)
    assert full["MONGODB_URI"] and "MONGODB_URI" not in clean and "CLERK_SECRET_KEY" not in clean
    assert clean["LC_ALL"] == "C.UTF-8" and clean["PATH"] == os.environ["PATH"]
    assert clean["PYTHONPATH"].split(os.pathsep)[0] == str(jobs_module.PROJECT_ROOT)
    assert clean["MPLBACKEND"] == "Agg" and clean["OMP_NUM_THREADS"] == "1"
    # one thread per numerical library on a hosted server, also for a run that is not deterministic
    assert jobs_module.worker_env(False, clean=True)["OMP_NUM_THREADS"] == "1"
    assert jobs_module.worker_env(False, clean=True)["VISIUM_DETERMINISTIC"] == "0"


def test_mounted_below_a_prefix(tmp_path, data_dir):
    site = FastAPI()
    popcorn = create_app(tmp_path / "ws", worker_module=FAKE, hosted=Hosted(data_dirs=(data_dir[1],)))
    site.mount("/popcorn", popcorn)
    with TestClient(site, base_url=PUBLIC) as c:
        page = c.get("/popcorn/")
        assert page.status_code == 200 and page.headers["content-type"].startswith("text/html")
        assert 'src="/popcorn/static/js/main.js"' in page.text and 'href="/popcorn/static/css/app.css"' in page.text
        assert '="/static/' not in page.text
        assert c.get("/popcorn/static/js/core.js").status_code == 200
        assert c.get("/popcorn/api/health").json()["hosted"]["max_active_runs"] == 2
        assert c.get("/popcorn/api/projects").json() == []
