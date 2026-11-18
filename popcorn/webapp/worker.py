"""
webapp/worker.py
================
`python -m webapp.worker <run_dir>`: one analysis run of Popcorn, started by webapp.jobs in its own process.

Reads <run_dir>/config.json, reports progress as pipeline_config.Progress events (@@EVENT lines on stdout), runs
bone_analysis.run_analysis_from_config into <run_dir>/results (bone_analysis.retype_from_h5ad with a retype.json: new
cell types for an earlier run) and then, when steps.figures is on,
bone_figures.make_figures. Exit code 0 after a "done" event; 1 after an "error" event; 2 for a wrong command line.
"""
from __future__ import annotations

import json
import os
import sys
import traceback
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from pipeline_config import Progress, merge_with_defaults  # noqa: E402

USAGE = "usage: python -m webapp.worker <run_dir>"
# in a run folder: the run gives new cell types to an earlier run ({"parent", "h5ad", "results"}) instead of analysing
# the sections from the start
RETYPE_FILE = "retype.json"


def run(run_dir: Path) -> int:
    progress = Progress(events=True)
    try:
        cfg = merge_with_defaults(json.loads((run_dir / "config.json").read_text(encoding="utf-8")))
        import bone_analysis as ba
        import bone_figures as bf

        figures = bool(cfg["steps"]["figures"])
        results = run_dir / "results"
        retype = run_dir / RETYPE_FILE
        if retype.is_file():  # new cell types on the joint object of an earlier run (bone_analysis.retype_from_h5ad)
            source = json.loads(retype.read_text(encoding="utf-8"))
            progress.plan(ba.retype_planned_steps(cfg) + (bf.planned_steps(cfg) if figures else []))
            ba.retype_from_h5ad(cfg, results, Path(source["h5ad"]), Path(source["results"]), progress)
        else:
            progress.plan(ba.planned_steps(cfg) + (bf.planned_steps(cfg) if figures else []))
            ba.run_analysis_from_config(cfg, results, progress)
        if figures:
            bf.make_figures(results, cfg, progress)
        progress.done()
        return 0
    except Exception as exc:
        tb = traceback.format_exc()
        # the event line is not logged by the job runner; the traceback must still be in log.txt
        print(tb, file=sys.stderr, flush=True)
        progress.error(str(exc) or type(exc).__name__, tb)
        return 1


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    if len(args) != 1 or args[0] in ("-h", "--help"):
        print(USAGE, file=sys.stderr)
        return 2
    run_dir = Path(args[0]).expanduser().resolve()
    if not run_dir.is_dir():
        print(f"{USAGE}\nnot a folder: {run_dir}", file=sys.stderr)
        return 2
    # relative data paths in the configuration mean the same here as in the server: relative to the project root
    os.chdir(PROJECT_ROOT)
    # output that the console encoding cannot represent must not end the analysis
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(errors="backslashreplace")
    return run(run_dir)


if __name__ == "__main__":
    sys.exit(main())
