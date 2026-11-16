"""
tests/test_analysis_api.py
==========================
The Analysis tab through the API (/api/runs/{rid}/analysis/context, /analyses, /regions, /api/analysis/templates) on a
run that holds the results of the real analysis of the tiny demo sections. The tools read the per-bin table and the raw
counts as the server serves them; these tests prove with the pipeline's own tables and its AnnData object that they
give the pipeline's numbers: the positivity and composition tables, the distance null of Figure 4i, the proximity
tables, Moran's I, the normalized expression and scanpy's Wilcoxon scores.
"""
from __future__ import annotations

import shutil
import time

import numpy as np
import pandas as pd
import pytest
from scipy import sparse

import pipeline_config as pc
from tests.test_api import FAKE, LOCAL, TestClient, start_run, wait_for
from webapp import analysis as an
from webapp import server
from webapp.server import create_app

SECTIONS = ("CTRL-1", "TUM-1")


# ============================================================================
# HELPERS
# ============================================================================

def new_project(client, name: str, /, **config) -> dict:
    """A project with a whole configuration (which has a name of its own)."""
    r = client.post("/api/projects", json={"name": name, "config": config})
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def analysed(tmp_path_factory, tiny_demo, tiny_joint):
    """A succeeded run whose results are those of the real analysis of the tiny demo (the tiny_joint fixture, copied
    over the fake worker's files): {"c": client, "rid", "a": joint AnnData, "cfg", "bins": per-bin table, "out":
    results folder, "app"}."""
    app = create_app(tmp_path_factory.mktemp("ws"), worker_module=FAKE)
    with TestClient(app, base_url=LOCAL) as c:
        cfg = tiny_joint["cfg"]
        p = new_project(c, "Analysis", **cfg)
        rid = start_run(c, p["id"])["id"]
        assert wait_for(c, rid, {"succeeded", "failed"})["status"] == "succeeded"
        results = app.state.storage.results_dir(rid)
        shutil.rmtree(results)
        shutil.copytree(tiny_joint["out"], results)
        bins = pd.read_csv(results / "per_bin_signature_calls_16um.csv.gz")
        yield {"c": c, "rid": rid, "a": tiny_joint["a"], "cfg": cfg, "bins": bins, "out": results, "app": app,
               "pid": p["id"]}


def analyse(env, tool: str, params: dict, expect: int = 200, **more):
    r = env["c"].post(f"/api/runs/{env['rid']}/analyses", json={"tool": tool, "params": params, **more})
    assert r.status_code == expect, r.text
    if expect != 200:
        return r.json()
    return finished(env, r.json())


def finished(env, card: dict, timeout: float = 120.0) -> dict:
    """The card once its analysis has ended (GET it until then)."""
    deadline = time.monotonic() + timeout
    while card["status"] == "running":
        assert time.monotonic() < deadline, f"analysis {card['id']} still running"
        time.sleep(0.05)
        card = env["c"].get(f"/api/runs/{env['rid']}/analyses/{card['id']}").json()
    return card


def done(env, tool: str, params: dict, **more) -> dict:
    card = analyse(env, tool, params, **more)
    assert card["status"] == "done", card["error"]
    return card["result"]


def frame(result: dict) -> pd.DataFrame:
    return pd.DataFrame(result["table"]["data"])


def slug(cfg: dict, name: str) -> str:
    return pc.signature_label(cfg, name).replace(" ", "_")


def labels(cfg: dict) -> dict:
    return {s["id"]: s.get("label") or s["id"] for s in cfg["samples"]}


# ============================================================================
# WHAT THE FORMS OFFER
# ============================================================================

def test_context(analysed):
    env = analysed
    r = env["c"].get(f"/api/runs/{env['rid']}/analysis/context")
    assert r.status_code == 200, r.text
    ctx = r.json()
    bins, cfg = env["bins"], env["cfg"]
    assert ctx["unit"] == "bin" and ctx["n"] == len(bins) and ctx["target_sum"] == cfg["clustering"]["target_sum"]
    assert [(s["id"], s["label"], s["n"]) for s in ctx["samples"]] == [
        (sid, labels(cfg)[sid], int((bins["sample_id"] == sid).sum())) for sid in SECTIONS]
    assert ctx["samples"][0]["color"] == cfg["samples"][0]["color"] and ctx["samples"][1]["condition"] == "tumor"
    fields = {f["key"]: f for f in ctx["fields"]}
    assert list(fields)[:5] == ["sample", "in_region_of_interest", "assigned_signature", "tissue_class",
                                "leiden_domain"]
    assert fields["sample"]["label"] == "Section" and fields["assigned_signature"]["label"] == "Cell type"
    cells = {v["value"]: v for v in fields["assigned_signature"]["values"]}
    counts = bins["assigned_signature"].value_counts()
    assert {k: v["n"] for k, v in cells.items()} == counts.to_dict()
    assert cells[slug(cfg, "osteoclast")]["color"] == cfg["signatures"]["osteoclast"]["color"]
    roi = fields["in_region_of_interest"]
    assert roi["type"] == "bool" and roi["n_true"] == int(bins["in_region_of_interest"].sum())
    assert roi["n_true"] + roi["n_false"] == len(bins) and roi["text"] == ["inside", "outside"]
    call = fields[f"positive_{slug(cfg, 'osteoclast')}"]
    assert call["label"] == "osteoclast" and call["text"] == ["positive", "negative"]
    assert call["color"] == cfg["signatures"]["osteoclast"]["color"]
    assert "total_umi" not in fields and "x_um" not in fields                # numbers are not groups
    assert [t["id"] for t in ctx["tools"]] == [t.id for t in an.TOOLS]
    assert ctx["expression"] == {"available": True, "reason": ""} and ctx["regions"] == []
    files = {t["file"]: t["title"] for t in ctx["tables"]}
    assert files["Figure4g_6a_positivity_native_depth_roi.csv"] == "Positivity, native depth (ROI)"
    assert "per_bin_signature_calls_16um.csv.gz" in files and "joint_16um.h5ad" not in files
    assert ctx["limits"]["genes"] == an.MAX_GENES
    assert env["c"].get("/api/runs/r-20200101-000000-abcd/analysis/context").status_code == 404


# ============================================================================
# THE TOOLS GIVE THE PIPELINE'S NUMBERS
# ============================================================================

def test_composition_is_the_positivity_table(analysed):
    """Figures 4g and 6a: positive bins per signature and section inside the region of interest, with their Wilson
    intervals, as Figure4g_6a_positivity_native_depth_roi.csv."""
    env = analysed
    cfg = env["cfg"]
    want = pd.read_csv(env["out"] / "Figure4g_6a_positivity_native_depth_roi.csv")
    names = list(dict.fromkeys(want["signature"]))
    res = done(env, "composition", {"count": {"calls": [f"positive_{slug(cfg, n)}" for n in names]},
                                    "scope": {"roi": True}})
    assert [g["label"] for g in res["groups"]] == [labels(cfg)[s] for s in SECTIONS] and not res["exclusive"]
    assert [s["label"] for s in res["series"]] == [slug(cfg, n).replace("_", " ") for n in names]
    for k, sid in enumerate(SECTIONS):
        rows = want[want["sample"] == sid].set_index("signature").loc[names]
        cell = res["cells"][k]
        assert cell["n"] == rows["n_positive"].tolist() and cell["total"] == int(rows["n_bins"].iloc[0])
        assert np.allclose(cell["pct"], rows["pct_positive"], atol=1e-3)
        assert np.allclose(cell["lo"], rows["ci_lo"], atol=1e-3) and np.allclose(cell["hi"], rows["ci_hi"], atol=1e-3)
    assert res["scope"] == "all sections; region of interest"


def test_composition_is_the_tissue_assignment(analysed):
    """Figure 3a: bins per assigned signature and section, as Figure3a_program_composition_native.csv."""
    env = analysed
    cfg = env["cfg"]
    want = pd.read_csv(env["out"] / "Figure3a_program_composition_native.csv")
    res = done(env, "composition", {"count": {"field": "assigned_signature"}, "across": {"field": "sample"}})
    assert res["exclusive"] and res["what"] == "Cell type"
    by_key = {s["key"]: i for i, s in enumerate(res["series"])}
    for k, sid in enumerate(SECTIONS):
        rows = want[want["sample"] == sid]
        assert res["cells"][k]["total"] == int(rows["n_bins"].sum())
        for r in rows.itertuples():
            key = r.program if r.program == "ambiguous" else slug(cfg, r.program)
            if key not in by_key:
                assert r.n_bins == 0
                continue
            assert res["cells"][k]["n"][by_key[key]] == r.n_bins
            assert np.isclose(res["cells"][k]["pct"][by_key[key]], r.pct_of_all_bins, atol=1e-3)
    # only the assigned bins: the manuscript's other denominator
    assigned = [s["key"] for s in res["series"] if s["key"] != "ambiguous"]
    res = done(env, "composition", {"count": {"field": "assigned_signature", "values": assigned},
                                    "denominator": "listed"})
    for k, sid in enumerate(SECTIONS):
        rows = want[(want["sample"] == sid) & (want["program"] != "ambiguous")].set_index("program")
        for i, s in enumerate(res["series"]):
            name = next(n for n in rows.index if slug(cfg, n) == s["key"])
            assert np.isclose(res["cells"][k]["pct"][i], rows.loc[name, "pct_of_assigned_bins"], atol=1e-3)


def test_distance_is_figure_4i(analysed):
    """Figure 4i: the distance from each pooled, depth-matched osteoblast bin to the nearest osteoclast one against the
    random-placement null, as Figure4i_observed_to_null_summary.csv (the same draws: one generator, the run's seed)."""
    env = analysed
    cfg = env["cfg"]
    unc = cfg["uncoupling"]
    want = pd.read_csv(env["out"] / "Figure4i_observed_to_null_summary.csv").set_index("sample")
    res = done(env, "distance", {
        "a": [{"field": f"positive_{slug(cfg, unc['a'])}_pooled_depthmatched", "values": [True]}],
        "b": [{"field": f"positive_{slug(cfg, unc['b'])}_pooled_depthmatched", "values": [True]}],
        "scope": {"roi": True}, "n_perm": unc["n_perm"], "min_bins": unc["min_pos"], "seed": cfg["seed"]})
    got = frame(res).set_index("section")
    estimable = 0
    for sid in SECTIONS:
        w, g = want.loc[sid], got.loc[labels(cfg)[sid]]
        assert (g["n_a"], g["n_b"], g["n_scope"]) == (w["n_a"], w["n_b"], w["n_units_roi"])
        if w["status"] != "estimable":
            assert g["status"].startswith("not estimable")
            continue
        estimable += 1
        assert g["status"] == "estimable"
        assert np.isclose(g["mean_um"], w["mean_nn_um"], atol=0.02)
        assert np.isclose(g["median_um"], w["median_nn_um"], atol=0.02)
        assert np.isclose(g["null_mean_um"], w["null_mean_um"], atol=0.02)
        assert np.isclose(g["ratio"], w["ratio_obs_null_mean"], atol=1e-3)
        assert np.isclose(g["ratio_lo"], w["ratio_obs_null_lo"], atol=1e-3)
        assert np.isclose(g["ratio_hi"], w["ratio_obs_null_hi"], atol=1e-3)
        assert np.isclose(g["p_farther"], w["p_greater_than_null_mean"], atol=1e-4)
    assert estimable >= 1


def test_distance_is_the_proximity_table(analysed):
    """The "within 50 um" tables: the share of the bins of one signature with a bin of another within the radius,
    against all bins of the region of interest, as <from>_to_<to>_proximity.csv (positivity calls)."""
    env = analysed
    cfg = env["cfg"]
    pair = next(p for p in cfg["proximity"]["pairs"] if p["mode"] == "positivity")
    src, dst, radius = pair["from"], pair["to"], cfg["proximity"]["radius_um"]
    want = pd.read_csv(env["out"] / f"{src}_to_{dst}_proximity.csv").set_index("section")
    res = done(env, "distance", {
        "a": [{"field": f"positive_{slug(cfg, src)}", "values": [True]}],
        "b": [{"field": f"positive_{slug(cfg, dst)}", "values": [True]}],
        "scope": {"roi": True}, "n_perm": 0, "min_bins": 1, "radius_um": radius,
        "exclude_self": cfg["proximity"]["exclude_self"]})
    got = frame(res).set_index("section")
    R = f"{radius:g}"
    checked = 0
    for sid in SECTIONS:
        w, g = want.loc[labels(cfg)[sid]], got.loc[labels(cfg)[sid]]
        assert (g["n_a"], g["n_b"], g["n_scope"]) == (w[f"{src}_positive_bins"], w[f"{dst}_positive_bins"],
                                                       w["region_of_interest_bins"])
        assert g["n_both"] == w[f"{src}_also_{dst}_positive_bins"]
        if g["status"] != "estimable":
            continue
        checked += 1
        assert round(g["pct_a_within"], 1) == w[f"percent_{src}_within_{R}um"]
        assert round(g["pct_all_within"], 1) == w[f"percent_all_bins_within_{R}um"]
        assert round(g["pct_a_within"] * g["n_a"] / 100) == w[f"{src}_within_{R}um_of_{dst}"]
    assert checked >= 1 and res["n_perm"] == 0


def test_expression_is_the_normalized_layer(analysed):
    """Expression by group: means, medians and detection of the run's own log-normalized matrix (layers["lognorm"])."""
    env = analysed
    a, cfg = env["a"], env["cfg"]
    total = np.asarray(a.layers["counts"].sum(axis=0)).ravel()
    genes = [a.var_names[i] for i in np.argsort(-total)[:3]]
    res = done(env, "expression", {"genes": genes, "group_by": {"field": "tissue_class"},
                                   "split_by": {"field": "sample"}})
    assert res["genes"] == genes and res["missing"] == []
    bins = env["bins"].set_index("barcode").loc[a.obs_names]
    X = a.layers["lognorm"][:, a.var_names.get_indexer(genes)].toarray()
    counts = a.layers["counts"][:, a.var_names.get_indexer(genes)].toarray()
    seen = 0
    for k, group in enumerate(res["groups"]):
        tissue, sample = group["key"].split("|")
        m = ((bins["tissue_class"] == tissue) & (bins["sample_id"] == sample)).to_numpy()
        assert group["n"] == int(m.sum()) > 0 and group["label"] == f"{tissue} · {labels(cfg)[sample]}"
        for j in range(len(genes)):
            d = res["stats"][j]["groups"][k]
            assert d["n_detected"] == int((counts[m, j] > 0).sum())
            assert np.isclose(d["mean"], X[m, j].mean(), atol=2e-4)
            assert np.isclose(d["q"][3], np.median(X[m, j]), atol=2e-4)
            seen += 1
    assert seen >= 6 and not any("not in the raw data" in n for n in res["notes"])


def test_de_is_scanpys_wilcoxon(analysed):
    """Differential expression with uncorrected ties gives scanpy's rank_genes_groups scores (what Figure 4h uses) on
    the run's log-normalized matrix; the default corrects for ties and never has a smaller |z|."""
    import anndata as ad
    import scanpy as sc
    env = analysed
    a = env["a"]
    bins = env["bins"].set_index("barcode").loc[a.obs_names]
    tissue = bins.loc[bins["sample_id"] == "TUM-1", "tissue_class"].value_counts().index[0]
    here = (bins["sample_id"] == "TUM-1").to_numpy()
    in_a = (bins["tissue_class"] == tissue).to_numpy()[here]
    assert 2 <= in_a.sum() <= here.sum() - 2
    params = {"a": [{"field": "tissue_class", "values": [tissue]}], "scope": {"samples": ["TUM-1"]}, "min_bins": 1,
              "ties": "scanpy"}
    res = done(env, "de", params)
    assert (res["a"]["n"], res["b"]["n"]) == (int(in_a.sum()), int((~in_a).sum()))
    sub = ad.AnnData(X=sparse.csr_matrix(a.layers["lognorm"][here]), var=pd.DataFrame(index=a.var_names.copy()),
                     obs=pd.DataFrame({"g": pd.Categorical(np.where(in_a, "a", "b"))}, index=a.obs_names[here]))
    sc.tl.rank_genes_groups(sub, "g", method="wilcoxon", use_raw=False)
    want = sc.get.rank_genes_groups_df(sub, group="a").set_index("names")
    got = frame(res).set_index("gene")
    assert len(got) > 200 and set(got.index) <= set(want.index)
    assert np.allclose(got["stat"], want.loc[got.index, "scores"], atol=2e-3)
    assert np.allclose(got["p"], want.loc[got.index, "pvals"], rtol=5e-3, atol=1e-12)
    # fold change and detection as the Figure 4h table computes them
    X, counts = a.layers["lognorm"][here].toarray(), a.layers["counts"][here].toarray()
    cp = np.expm1(X.astype(np.float64))
    top = got.index[:20]
    j = a.var_names.get_indexer(top)
    lfc = np.log2((cp[in_a][:, j].mean(axis=0) + 1) / (cp[~in_a][:, j].mean(axis=0) + 1))
    assert np.allclose(got.loc[top, "log2fc"], lfc, atol=2e-3)
    assert np.allclose(got.loc[top, "pct_a"], 100 * (counts[in_a][:, j] > 0).mean(axis=0), atol=0.01)
    corrected = frame(done(env, "de", {**params, "ties": "corrected"})).set_index("gene")
    assert (corrected.loc[got.index, "stat"].abs() >= got["stat"].abs() - 2e-3).all()


def test_svg_follows_the_pipeline(analysed):
    """Spatially variable genes: Moran's I of the genes the pipeline tested (morans_I_per_section.csv). On a square
    grid the Delaunay graph takes one diagonal of every cell, a choice that turns on the last digit of the positions,
    so the two agree closely, not to the last decimal."""
    env = analysed
    cfg = env["cfg"]
    want = pd.read_csv(env["out"] / "morans_I_per_section.csv")
    res = done(env, "svg", {"min_bins": 1, "top": 5000})
    got = frame(res)
    for sid in SECTIONS:
        w = want[want["sample"] == sid].set_index("gene")["I"].dropna()
        g = got[got["section"] == labels(cfg)[sid]].set_index("gene")["I"]
        common = w.index.intersection(g.index)
        assert len(common) > 100
        diff = (g.loc[common] - w.loc[common]).abs()
        assert np.corrcoef(g.loc[common], w.loc[common])[0, 1] > 0.99 and diff.median() < 0.01
        assert list(g.index[:3]) == list(g.sort_values(ascending=False).index[:3])
    assert [s["status"] for s in res["sections"]] == ["done", "done"]


def test_score_follows_the_signature_scores(analysed):
    """A gene-set score of a signature's genes follows the run's own score of that signature (scanpy's score_genes
    with other control genes), bin by bin, served in the order of GET /bins."""
    env = analysed
    a, cfg, c, rid = env["a"], env["cfg"], env["c"], env["rid"]
    genes = [g for g in cfg["signatures"]["osteoclast"]["extended"] if g in a.var_names]
    card = analyse(env, "score", {"genes": genes, "name": "Osteoclast", "group_by": {"field": "sample"}})
    assert card["status"] == "done", card["error"]
    res = card["result"]
    assert res["genes"] == genes and [m["sample"] for m in res["maps"]] == list(SECTIONS)
    for m in res["maps"]:
        r = c.get(f"/api/runs/{rid}/analyses/{card['id']}/values", params={"name": m["array"]})
        assert r.status_code == 200, r.text
        values = np.array(r.json()["values"], dtype=float)
        order = env["bins"].loc[env["bins"]["sample_id"] == m["sample"], "barcode"]   # the order of GET /bins
        assert len(values) == len(order) == c.get(f"/api/runs/{rid}/bins", params={"sample": m["sample"]}).json()["n"]
        ref = a.obs.loc[order, "score_osteoclast"].to_numpy()
        assert np.isfinite(values).all() and np.corrcoef(values, ref)[0, 1] > 0.9
    assert c.get(f"/api/runs/{rid}/analyses/{card['id']}/values", params={"name": "score:NOPE"}).status_code == 404
    assert c.get(f"/api/runs/{rid}/analyses/{card['id']}/values", params={"name": "../x"}).status_code == 404
    assert c.get(f"/api/runs/{rid}/analyses/{card['id']}/values").status_code == 400


# ============================================================================
# CARDS
# ============================================================================

def test_card_lifecycle(analysed):
    env = analysed
    c, rid = env["c"], env["rid"]
    url = f"/api/runs/{rid}/analyses"
    before = {x["id"] for x in c.get(url).json()}
    card = analyse(env, "composition", {"count": {"field": "tissue_class"}}, title="Classes", view={"chart": "stacked"})
    aid = card["id"]
    assert card["status"] == "done" and card["tool"] == "composition" and card["title"] == "Classes"
    assert card["view"] == {"chart": "stacked"} and card["error"] is None and card["seconds"] >= 0
    assert card["result"]["exclusive"] and card["created"] <= card["updated"]
    listed = c.get(url).json()
    assert listed[0]["id"] == aid and "result" not in listed[0] and {x["id"] for x in listed} == before | {aid}
    assert listed[0]["params"] == {"count": {"field": "tissue_class"}}
    assert c.get(f"{url}/{aid}").json()["result"] == card["result"]
    # a title of its own, a view kept
    r = c.put(f"{url}/{aid}", json={"title": "Tissue classes", "view": {"chart": "grouped", "sort": "n"}})
    assert r.status_code == 200 and r.json()["title"] == "Tissue classes" and "result" not in r.json()
    assert c.get(f"{url}/{aid}").json()["view"] == {"chart": "grouped", "sort": "n"}
    assert c.put(f"{url}/{aid}", json={"title": ""}).status_code == 400
    assert c.put(f"{url}/{aid}", json={"view": "x"}).status_code == 400
    assert c.put(f"{url}/{aid}", json={"view": {"x": "y" * 30000}}).status_code == 400
    # the table as CSV
    r = c.get(f"{url}/{aid}/table.csv")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    assert 'filename="Tissue-classes.csv"' in r.headers["content-disposition"]
    lines = r.text.split("\n")
    assert lines[0].startswith("Group,Tissue class,Bins,Of,%") and len(lines) == card["result"]["table"]["rows"] + 2
    # computed again with other settings, in place
    r = c.post(f"{url}/{aid}/rerun", json={"params": {"count": {"field": "leiden_domain"}}})
    assert r.status_code == 200, r.text
    again = finished(env, r.json())
    assert again["id"] == aid and again["status"] == "done" and again["result"]["what"] == "Leiden domain"
    assert again["title"] == "Tissue classes" and again["params"] == {"count": {"field": "leiden_domain"}}
    # settings that cannot be computed: 422 with the reason, and the card stays as it was
    r = c.post(f"{url}/{aid}/rerun", json={"params": {"count": {"field": "nope"}}})
    assert r.status_code == 422 and "no field 'nope'" in r.json()["detail"]
    kept = c.get(f"{url}/{aid}").json()
    assert kept["status"] == "done" and kept["params"] == {"count": {"field": "leiden_domain"}}
    assert kept["result"]["what"] == "Leiden domain"
    # a new card that cannot be computed leaves no card
    r = c.post(url, json={"tool": "expression", "params": {"genes": ["NotAGene"], "group_by": {"field": "sample"}}})
    assert r.status_code == 422 and "none of these genes is in the data" in r.json()["detail"]
    assert {x["id"] for x in c.get(url).json()} == before | {aid}
    for bad in ({"tool": "nope", "params": {}}, {"params": {}}, {"tool": "de", "params": []},
                {"tool": "de", "title": "x" * 200}):
        assert c.post(url, json=bad).status_code == 400, bad
    assert c.delete(f"{url}/{aid}").status_code == 200
    assert c.get(f"{url}/{aid}").status_code == 404 and c.delete(f"{url}/{aid}").status_code == 404
    assert c.get(f"{url}/{aid}/table.csv").status_code == 404
    assert not list((env["app"].state.storage.analyses_dir(rid)).glob(f"{aid}*"))
    for bad_id in ("a-zzz", "a-0123456789.result", "a-0123456789"):
        assert c.get(f"{url}/{bad_id}").status_code == 404, bad_id
    assert c.get("/api/runs/r-20200101-000000-abcd/analyses").status_code == 404


def test_cards_of_a_stopped_server_and_an_unfinished_run(analysed, tmp_path):
    env = analysed
    c, rid, storage = env["c"], env["rid"], env["app"].state.storage
    # a card left running by a server that stopped: failed, with the reason, when it is next read
    left = storage.create_analysis(rid, "composition", "Left over", {"count": {"field": "tissue_class"}})
    card = next(x for x in c.get(f"/api/runs/{rid}/analyses").json() if x["id"] == left["id"])
    assert card["status"] == "failed" and "server stopped" in card["error"]
    assert storage.get_analysis(rid, left["id"])["status"] == "failed"
    r = c.post(f"/api/runs/{rid}/analyses/{left['id']}/rerun")
    assert r.status_code == 200 and finished(env, r.json())["status"] == "done"
    assert c.delete(f"/api/runs/{rid}/analyses/{left['id']}").status_code == 200
    # a run still working is analysed when it has finished; a run without a per-bin table cannot be
    busy = start_run(c, env["pid"], steps={"moran": False})
    p = new_project(c, "Slow", **{**env["cfg"], "fake_sleep": 3})
    slow = start_run(c, p["id"])["id"]
    r = c.post(f"/api/runs/{slow}/analyses", json={"tool": "composition", "params": {"count": {"field": "tissue_class"}}})
    assert r.status_code == 409 and "when it has finished" in r.json()["detail"]
    assert c.post(f"/api/runs/{slow}/cancel").status_code == 200
    wait_for(c, slow, {"cancelled", "failed", "succeeded"})
    wait_for(c, busy["id"], {"succeeded", "failed"})
    r = c.post(f"/api/runs/{slow}/analyses", json={"tool": "composition", "params": {"count": {"field": "tissue_class"}}})
    assert r.status_code == 404 and "no per-bin table" in r.json()["detail"]
    assert c.get(f"/api/runs/{slow}/analysis/context").status_code == 404
    assert c.get(f"/api/runs/{slow}/analyses").json() == []


def test_tools_without_the_raw_data(analysed, tmp_path_factory, tiny_demo):
    """When the data the run analysed has moved, the context says so, the tools that read gene counts fail with the
    reason and the others still work."""
    env = analysed
    moved = tmp_path_factory.mktemp("moved")
    app = create_app(tmp_path_factory.mktemp("ws2"), worker_module=FAKE)
    with TestClient(app, base_url=LOCAL) as c:
        data = moved / "data"
        shutil.copytree(tiny_demo["root"], data)
        cfg = {**env["cfg"], "data_root": str(data),
               "samples": [{**s, "path": str(data / s["path"].replace(str(tiny_demo["root"]), "").lstrip("\\/"))}
                           if str(s.get("path", "")).startswith(str(tiny_demo["root"])) else dict(s)
                           for s in env["cfg"]["samples"]]}
        p = new_project(c, "Moved", **cfg)
        rid = start_run(c, p["id"])["id"]
        assert wait_for(c, rid, {"succeeded", "failed"})["status"] == "succeeded"
        results = app.state.storage.results_dir(rid)
        shutil.rmtree(results)
        shutil.copytree(env["out"], results)
        shutil.rmtree(data)
        ctx = c.get(f"/api/runs/{rid}/analysis/context").json()
        assert ctx["expression"]["available"] is False and "can no longer be found" in ctx["expression"]["reason"]
        url = f"/api/runs/{rid}/analyses"
        r = c.post(url, json={"tool": "composition", "params": {"count": {"field": "tissue_class"}}})
        assert r.status_code == 200 and r.json()["status"] == "done"
        r = c.post(url, json={"tool": "expression", "params": {"genes": ["Ctsk"], "group_by": {"field": "sample"}}})
        assert r.status_code == 422 and "can no longer be found" in r.json()["detail"]
        assert len(c.get(url).json()) == 1


# ============================================================================
# REGIONS AND TEMPLATES
# ============================================================================

def test_regions(analysed):
    env = analysed
    c, rid, bins = env["c"], env["rid"], env["bins"]
    url = f"/api/runs/{rid}/regions"
    assert c.get(url).json() == {"regions": []}
    tum = bins[bins["sample_id"] == "TUM-1"]
    # the right edge runs through a gap between bins near the middle (a bin on an edge may count either way)
    xs = np.sort(tum["x_um"].unique())
    k = next(i for i in range(len(xs) // 2, len(xs) - 1) if xs[i + 1] - xs[i] > 0.1)
    x0, x1, y0, y1 = xs[0], round(float(xs[k] + xs[k + 1]) / 2, 2), tum["y_um"].min(), tum["y_um"].max()
    box = [[x0 - 1, y0 - 1], [x1, y0 - 1], [x1, y1 + 1], [x0 - 1, y1 + 1]]
    r = c.put(url, json={"regions": [{"name": " Left half ", "sample": "TUM-1", "polygons": [box], "color": "#ff8800"},
                                     {"name": "Corner", "sample": "CTRL-1", "color": "red",
                                      "polygons": [[[0, 0], [5, 0], [0, 5.123456]]]}]})
    assert r.status_code == 200, r.text
    regions = r.json()["regions"]
    inside = (tum["x_um"] <= x1)
    assert [(g["name"], g["sample"], g["n"], g["color"]) for g in regions] == [
        ("Left half", "TUM-1", int(inside.sum()), "#ff8800"), ("Corner", "CTRL-1", regions[1]["n"], None)]
    assert all(server.REGION_ID_RE.match(g["id"]) for g in regions) and regions[1]["polygons"][0][2] == [0.0, 5.12]
    assert c.get(url).json()["regions"] == regions
    ctx = c.get(f"/api/runs/{rid}/analysis/context").json()
    field = next(f for f in ctx["fields"] if f["key"] == "region:Left half")
    assert (field["type"], field["label"], field["n_true"], field["text"]) == (
        "bool", "Left half", int(inside.sum()), ["inside", "outside"])
    assert [g["name"] for g in ctx["regions"]] == ["Left half", "Corner"]
    # the region is a group and a scope like any field
    res = done(env, "composition", {"count": {"field": "tissue_class"},
                                    "across": {"field": "region:Left half"}, "scope": {"samples": ["TUM-1"]}})
    assert [g["label"] for g in res["groups"]] == ["Left half: inside", "Left half: outside"]
    assert [cell["total"] for cell in res["cells"]] == [int(inside.sum()), int((~inside).sum())]
    res = done(env, "de", {"a": [{"field": "region:Left half", "values": [True]}], "scope": {"samples": ["TUM-1"]}})
    assert (res["a"]["n"], res["b"]["n"]) == (int(inside.sum()), int((~inside).sum()))
    assert res["a"]["label"] == "Left half: inside"
    # the ids are kept when the regions are saved again, and a region can go
    kept = c.put(url, json={"regions": [{**regions[0], "name": "Left"}]}).json()["regions"]
    assert [(g["id"], g["name"]) for g in kept] == [(regions[0]["id"], "Left")]
    r = c.post(f"/api/runs/{rid}/analyses", json={
        "tool": "composition", "params": {"count": {"field": "tissue_class"}, "across": {"field": "region:Left half"}}})
    assert r.status_code == 422 and "no region 'Left half'" in r.json()["detail"]
    for bad in ({}, {"regions": "x"}, {"regions": [{"name": "", "sample": "TUM-1", "polygons": [box]}]},
                {"regions": [{"name": "a", "sample": "NOPE", "polygons": [box]}]},
                {"regions": [{"name": "a", "sample": "TUM-1", "polygons": []}]},
                {"regions": [{"name": "a", "sample": "TUM-1", "polygons": [box[:2]]}]},
                {"regions": [{"name": "a", "sample": "TUM-1", "polygons": [[[0, 0], [1, "x"], [2, 2]]]}]},
                {"regions": [{"name": "a" * 61, "sample": "TUM-1", "polygons": [box]}]},
                {"regions": [{"name": "a", "sample": "TUM-1", "polygons": [box]}] * 201}):
        assert c.put(url, json=bad).status_code == 400, bad
    assert c.put(url, json={"regions": []}).json() == {"regions": []}
    assert c.get("/api/runs/r-20200101-000000-abcd/regions").status_code == 404


def test_templates(analysed):
    env = analysed
    c, rid = env["c"], env["rid"]
    assert c.get("/api/analysis/templates").json() == []
    cards = [{"tool": "composition", "title": "Classes", "params": {"count": {"field": "tissue_class"}},
              "view": {"chart": "stacked"}},
             {"tool": "expression", "title": "A gene nobody has",
              "params": {"genes": ["NotAGene"], "group_by": {"field": "sample"}}},
             {"tool": "neighborhood", "params": {"field": {"field": "tissue_class"}, "n_perm": 10}}]
    r = c.post("/api/analysis/templates", json={"name": "My set", "cards": cards})
    assert r.status_code == 200, r.text
    t = r.json()
    assert t["name"] == "My set" and [x["tool"] for x in t["cards"]] == ["composition", "expression", "neighborhood"]
    assert t["cards"][2]["title"] == "Neighborhood enrichment"                # the tool's name when none is given
    assert c.get("/api/analysis/templates").json() == [t]
    before = {x["id"] for x in c.get(f"/api/runs/{rid}/analyses").json()}
    r = c.post(f"/api/runs/{rid}/templates/{t['id']}/apply")
    assert r.status_code == 200, r.text
    started = r.json()
    assert [x["title"] for x in started] == ["Classes", "A gene nobody has", "Neighborhood enrichment"]
    ended = [finished(env, x) for x in started]
    assert [x["status"] for x in ended] == ["done", "failed", "done"]
    assert "none of these genes is in the data" in ended[1]["error"] and ended[0]["view"] == {"chart": "stacked"}
    listed = [x for x in c.get(f"/api/runs/{rid}/analyses").json() if x["id"] not in before]
    assert [x["title"] for x in listed] == ["Classes", "A gene nobody has", "Neighborhood enrichment"]
    for x in started:
        assert c.delete(f"/api/runs/{rid}/analyses/{x['id']}").status_code == 200
    for bad in ({}, {"name": "x"}, {"name": "x", "cards": []}, {"name": "", "cards": cards},
                {"name": "x", "cards": [{"tool": "nope"}]}, {"name": "x", "cards": cards * 14}):
        assert c.post("/api/analysis/templates", json=bad).status_code == 400, bad
    assert c.post(f"/api/runs/{rid}/templates/t-00000000/apply").status_code == 404
    assert c.delete(f"/api/analysis/templates/{t['id']}").status_code == 200
    assert c.delete(f"/api/analysis/templates/{t['id']}").status_code == 404
    assert c.get("/api/analysis/templates").json() == []


def test_deleting_the_run_removes_its_analyses(tmp_path, tiny_demo, tiny_joint):
    app = create_app(tmp_path / "ws", worker_module=FAKE)
    with TestClient(app, base_url=LOCAL) as c:
        p = new_project(c, "Gone", **tiny_joint["cfg"])
        rid = start_run(c, p["id"])["id"]
        assert wait_for(c, rid, {"succeeded", "failed"})["status"] == "succeeded"
        results = app.state.storage.results_dir(rid)
        shutil.rmtree(results)
        shutil.copytree(tiny_joint["out"], results)
        r = c.post(f"/api/runs/{rid}/analyses", json={"tool": "composition",
                                                      "params": {"count": {"field": "tissue_class"}}})
        assert r.status_code == 200 and r.json()["status"] == "done"
        run_dir = app.state.storage.run_dir(rid)
        assert list((run_dir / "analyses").glob("a-*.json"))
        assert c.delete(f"/api/runs/{rid}").status_code == 200 and not run_dir.exists()
        assert c.get(f"/api/runs/{rid}/analyses").status_code == 404
