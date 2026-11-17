"""Tissue and cell-type detection (cell_types.py) and POST /api/projects/{id}/detect-tissue.

The synthetic sections give every unit one cell type: its markers (core and extended) are expressed, every other
marker and the background genes only at a low rate, with a depth that varies from unit to unit."""
from __future__ import annotations

import warnings

import numpy as np
import pytest
from scipy import sparse

import cell_types as ct
import pipeline_config as pc

with warnings.catch_warnings():
    warnings.filterwarnings("ignore", message=".*httpx.*")
    from fastapi.testclient import TestClient

from webapp.server import create_app  # noqa: E402

N_BACKGROUND = 1500


def gene_name(token: str, human: bool) -> str:
    """The mouse (first) or human (last, else upper case) name of a library token."""
    alts = token.split("|")
    if not human:
        return alts[0]
    return alts[-1] if len(alts) > 1 else alts[0].upper()


def synthetic(cells: dict[str, list[str]], n: int = 3000, human: bool = False, seed: int = 0):
    """(X, genes): n units, each of one of `cells` (name -> the library cell types whose markers it expresses)."""
    rng = np.random.default_rng(seed)
    genes = []
    for d in ct.CELL_TYPES.values():
        for t in list(d["core"]) + list(d["extended"]):
            g = gene_name(t, human)
            if g not in genes:
                genes.append(g)
    for g in pc.default_config()["ubiquitous"]:   # housekeeping genes, as background
        name = (ct.UBIQUITOUS_ALIASES.get(g, g.upper()) if human else g)
        if name not in genes:
            genes.append(name)
    genes += [f"BG{i}" if human else f"Bg{i}" for i in range(N_BACKGROUND)]
    col = {g: i for i, g in enumerate(genes)}
    kinds = list(cells)
    which = rng.integers(len(kinds), size=n)
    depth = rng.lognormal(0.0, 0.5, size=n)
    lam = np.full((n, len(genes)), 0.02)
    lam[:, -N_BACKGROUND:] = rng.uniform(0.02, 0.6, size=N_BACKGROUND)
    for k, kind in enumerate(kinds):
        rows = which == k
        for t in cells[kind]:
            d = ct.CELL_TYPES[t]
            for tok in list(d["core"]) + list(d["extended"]):
                lam[rows, col[gene_name(tok, human)]] = 3.0
    X = rng.poisson(lam * depth[:, None])
    return sparse.csr_matrix(X), genes


BRAIN = {"exc": ["excitatory_neuron", "neuron"], "inh": ["inhibitory_neuron", "neuron"], "astro": ["astrocyte"],
         "oligo": ["oligodendrocyte"], "endo": ["endothelium"], "micro": ["microglia"]}


def valid(patch: dict) -> tuple[list[str], list[str]]:
    """Errors of a project configuration with the patch applied: as the application runs it, and from the command
    line (every step as configured)."""
    cfg = pc.merge_with_defaults({**patch, "samples": [{"id": "S1", "label": "s", "condition": "control",
                                                         "path": "x"}], "reference_sample": "S1"})
    return pc.validate_config(pc.app_config(cfg))[0], pc.validate_config(cfg)[0]


def test_brain_is_detected_and_gets_brain_signatures():
    X, genes = synthetic(BRAIN)
    r = ct.detect([(X, genes)])
    assert r["species"] == "mouse"
    assert r["tissue"]["name"] == "brain"
    sel = r["selected"]
    for t in ("excitatory_neuron", "inhibitory_neuron", "astrocyte", "oligodendrocyte", "endothelium", "microglia"):
        assert t in sel, (t, sel)
    assert "neuron" not in sel                                   # detection only (the tissue's hallmark)
    for t in ("hepatocyte", "osteoblast", "cardiomyocyte", "t_cell", "proximal_tubule"):
        assert t not in sel and not r["types"][t]["present"], t
    assert sel.index("astrocyte") < sel.index("endothelium")    # the tissue's hallmarks first
    patch = ct.tissue_config(r, genes, pc.default_config())
    assert list(patch["signatures"]) == sel
    assert patch["primary"] == patch["programs"] == sel          # no erythroid here (it would be called only)
    assert patch["roi"] == {"exclude": []}
    assert {c["name"] for c in patch["classes"]} == {s["class"] for s in patch["signatures"].values()}
    assert patch["tissue"]["name"] == "brain" and patch["tissue"]["auto"] is True
    assert patch["signatures"]["oligodendrocyte"]["core"] == ["Mog", "Mobp", "Mag", "Plp1", "Mbp"]
    assert valid(patch) == ([], [])


def test_red_blood_cells_are_called_but_not_assigned_outside_marrow_and_spleen():
    X, genes = synthetic({**BRAIN, "rbc": ["erythroid"]}, seed=6)
    r = ct.detect([(X, genes)])
    assert r["tissue"]["name"] == "brain" and "erythroid" in r["selected"]
    patch = ct.tissue_config(r, genes, pc.default_config())
    assert "erythroid" in patch["primary"] and "erythroid" not in patch["programs"]
    assert valid(patch) == ([], [])
    X, genes = synthetic({"b": ["b_cell"], "t": ["t_cell"], "rbc": ["erythroid"]}, seed=7)
    r = ct.detect([(X, genes)])
    assert r["tissue"]["name"] == "lymphoid"
    assert "erythroid" in ct.tissue_config(r, genes, pc.default_config())["programs"]   # red pulp of the spleen


def test_the_tissues_hallmarks_are_used_when_their_markers_are_expressed():
    types = {n: {"present": False, "expressed": [], "z": 0.0, "level": 0.5} for n in ct.CELL_TYPES}
    for n in ("excitatory_neuron", "oligodendrocyte", "endothelium"):
        types[n].update(present=True, z=20.0)
    types["astrocyte"].update(expressed=["Gfap", "Aqp4", "Slc1a2"])        # expressed, co-expression not shown
    types["hepatocyte"].update(expressed=["Alb", "Apoh"])                    # another tissue's: not used
    sel = ct.select_types(types, ["brain"])
    assert "astrocyte" in sel and "hepatocyte" not in sel
    types["astrocyte"]["expressed"] = ["Gfap"]                                # fewer than two: not used
    assert "astrocyte" not in ct.select_types(types, ["brain"])


def test_human_gene_names_are_used_as_the_data_names_them():
    cells = {"hep": ["hepatocyte"], "kc": ["kupffer_cell", "macrophage"], "endo": ["endothelium"],
             "chol": ["cholangiocyte", "epithelial"]}
    X, genes = synthetic(cells, human=True, seed=1)
    r = ct.detect([(X, genes)])
    assert r["species"] == "human"
    assert r["tissue"]["name"] == "liver"
    assert {"hepatocyte", "kupffer_cell", "endothelium"} <= set(r["selected"])
    patch = ct.tissue_config(r, genes, pc.default_config())
    assert patch["signatures"]["hepatocyte"]["core"] == ["ALB", "APOH", "AHSG", "FGB", "SERPINA1"]
    assert "FTL" in patch["ubiquitous"] and "Ftl1" not in patch["ubiquitous"]   # housekeeping genes in human names
    assert valid(patch) == ([], [])


def test_bone_keeps_the_manuscript_signatures_even_with_more_muscle():
    cells = {"ob": ["osteoblast"], "ocy": ["osteocyte"], "chon": ["chondrocyte"], "gran": ["marrow_granulocyte"],
             "m1": ["skeletal_muscle"], "m2": ["skeletal_muscle"], "m3": ["skeletal_muscle"]}
    X, genes = synthetic(cells, seed=2)
    r = ct.detect([(X, genes)])
    assert r["tissue"]["name"] == "bone"                         # an organ beats an accessory tissue (muscle)
    assert "muscle" in r["tissues_used"]
    defaults = pc.default_config()
    patch = ct.tissue_config(r, genes, defaults)
    assert patch["signatures"] == defaults["signatures"] and patch["roi"]["exclude"] == defaults["roi"]["exclude"]


def test_generic_cell_types_only_give_an_unknown_tissue():
    X, genes = synthetic({"f": ["fibroblast"], "e": ["endothelium"], "m": ["macrophage"]}, seed=3)
    r = ct.detect([(X, genes)])
    assert r["tissue"]["name"] == "unknown"
    assert set(r["selected"]) == {"fibroblast", "endothelium", "macrophage"}
    assert valid(ct.tissue_config(r, genes, pc.default_config())) == ([], [])


def test_noise_has_no_cell_type():
    X, genes = synthetic({"none": []}, seed=4)
    r = ct.detect([(X, genes)])
    assert r["tissue"]["name"] == "unknown" and r["selected"] == []
    assert not any(t["present"] for t in r["types"].values())


def test_sections_are_combined_and_a_gene_panel_without_markers_is_reported():
    X, genes = synthetic(BRAIN, n=1500, seed=5)
    keep = [i for i, g in enumerate(genes) if g not in ("Mog", "Mobp", "Mag", "Plp1", "Mbp")]
    r = ct.detect([(X, genes), (X[:, keep], [genes[i] for i in keep])])
    assert r["tissue"]["name"] == "brain" and "oligodendrocyte" in r["selected"]   # present in the first section
    one = ct.detect_section(X[:, keep], [genes[i] for i in keep])
    assert one["types"]["oligodendrocyte"]["status"].startswith("not measurable")


def test_species_of_gene_names():
    assert ct.species_of(["Actb", "Gapdh", "mt-Co1", "Hba-a1"]) == "mouse"
    assert ct.species_of(["ACTB", "GAPDH", "MT-CO1", "HBA1"]) == "human"
    assert ct.species_of([]) == "unknown"


def test_library_is_consistent():
    for name, d in ct.CELL_TYPES.items():
        assert len(d["core"]) >= 2 and d["class"] in ct.CLASS_COLORS, name
        assert all(t in ct.TISSUES for t in d["tissues"]), name
        assert all(c in ct.CELL_TYPES for c in d.get("competes", [])), name
        assert pc._SIG_RE.match(name), name
    for t in ct.TISSUES.values():
        assert all(h in ct.CELL_TYPES for h in t["hallmarks"])


# ---- the API ---------------------------------------------------------------------------------------------------
@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(tmp_path / "ws", worker_module="tests.fake_worker"),
                    base_url="http://127.0.0.1:8765") as c:
        yield c


def test_detect_tissue_endpoint(client, tiny_demo):
    samples = [dict(s) for s in tiny_demo["samples"]]
    p = client.post("/api/projects", json={"name": "t", "config": {
        "data_root": str(tiny_demo["root"]), "samples": samples, "reference_sample": samples[0]["id"]}}).json()
    r = client.post(f"/api/projects/{p['id']}/detect-tissue", json={})
    assert r.status_code == 200, r.text
    res = r.json()
    assert set(res) >= {"species", "tissue", "tissues", "tissues_used", "cell_types", "config", "problems"}
    assert res["species"] == "mouse" and res["problems"] == []
    assert {"name", "label", "confidence", "score"} <= set(res["tissue"])
    patch = res["config"]
    assert patch["tissue"]["auto"] is True and patch["signatures"]
    # nothing is saved; the changes validate once applied
    assert client.get(f"/api/projects/{p['id']}").json()["config"].get("tissue") is None
    put = client.put(f"/api/projects/{p['id']}", json={"config": {**p["config"], **patch}}).json()
    assert put["validation"]["errors"] == []
    assert put["config"]["tissue"]["name"] == res["tissue"]["name"]   # the record is kept with the project


def test_detect_tissue_needs_a_readable_section(client):
    p = client.post("/api/projects", json={"name": "empty", "config": {"samples": [], "reference_sample": ""}}).json()
    r = client.post(f"/api/projects/{p['id']}/detect-tissue", json={})
    assert r.status_code == 400 and "no section could be read" in r.json()["detail"]
