"""
tests/test_retype.py
====================
New cell types for a finished run (bone_analysis.retype_from_h5ad, POST /api/runs/{rid}/retype): the signatures are
scored again on the run's joint AnnData object, without reading the sections, quality control, normalization or the
Leiden domains again. Gene names match the data whatever their case.
"""
from __future__ import annotations

import copy
import json

import pandas as pd
import pytest

import pipeline_config as pc


def test_gene_names_take_the_case_of_the_data():
    import bone_analysis as ba
    sigs = {"a": {"core": ["ctsk", "ACP5"], "extended": ["ctsk", "Ctsk", "acp5", "Nope"]}}
    changed = ba.match_gene_case(sigs, ["Ctsk", "Acp5", "Mmp9"])
    assert sigs["a"]["core"] == ["Ctsk", "Acp5"]
    assert sigs["a"]["extended"] == ["Ctsk", "Acp5", "Nope"]  # one entry per gene; unknown genes stay as written
    assert changed == {"ctsk": "Ctsk", "ACP5": "Acp5", "acp5": "Acp5"}


@pytest.mark.slow
def test_new_cell_types_are_scored_on_the_joint_object(tiny_joint, tmp_path):
    import bone_analysis as ba
    earlier = tiny_joint["out"]
    h5ad = next(earlier.glob("joint_*um.h5ad"))
    cfg = copy.deepcopy(tiny_joint["cfg"])
    a = tiny_joint["a"]
    # a new cell type from genes of an existing one, written in lower case
    base = cfg["signatures"][cfg["programs"][0]]
    genes = [g for g in base["extended"] if g in a.var_names][:6]
    assert len(genes) >= 3
    cfg["signatures"]["my_type"] = {"label": "my type", "table_label": "my type", "color": "#123456",
                                    "class": cfg["classes"][0]["name"], "canonical": [],
                                    "core": [g.lower() for g in genes[:3]], "extended": [g.lower() for g in genes],
                                    "competes": [], "excluded": {}}
    cfg["primary"] = [*cfg["primary"], "my_type"]
    cfg["programs"] = ["my_type", *cfg["programs"]]
    out = tmp_path / "retyped"
    progress = pc.Progress()
    new = ba.retype_from_h5ad(cfg, out, h5ad, earlier, progress)

    table = pd.read_csv(next(out.glob("per_bin_signature_calls_*um.csv.gz")))
    assert "positive_my_type" in table.columns
    assert "my_type" in set(table["assigned_signature"])
    assert len(table) == a.n_obs                                   # the same bins: no quality control again
    assert (new.obs["leiden"].astype(str).values == a.obs["leiden"].astype(str).values).all()
    assert (out / "leiden_domain_markers.csv").is_file()          # copied from the earlier run
    files = {f["file"] for f in json.loads((out / "manifest.json").read_text(encoding="utf-8"))["files"]}
    assert {"summary.json", "gene_signatures.csv", "leiden_domain_markers.csv"} <= files
    summary = json.loads((out / "summary.json").read_text(encoding="utf-8"))
    assert summary["samples"][0]["n_bins_loaded"] > 0               # from the earlier run's summary
    signatures = pd.read_csv(out / "gene_signatures.csv")
    assert "my type" in set(signatures["signature"])


# ---- the API ---------------------------------------------------------------------------------------------------------
def test_retype_api(tmp_path, tiny_demo):
    import time
    import warnings
    from urllib.parse import quote
    from fastapi import HTTPException
    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", message=".*httpx.*")
        from fastapi.testclient import TestClient
    from webapp.auth import Auth
    from webapp.server import Hosted, create_app

    tokens = {"tok-alice": "user_alice", "tok-bob": "user_bob"}

    def verify(token):
        if token not in tokens:
            raise HTTPException(401, "Invalid session")
        return tokens[token]

    alice = {"Authorization": "Bearer tok-alice", "X-Popcorn-User": quote("Alice")}
    bob = {"Authorization": "Bearer tok-bob", "X-Popcorn-User": quote("Bob")}
    app = create_app(tmp_path / "ws", worker_module="tests.fake_worker",
                     hosted=Hosted(data_dirs=(tiny_demo["root"],), max_active_runs=3, home_url="/"),
                     auth=Auth(verify=verify, publishable_key="pk_test_dGVuZGVyLXNuaXBlLTY3MTkuY2xlcmsuYWNjb3VudHMuZGV2JA"))
    samples = [dict(s) for s in tiny_demo["samples"]]
    config = {"data_root": str(tiny_demo["root"]), "samples": samples, "reference_sample": samples[0]["id"],
              "qc": {"min_genes": 1, "min_counts": 1}}

    def wait(c, rid):
        deadline = time.monotonic() + 60
        while True:
            rec = c.get(f"/api/runs/{rid}", headers=alice).json()
            if rec["status"] not in ("queued", "running"):
                return rec
            assert time.monotonic() < deadline
            time.sleep(0.1)

    with TestClient(app, base_url="https://popcorn.example.org") as c:
        pid = c.post("/api/projects", json={"name": "P", "config": config}, headers=alice).json()["id"]
        names = c.post(f"/api/projects/{pid}/gene-names", json={}, headers=bob).json()   # reading: anybody
        assert len(names["genes"]) > 10 and names["problems"] == []
        assert names["genes"] == sorted(names["genes"], key=lambda g: (g.casefold(), g))

        rid = c.post(f"/api/projects/{pid}/runs", json={}, headers=alice).json()["id"]
        assert wait(c, rid)["status"] == "succeeded"
        types = c.get(f"/api/runs/{rid}/cell-types", headers=bob).json()
        assert types["reusable"] is True and set(types) >= {"signatures", "primary", "programs", "classes"}
        assert len(c.get(f"/api/runs/{rid}/gene-names", headers=bob).json()["genes"]) > 10  # stand-in .h5ad: sections

        sigs = dict(types["signatures"])
        first = next(iter(sigs.values()))
        sigs["new_one"] = {**first, "label": "new one"}
        body = {"signatures": sigs, "primary": [*types["primary"], "new_one"], "programs": ["new_one", *types["programs"]]}
        assert c.post(f"/api/runs/{rid}/retype", json={"signatures": []}, headers=alice).status_code == 400
        r = c.post(f"/api/runs/{rid}/retype", json=body, headers=bob)        # Alice's run: Bob gets his own
        assert r.status_code == 200, r.text
        new = r.json()
        assert new["parent_run"] == rid and new["retyped"] is True and new["owner"]["id"] == "user_bob"
        assert "new_one" in new["config"]["signatures"] and new["config"]["programs"][0] == "new_one"
        source = json.loads((app.state.storage.run_dir(new["id"]) / "retype.json").read_text(encoding="utf-8"))
        assert source["parent"] == rid and source["h5ad"].endswith(".h5ad")
        assert wait(c, new["id"])["status"] == "succeeded"
        assert c.post(f"/api/runs/{new['id']}/retype", json=body, headers=alice).status_code == 200


def test_gene_names_of_an_h5ad_file(tmp_path):
    import anndata as ad
    import numpy as np
    from webapp.server import h5ad_gene_names
    a = ad.AnnData(X=np.zeros((3, 4), dtype=np.float32))
    a.var_names = ["Ctsk", "Acp5", "Mmp9", "Col1a1"]
    a.write_h5ad(tmp_path / "joint_16um.h5ad")
    assert h5ad_gene_names(tmp_path / "joint_16um.h5ad") == ["Ctsk", "Acp5", "Mmp9", "Col1a1"]
