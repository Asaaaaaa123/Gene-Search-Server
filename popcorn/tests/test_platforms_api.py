"""
tests/test_platforms_api.py
===========================
The web application on the output of other instruments than Space Ranger (spatial_readers): the sample detection, the
data check, the data explorer and a run's snapshot, on the demo sections rewritten in the layout of each instrument
(tools/make_platform_data.py); and (slow) whole base runs of the pipeline on an AnnData and a Xenium copy of the demo,
whose calls are those of the Visium HD original.
"""
from __future__ import annotations

import copy
import re
import json
import shutil
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

import pipeline_config as pc
import spatial_readers as sr
from tools import make_platform_data as mp
from webapp.server import create_app

LOCAL = "http://127.0.0.1:8765"
FAKE = "tests.fake_worker"


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(tmp_path / "ws", worker_module=FAKE), base_url=LOCAL) as c:
        yield c


@pytest.fixture(scope="module")
def refs(tiny_demo):
    """Sample id -> the in-tissue 16 um bins of the demo section (make_platform_data.load_reference)."""
    return {s["id"]: mp.load_reference(Path(s["path"]) / "square_016um") for s in tiny_demo["samples"]}


@pytest.fixture(scope="module")
def layouts(tmp_path_factory, tiny_demo, refs):
    """The demo sections written as a Xenium bundle, a MERSCOPE region, CosMx flat files and .h5ad files, and a
    Stereo-seq chip; returns the root and what the writers returned."""
    root = tmp_path_factory.mktemp("platforms")
    ctrl, tum = (s["id"] for s in tiny_demo["samples"])
    made = {"xenium": mp.write_xenium(root / "xenium" / ctrl, refs[ctrl]),
            "merscope": mp.write_merscope(root / "merscope" / "region_0", refs[tum]),
            "cosmx": mp.write_cosmx(root / "cosmx" / tum, refs[tum])}
    (root / "h5ad").mkdir()
    for sid, d in refs.items():
        mp.write_h5ad(root / "h5ad" / f"{sid}.h5ad", d)
    (root / "stereo").mkdir()
    mp.write_stereo_gef(root / "stereo" / "SYNTH01.tissue.gef", mp.stereo_records(n_cells=0))
    return {"root": root, "made": made, "ctrl": ctrl, "tum": tum}


def new_project(client, name: str = "P", /, **config) -> dict:
    r = client.post("/api/projects", json={"name": name, "config": config})
    assert r.status_code == 200, r.text
    return r.json()


def explore(client, pid: str, sid: str, what: str, **body):
    return client.post(f"/api/projects/{pid}/explore/{sid}/{what}", json=body)


def test_detect_samples_of_every_instrument(client, layouts):
    p = new_project(client)
    r = client.post(f"/api/projects/{p['id']}/detect-samples", json={"data_root": str(layouts["root"])})
    assert r.status_code == 200, r.text
    got = [(c["path"], c["platform"], c["unit"], c["suggested_id"]) for c in r.json()["candidates"]]
    ctrl, tum = layouts["ctrl"], layouts["tum"]
    # ids in the order the folders are found (shallower first, then by name): the .h5ad files take the plain ids,
    # the same names from other instruments say which; a folder that holds one GEF file is a Stereo-seq sample
    assert got == [(f"cosmx/{tum}", "cosmx", "cell", f"{tum}-cosmx"),
                   (f"h5ad/{ctrl}.h5ad", "h5ad", "spot", ctrl),
                   (f"h5ad/{tum}.h5ad", "h5ad", "spot", tum),
                   ("merscope/region_0", "merscope", "cell", "region_0"),
                   ("stereo", "stereo_seq", "bin", "stereo"),
                   (f"xenium/{ctrl}", "xenium", "cell", f"{ctrl}-xenium")]
    labels = {c["platform"]: c["platform_label"] for c in r.json()["candidates"]}
    assert labels == {p: sr.PLATFORMS[p]["label"] for p in labels}
    # the folder browser opens a folder that holds another instrument's files
    entries = client.get("/api/fs/list", params={"path": str(layouts["root"] / "xenium")})
    if entries.status_code == 200:  # a hosted server has no folder browser
        listed = {e["name"]: e for e in entries.json().get("entries", [])}
        assert listed[layouts["ctrl"]]["looks_like_spaceranger"] is True


def test_data_check_of_other_instruments(client, layouts, refs):
    root, ctrl, tum = layouts["root"], layouts["ctrl"], layouts["tum"]
    samples = [{"id": "X", "path": f"xenium/{ctrl}", "condition": "control"},
               {"id": "M", "path": "merscope/region_0", "condition": "tumor-bearing"},
               {"id": "C", "path": f"cosmx/{tum}", "condition": "tumor-bearing"},
               {"id": "H", "path": f"h5ad/{ctrl}.h5ad", "condition": "control"}]
    p = new_project(client, data_root=str(root), samples=samples, reference_sample="X")
    r = client.post(f"/api/projects/{p['id']}/validate").json()
    assert r["errors"] == [], r["errors"]
    by_id = {s["id"]: s for s in r["samples"]}
    assert {k: (s["platform"], s["unit"]) for k, s in by_id.items()} == {
        "X": ("xenium", "cell"), "M": ("merscope", "cell"), "C": ("cosmx", "cell"), "H": ("h5ad", "spot")}
    assert by_id["X"]["n_bins"] == refs[ctrl]["X"].shape[0] and "10x Xenium" in by_id["X"]["message"]
    assert by_id["M"]["n_bins"] == refs[tum]["X"].shape[0]
    assert by_id["C"]["microns_per_pixel"] == pytest.approx(sr.COSMX_UM_PER_PX)
    assert by_id["X"]["microns_per_pixel"] == 1.0 and by_id["X"]["has_hires_image"] is False
    assert all("no H&E image" in " ".join(s["notes"]) for s in r["samples"])
    assert r["genes"]["n_features"] == len(refs[ctrl]["genes"])
    # a path that holds nothing known, and a platform that does not fit the files
    cfg = p["config"]
    cfg["samples"][0]["path"] = "stereo"   # a folder that holds a GEF file is a Stereo-seq sample...
    cfg["samples"][1]["platform"] = "xenium"   # ...but a MERSCOPE region is not a Xenium bundle
    r = client.post(f"/api/projects/{p['id']}/validate", json={"config": cfg}).json()
    assert r["samples"][0]["platform"] == "stereo_seq" and r["samples"][0]["unit"] == "bin"
    assert any(e.startswith("sample M:") and "cell_feature_matrix.h5" in e for e in r["errors"]), r["errors"]


def test_explore_a_xenium_section(client, layouts, refs):
    root, ctrl = layouts["root"], layouts["ctrl"]
    d, missing = refs[ctrl], layouts["made"]["xenium"]["missing"]
    p = new_project(client, data_root=str(root), samples=[{"id": "X", "path": f"xenium/{ctrl}", "label": "Xenium"}],
                    reference_sample="X")
    pid = p["id"]
    entry = client.post(f"/api/projects/{pid}/explore/samples").json()["samples"][0]
    assert entry["ok"] and entry["platform"] == "xenium" and entry["unit"] == "cell" and entry["has_image"] is False
    assert entry["n_bins"] == d["X"].shape[0] and f"{d['X'].shape[0]:,} cells (10x Xenium)" == entry["message"]

    b = explore(client, pid, "X", "bins")
    assert b.status_code == 200, b.text
    b = b.json()
    ids = layouts["made"]["xenium"]["ids"]
    keep = [i for i, c in enumerate(ids) if c != missing]
    rows = {c: i for i, c in enumerate(b["barcodes"])}
    order = [rows[ids[i]] for i in keep]
    assert b["n"] == len(keep) == len(b["x"]) and sorted(order) == list(range(b["n"]))
    assert np.allclose(np.asarray(b["x"])[order], d["x_um"][keep], atol=0.006)
    assert np.allclose(np.asarray(b["y"])[order], d["y_um"][keep], atol=0.006)
    totals = np.asarray(d["X"][keep].sum(axis=1)).ravel()
    assert np.array_equal(np.asarray(b["fields"]["total_umi"]["values"])[order], totals)
    s = b["summary"]
    assert s["platform"] == "xenium" and s["unit"] == "cell" and s["microns_per_pixel"] == 1.0
    assert s["n_bins"] == len(keep) and s["n_features"] == len(d["genes"]) and b["image"] is None
    assert any("have no centroid" in n for n in b["notes"]) and any("no H&E image" in n for n in b["notes"])

    genes = explore(client, pid, "X", "genes").json()
    assert genes["n_bins"] == len(keep) and genes["n_features"] == len(d["genes"])
    gene = d["genes"][int(np.argmax(np.asarray(d["X"].sum(axis=0)).ravel()))]
    m = explore(client, pid, "X", "gene", genes=[gene]).json()
    col = d["genes"].index(gene)
    assert m["total"] == int(d["X"][keep][:, col].sum()) and m["genes_used"] == [gene]

    # no H&E image: the region editor's preview and the image metadata say so
    r = client.get(f"/api/projects/{pid}/samples/X/bins-preview")
    assert r.status_code == 404 and "10x Xenium" in r.json()["detail"]
    assert client.get(f"/api/projects/{pid}/samples/X/image-meta").status_code == 404

    # the sample's own micrometres per unit of the positions
    cfg = p["config"]
    cfg["samples"][0]["microns_per_pixel"] = 2.0
    b2 = explore(client, pid, "X", "bins", config=cfg).json()
    assert b2["summary"]["microns_per_pixel"] == 2.0
    assert np.allclose(np.asarray(b2["x"]), 2.0 * np.asarray(b["x"]), atol=0.02)


def test_explore_cosmx_merscope_h5ad_and_stereo(client, layouts, refs):
    root, ctrl, tum = layouts["root"], layouts["ctrl"], layouts["tum"]
    samples = [{"id": "M", "path": "merscope/region_0"}, {"id": "C", "path": f"cosmx/{tum}"},
               {"id": "H", "path": f"h5ad/{ctrl}.h5ad"}, {"id": "S", "path": "stereo/SYNTH01.tissue.gef"}]
    p = new_project(client, data_root=str(root), samples=samples, reference_sample="M", bin_size="016um")
    listed = {s["id"]: s for s in client.post(f"/api/projects/{p['id']}/explore/samples").json()["samples"]}
    assert all(s["ok"] for s in listed.values()), listed
    assert listed["S"]["unit"] == "bin" and listed["S"]["platform"] == "stereo_seq"
    for sid, d, unit in (("M", refs[tum], "cell"), ("C", refs[tum], "cell"), ("H", refs[ctrl], "spot")):
        b = explore(client, p["id"], sid, "bins").json()
        assert b["n"] == d["X"].shape[0] and b["summary"]["unit"] == unit, sid
        assert sorted(b["fields"]["total_umi"]["values"]) == sorted(np.asarray(d["X"].sum(axis=1)).ravel().tolist())
        # positions in micrometres whatever the instrument's units (CosMx: pixels of 0.12028 um)
        assert min(b["x"]) == pytest.approx(d["x_um"].min(), abs=0.01), sid
        assert max(b["y"]) == pytest.approx(d["y_um"].max(), abs=0.01), sid
    s = explore(client, p["id"], "S", "bins").json()
    r = mp.stereo_records(n_cells=0)
    assert s["summary"]["unit"] == "bin" and s["summary"]["total_umi"] == int(r["count"].sum())
    # 16 um bins of a 0.5 um pitch: 32 DNBs a side
    xs = np.unique(np.asarray(s["x"]))
    assert np.allclose(np.diff(xs) % 16.0, 0.0, atol=1e-6) or np.allclose(np.diff(xs) % 16.0, 16.0, atol=1e-6)


def test_a_run_records_the_platform_of_each_sample(client, layouts, tiny_demo):
    """The run's snapshot names the platform each sample was read as; its Loupe Browser export refuses sections
    of other instruments."""
    root, ctrl = layouts["root"], layouts["ctrl"]
    samples = [{"id": ctrl, "path": f"xenium/{ctrl}", "condition": "control"}]
    p = new_project(client, data_root=str(root), samples=samples, reference_sample=ctrl)
    run = client.post(f"/api/projects/{p['id']}/runs", json={}).json()
    assert run["config"]["samples"][0]["platform"] == "xenium"
    assert "platform" not in client.get(f"/api/projects/{p['id']}").json()["config"]["samples"][0]
    import time
    deadline = time.monotonic() + 60
    while client.get(f"/api/runs/{run['id']}").json()["status"] in ("queued", "running"):
        assert time.monotonic() < deadline
        time.sleep(0.05)
    assert client.get(f"/api/runs/{run['id']}").json()["status"] == "succeeded"
    r = client.get(f"/api/runs/{run['id']}/export/loupe")
    assert r.status_code in (409, 422) and "Visium HD" in r.json()["detail"], r.text
    defaults = client.get("/api/defaults").json()
    assert [x["id"] for x in defaults["platforms"]] == list(pc.PLATFORM_IDS)
    assert {x["id"]: x["qc"] for x in defaults["platforms"]} == pc.QC_PRESETS


def test_too_many_units_message_fits_the_instrument():
    from webapp import server
    hd = str(server.too_many_bins(Path("m.h5"), 2_000_000))
    assert "2,000,000 bins" in hd and "008um" in hd
    cells = str(server.too_many_bins(Path("m.h5"), 2_000_000, "xenium"))
    assert "2,000,000 cells" in cells and "008um" not in cells and "cells per section" in cells


# ============================================================================
# WHOLE BASE RUNS ON OTHER LAYOUTS OF THE DEMO (slow)
# ============================================================================

def _base_run(cfg: dict, out: Path) -> pd.DataFrame:
    import bone_analysis as ba
    progress = pc.Progress()
    ba.run_analysis_from_config(pc.app_config(cfg), out, progress)
    progress.done()
    return pd.read_csv(out / "per_bin_signature_calls_16um.csv.gz")


@pytest.mark.slow
def test_base_run_on_h5ad_and_xenium_copies_gives_the_visium_hd_calls(tmp_path, tiny_demo, layouts, refs):
    """The demo run three ways: the Visium HD original; the same bins as .h5ad files (the same counts at the same
    micrometres: the same calls, bin by bin); and one run of two instruments, the control section as a Xenium bundle
    (one cell without a centroid, other ids) next to the tumor-bearing section as an .h5ad file."""
    samples = [dict(s) for s in tiny_demo["samples"]]
    ctrl, tum = (s["id"] for s in samples)
    base = pc.merge_with_defaults({"data_root": str(tiny_demo["root"]), "samples": samples,
                                   "reference_sample": ctrl})
    original = _base_run(copy.deepcopy(base), tmp_path / "hd").set_index(["sample_id", "barcode"])
    calls = [c for c in original.columns if c in ("in_region_of_interest", "assigned_signature", "tissue_class",
                                                  "leiden_domain") or c.startswith("positive_")]
    assert {"assigned_signature", "tissue_class", "leiden_domain"} <= set(calls)

    h5 = copy.deepcopy(base)
    h5["data_root"] = str(layouts["root"])
    for s in h5["samples"]:
        s.update(path=f"h5ad/{s['id']}.h5ad", microns_per_pixel=None)
    other = _base_run(h5, tmp_path / "h5ad").set_index(["sample_id", "barcode"])
    assert sorted(other.index) == sorted(original.index)
    other = other.reindex(original.index)
    assert np.allclose(other[["x_um", "y_um"]].to_numpy(float), original[["x_um", "y_um"]].to_numpy(float), atol=0.01)
    assert (other["total_umi"] == original["total_umi"]).all()
    # The pooled calls (and the assignment, which uses them) sum each bin with its 8 nearest bins. On the demo's
    # perfectly regular grid the 8th to 10th nearest are often exactly as far, and pixel coordinates (the original)
    # and micrometres (the copy) break those ties differently: a few bins pool other neighbours. Every other call is
    # the same, bin by bin.
    pooled = {"assigned_signature", "tissue_class"} | {c for c in calls if "pooled" in c}
    for c in calls:
        same = (other[c].astype(str) == original[c].astype(str)).mean()
        assert same >= (0.97 if c in pooled else 1.0), (c, same)

    mixed = copy.deepcopy(h5)
    mixed["samples"][0].update(path=f"xenium/{ctrl}")
    got = _base_run(mixed, tmp_path / "mixed")
    # a Xenium cell id <-> the Visium HD bin it was written from (make_platform_data.write_xenium)
    made = layouts["made"]["xenium"]
    to_bin = {f"{cell}-{ctrl}": f"{bc}-{ctrl}" for cell, bc in zip(made["ids"], refs[ctrl]["ids"])}
    x = got[got["sample_id"] == ctrl].assign(barcode=lambda d: d["barcode"].map(to_bin)).set_index(
        ["sample_id", "barcode"])
    assert x.index.get_level_values(1).notna().all()
    hd = original.loc[[ctrl]]
    # the cell without a centroid is left out; the bins that fail quality control too, as in the original
    assert f"{made['missing']}-{ctrl}" not in set(got["barcode"])
    assert set(x.index) <= set(hd.index) and len(hd) - len(x) <= 1
    hd = hd.reindex(x.index)
    assert np.allclose(x[["x_um", "y_um"]].to_numpy(float), hd[["x_um", "y_um"]].to_numpy(float), atol=0.01)
    assert (x["total_umi"] == hd["total_umi"]).all()
    same = (x["assigned_signature"].astype(str) == hd["assigned_signature"].astype(str)).mean()
    assert same >= 0.95, same          # one cell fewer barely moves the normalization and the gene-set scores
    run_cfg = json.loads((tmp_path / "mixed" / "config.json").read_text(encoding="utf-8")) \
        if (tmp_path / "mixed" / "config.json").is_file() else None
    if run_cfg is not None:
        assert [s.get("path") for s in run_cfg["samples"]] == [f"xenium/{ctrl}", f"h5ad/{tum}.h5ad"]


def test_tool_texts_in_the_unit_of_the_run():
    """The Analysis tab of a run of spots or cells: the tools' forms, notes and column titles say spot or cell; the
    "expression bin" of score_genes and the settings' keys stay as they are."""
    from webapp import analysis as an
    assert an.unit_text("Bins detecting it", "cell") == "Cells detecting it"
    assert an.unit_text("A bin in both groups is its own nearest B bin", "spot") == \
        "A spot in both groups is its own nearest B spot"
    assert an.unit_text("Control genes per expression bin", "cell") == "Control genes per expression bin"
    assert an.unit_text("min_bins", "cell") == "min_bins" and an.unit_text("bins", "bin") == "bins"
    for tool in an.TOOLS:
        hd, cells = tool.describe(), tool.describe("cell")
        assert [q["key"] for q in hd["params"]] == [q["key"] for q in cells["params"]]
        assert [q.get("default") for q in hd["params"]] == [q.get("default") for q in cells["params"]]
        text = json.dumps(cells).replace("expression bin", "")
        assert not re.search(r"\bbins?\b", text, re.IGNORECASE), (tool.id, re.findall(r".{20}\bbins?\b.{10}", text))
    r = an.in_units({"notes": [an.INDEPENDENCE_NOTE], "table": {"columns": [{"key": "n", "label": "Bins"}]},
                     "sections": [{"status": "fewer than four bins: skipped"}]}, "cell")
    assert r["notes"][0].startswith("P values treat every cell as an independent observation")
    assert r["table"]["columns"][0]["label"] == "Cells" and r["sections"][0]["status"] == "fewer than four cells: skipped"
