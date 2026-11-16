"""
tests/test_analysis_tools.py
============================
The Analysis tab's tools (webapp/analysis.py) without a server: their statistics against scipy, statsmodels, scanpy and
bone_analysis, and each tool on a small synthetic Context (two sections with different gene lists, a few bins that the
raw data lacks). tests/test_analysis_api.py runs the same tools through the API on the real analysis of the demo data.
"""
from __future__ import annotations

import json

import numpy as np
import pandas as pd
import pytest
from scipy import sparse, stats
from scipy.spatial import cKDTree

from webapp import analysis as an

PITCH = 16.0


# ============================================================================
# DATA
# ============================================================================

class Section:
    """What analysis.Expression needs of a raw section (webapp.server.RawSection has it)."""

    def __init__(self, counts: np.ndarray, genes: list[str]):
        self.X = sparse.csc_matrix(counts.astype(np.uint16))
        self.genes = list(genes)
        self.total = counts.sum(axis=1).astype(np.int64)


def grid(rows: int, cols: int) -> tuple[np.ndarray, np.ndarray]:
    yy, xx = np.mgrid[0:rows, 0:cols]
    return xx.ravel() * PITCH, yy.ravel() * PITCH


@pytest.fixture(scope="module")
def world():
    """Two sections on square grids: A (20 x 12 = 240 bins, genes G0..G59) and B (16 x 10 = 160 bins, genes G5..G64 in
    another order). Bins are 'alpha' on the left third, 'beta' in the middle, 'gamma' on the right; G1 marks alpha,
    G7 and G8 rise together in beta. Three bins of A and two of B are not in the raw data. `dense` holds the counts of
    every bin by the joint gene list (0 where a section lacks the gene), `total` each bin's UMIs in its own section."""
    rng = np.random.default_rng(7)
    shapes = {"A": (12, 20), "B": (10, 16)}
    genes = {"A": [f"G{i}" for i in range(60)], "B": [f"G{i}" for i in rng.permutation(np.arange(5, 65))]}
    joint = list(dict.fromkeys(genes["A"] + genes["B"]))
    xs, ys, sample, cell, parts, dense, total, matched = [], [], [], [], [], [], [], []
    offset = 0
    sections = {}
    for code, sid in enumerate(("A", "B")):
        rows, cols = shapes[sid]
        x, y = grid(rows, cols)
        n = len(x)
        kind = np.minimum(2, (3 * x / (cols * PITCH)).astype(int))          # 0 alpha, 1 beta, 2 gamma
        depth = rng.gamma(4.0, 0.25, n) * (1.6 if sid == "A" else 1.0)
        rate = rng.gamma(0.6, 0.5, len(genes[sid]))[None, :] * depth[:, None]
        at = {g: j for j, g in enumerate(genes[sid])}
        if "G1" in at:
            rate[kind == 0, at["G1"]] += 3.0
        shared = rng.gamma(1.0, 1.5, n) * (kind == 1)
        rate[:, at["G7"]] += shared
        rate[:, at["G8"]] += shared
        counts = rng.poisson(rate)
        counts[:, at["G30"]] = 0                                              # a gene nobody detects
        sections[sid] = Section(counts, genes[sid])
        order = rng.permutation(n)                                            # the raw data holds the bins in another order
        raw = np.empty(n, dtype=np.int64)
        raw[order] = np.arange(n)
        sections[sid] = Section(counts[order], genes[sid])
        lost = rng.choice(n, 3 if sid == "A" else 2, replace=False)
        rows_in_raw = raw.copy()
        rows_in_raw[lost] = -1
        here = np.zeros((n, len(joint)), dtype=np.int64)
        here[:, [joint.index(g) for g in genes[sid]]] = counts
        ok = rows_in_raw >= 0
        here[~ok] = 0
        labels = kind.copy()
        labels[rng.choice(n, 6, replace=False)] = -1                          # bins without a cell type
        xs.append(x), ys.append(y), sample.append(np.full(n, code)), cell.append(labels)
        parts.append((np.arange(offset, offset + n), rows_in_raw, sections[sid]))
        dense.append(here), total.append(np.where(ok, counts.sum(axis=1), 0)), matched.append(ok)
        offset += n
    x, y = np.concatenate(xs), np.concatenate(ys)
    cell = np.concatenate(cell)
    dense, total, matched = np.vstack(dense), np.concatenate(total).astype(float), np.concatenate(matched)
    with np.errstate(divide="ignore", invalid="ignore"):
        lognorm = np.log1p(np.where(total[:, None] > 0, dense * 1e4 / total[:, None], 0.0))
    roi = rng.random(len(x)) < 0.85
    return {"x": x, "y": y, "sample": np.concatenate(sample), "cell": cell, "parts": parts, "genes": joint,
            "dense": dense, "total": total, "matched": matched, "lognorm": lognorm, "roi": roi,
            "positive": (cell == 0) & (rng.random(len(x)) < 0.9), "sections": sections}


def make_context(world, regions=None, cancelled=None, tables=None, table_names=None) -> an.Context:
    n = len(world["x"])
    fields = {
        "cell": an.Field("cell", "category", ["alpha", "beta", "gamma"], world["cell"].astype(np.int64),
                         colors={"alpha": "#aa0000"}),
        "positive_alpha": an.Field("positive_alpha", "bool", values=world["positive"]),
        "in_region_of_interest": an.Field("in_region_of_interest", "bool", values=world["roi"]),
    }
    return an.Context(
        samples=[{"id": "A", "label": "control", "color": "#4C72B0"}, {"id": "B", "label": "treated"}],
        sample_codes=world["sample"], x=world["x"], y=world["y"], fields=fields,
        expression=lambda: an.Expression(n, world["parts"]), regions=regions, total_umi=world["total"],
        cancelled=cancelled, tables=tables, table_names=table_names)


@pytest.fixture
def ctx(world):
    return make_context(world)


def col(result: dict, key: str) -> np.ndarray:
    return np.array(result["table"]["data"][key], dtype=object)


def z_of(xa, xb) -> float:
    """z of the tie-corrected normal approximation of the Mann-Whitney U test (scipy)."""
    n_a, n_b = len(xa), len(xb)
    res = stats.mannwhitneyu(xa, xb, use_continuity=False, method="asymptotic")
    ranks = stats.rankdata(np.concatenate([xa, xb]))
    _, t = np.unique(ranks, return_counts=True)
    n = n_a + n_b
    var = n_a * n_b / 12.0 * ((n + 1) - (t ** 3 - t).sum() / (n * (n - 1)))
    return (res.statistic - n_a * n_b / 2.0) / np.sqrt(var) if var > 0 else 0.0


# ============================================================================
# STATISTICS
# ============================================================================

def test_bh_and_wilson_match_statsmodels():
    from statsmodels.stats.multitest import multipletests
    from statsmodels.stats.proportion import proportion_confint
    rng = np.random.default_rng(0)
    p = np.concatenate([rng.random(40) ** 3, [1.0, 0.0, 0.5, 0.5]])
    assert np.allclose(an.bh_adjust(p), multipletests(p, method="fdr_bh")[1])
    with_nan = p.copy()
    with_nan[[3, 17]] = np.nan
    adjusted = an.bh_adjust(with_nan)
    ok = np.isfinite(with_nan)
    assert np.isnan(adjusted[~ok]).all() and np.allclose(adjusted[ok], multipletests(with_nan[ok], method="fdr_bh")[1])
    assert an.bh_adjust([]).shape == (0,)
    k = np.array([0, 1, 5, 40, 100, 100])
    n = np.array([10, 10, 1000, 100, 100, 250000])
    lo, hi = an.wilson_interval(k, n)
    for i in range(len(k)):
        want = proportion_confint(int(k[i]), int(n[i]), method="wilson")
        assert np.allclose([lo[i], hi[i]], want, atol=1e-12), (k[i], n[i])
    lo, hi = an.wilson_interval([0, 3], [0, 0])
    assert np.isnan(lo).all() and np.isnan(hi).all()


def test_lognorm_matches_scanpy(world):
    import anndata as ad
    import scanpy as sc
    counts = world["sections"]["A"].X.toarray().astype(np.float32)
    counts[5] = 0                                                           # a bin without counts
    a = ad.AnnData(X=sparse.csr_matrix(counts))
    sc.pp.normalize_total(a, target_sum=1e4)
    sc.pp.log1p(a)
    ours = an.lognorm(sparse.csr_matrix(counts), counts.sum(axis=1)).toarray()
    assert np.allclose(ours, a.X.toarray(), rtol=1e-5, atol=1e-6)
    assert not ours[5].any()
    other = an.lognorm(sparse.csr_matrix(counts), counts.sum(axis=1), target_sum=1e6).toarray()
    assert np.allclose(np.expm1(other), 100 * np.expm1(ours), rtol=1e-9)


def test_rank_sum_test_matches_scipy(world):
    """Tie-corrected: U, z and P of every gene as scipy.stats.mannwhitneyu (asymptotic, no continuity correction); the
    same whatever the chunk size; a gene nobody detects and a gene constant everywhere have z 0 and P 1."""
    X = world["lognorm"][world["matched"]].copy()
    X[:, 3] = 2.5                                                           # the same value in every bin
    rng = np.random.default_rng(1)
    in_a = rng.random(len(X)) < 0.3
    z, p, u = an.rank_sum_test(sparse.csc_matrix(X), in_a)
    for j in range(X.shape[1]):
        xa, xb = X[in_a, j], X[~in_a, j]
        if np.ptp(X[:, j]) == 0:
            assert z[j] == 0 and p[j] == 1, j
            continue
        res = stats.mannwhitneyu(xa, xb, use_continuity=False, method="asymptotic")
        assert np.isclose(u[j], res.statistic), j
        assert np.isclose(p[j], res.pvalue, rtol=1e-9, atol=1e-300), j
        assert np.isclose(z[j], z_of(xa, xb), rtol=1e-9, atol=1e-12), j
    assert not world["dense"][:, world["genes"].index("G30")].any() and z[world["genes"].index("G30")] == 0
    for chunk in (1, 50, 997):
        z2, p2, u2 = an.rank_sum_test(sparse.csc_matrix(X), in_a, chunk_nnz=chunk)
        assert np.allclose(z, z2) and np.allclose(p, p2) and np.allclose(u, u2)
    # one group holds every bin, or values below 0
    z0, p0, _ = an.rank_sum_test(sparse.csc_matrix(X), np.ones(len(X), bool))
    assert not z0.any() and (p0 == 1).all()
    with pytest.raises(ValueError):
        an.rank_sum_test(sparse.csc_matrix(-X), in_a)
    with pytest.raises(ValueError):
        an.rank_sum_test(sparse.csc_matrix(X), in_a, ties="other")


def test_rank_sum_test_without_tie_correction_is_scanpy(world):
    """ties="scanpy": the z scores of scanpy.tl.rank_genes_groups(method="wilcoxon"), which Figure 4h uses; the
    corrected ones are larger in size, since most bins tie at zero."""
    import anndata as ad
    import scanpy as sc
    keep = world["matched"]
    X = world["lognorm"][keep]
    in_a = world["cell"][keep] == 1
    a = ad.AnnData(X=sparse.csr_matrix(X), var=pd.DataFrame(index=world["genes"]),
                   obs=pd.DataFrame({"g": pd.Categorical(np.where(in_a, "a", "b"))}))
    sc.tl.rank_genes_groups(a, "g", method="wilcoxon", use_raw=False)
    df = sc.get.rank_genes_groups_df(a, group="a").set_index("names").loc[world["genes"]]
    z, p, _ = an.rank_sum_test(sparse.csc_matrix(X), in_a, ties="scanpy")
    assert np.allclose(z, df["scores"].to_numpy(), atol=1e-4)
    assert np.allclose(p, df["pvals"].to_numpy(), rtol=1e-3, atol=1e-12)
    corrected = an.rank_sum_test(sparse.csc_matrix(X), in_a)[0]
    varying = np.ptp(X, axis=0) > 0
    assert (np.abs(corrected[varying]) >= np.abs(z[varying]) - 1e-12).all()
    assert np.abs(corrected[varying]).max() > np.abs(z[varying]).max()


def test_welch_and_pearson_match_scipy(world):
    X = world["lognorm"][world["matched"]]
    rng = np.random.default_rng(2)
    in_a = rng.random(len(X)) < 0.4
    t, p = an.welch_test(sparse.csr_matrix(X), in_a)
    y = X[:, world["genes"].index("G7")]
    r, pr = an.pearson_columns(sparse.csr_matrix(X), y)
    for j in range(X.shape[1]):
        if np.ptp(X[:, j]) == 0:
            assert t[j] == 0 and p[j] == 1 and r[j] == 0 and pr[j] == 1, j
            continue
        want = stats.ttest_ind(X[in_a, j], X[~in_a, j], equal_var=False)
        assert np.isclose(t[j], want.statistic, rtol=1e-8) and np.isclose(p[j], want.pvalue, rtol=1e-7, atol=1e-300), j
        ref = stats.pearsonr(X[:, j], y)
        assert np.isclose(r[j], ref.statistic, atol=1e-9), j
        if abs(ref.statistic) < 0.999:
            assert np.isclose(pr[j], ref.pvalue, rtol=1e-6, atol=1e-300), j
    assert np.isclose(r[world["genes"].index("G7")], 1.0)


def test_morans_i_matches_the_pipeline(world):
    """Moran's I, and its analytic P value, of every gene as bone_analysis._morans_i_builtin (scanpy.metrics.morans_i
    on the row-normalised Delaunay graph, squidpy's normal approximation)."""
    import anndata as ad
    import bone_analysis as ba
    rng = np.random.default_rng(3)
    keep = np.flatnonzero(world["matched"] & (world["sample"] == 0))
    xy = np.column_stack([world["x"][keep], world["y"][keep]]) + rng.normal(0, 1.5, (len(keep), 2))
    X = world["lognorm"][keep]
    genes = world["genes"]
    sub = ad.AnnData(X=sparse.csr_matrix(X), var=pd.DataFrame(index=genes), obsm={"spatial": xy})
    want = ba._morans_i_builtin(sub, genes).loc[genes]
    score, z, p = an.morans_i(sparse.csc_matrix(X), an.delaunay_graph(xy))
    constant = np.ptp(X, axis=0) == 0
    assert constant.any() and np.isnan(score[constant]).all() and np.isnan(p[constant]).all()
    assert np.isnan(want["I"].to_numpy()[constant]).all()
    assert np.allclose(score[~constant], want["I"].to_numpy()[~constant], atol=1e-9)
    ref_p = want["pval_norm"].to_numpy()[~constant]
    big = ref_p > 1e-12                                 # the pipeline's 1 - cdf(z) loses the smallest ones
    assert np.allclose(p[~constant][big], ref_p[big], rtol=1e-6)
    patterned = [genes.index(g) for g in ("G1", "G7", "G8")]
    assert (z[patterned] > 2).all() and z[patterned[0]] > 10                 # the planted patterns stand out
    # the same in one chunk or many
    again = an.morans_i(sparse.csc_matrix(X), an.delaunay_graph(xy), chunk_nnz=40)[0]
    assert np.allclose(score[~constant], again[~constant])


def test_score_gene_set(world):
    """The score is the set's mean minus the mean of the control genes it reports, and follows scanpy's score_genes."""
    import anndata as ad
    import scanpy as sc
    rng = np.random.default_rng(4)
    n, n_genes = 300, 600
    rate = rng.gamma(0.5, 1.0, n_genes)[None, :] * rng.gamma(4.0, 0.25, n)[:, None]
    rate[:100, :8] += 2.0                                                   # the set: genes 0..7, high in the first bins
    counts = rng.poisson(rate).astype(np.float64)
    Xn = an.lognorm(sparse.csr_matrix(counts), counts.sum(axis=1))
    cols = list(range(8))
    score, control = an.score_gene_set(Xn, cols, ctrl_size=50, seed=0)
    dense = Xn.toarray()
    assert len(control) > 20 and not set(control.tolist()) & set(cols)
    assert np.allclose(score, dense[:, cols].mean(axis=1) - dense[:, control].mean(axis=1))
    assert score[:100].mean() > score[100:].mean() + 0.5
    again, control2 = an.score_gene_set(Xn, cols, ctrl_size=50, seed=0)
    assert np.array_equal(control, control2) and np.array_equal(score, again)
    a = ad.AnnData(X=Xn.copy(), var=pd.DataFrame(index=[f"g{i}" for i in range(n_genes)]))
    sc.tl.score_genes(a, [f"g{i}" for i in cols], ctrl_size=50, score_name="s", random_state=0)
    assert np.corrcoef(score, a.obs["s"].to_numpy())[0, 1] > 0.97


def test_geometry_helpers():
    from matplotlib.path import Path as MplPath
    rng = np.random.default_rng(5)
    poly = np.array([[0, 0], [10, 0], [10, 10], [5, 4], [0, 10]], dtype=float)   # concave
    pts = rng.uniform(-2, 12, (4000, 2))
    assert np.array_equal(an.points_in_polygon(pts[:, 0], pts[:, 1], poly), MplPath(poly).contains_points(pts))
    assert not an.points_in_polygon(pts[:, 0], pts[:, 1], poly[:2]).any()
    P = rng.uniform(0, 100, (300, 2))
    target = rng.random(300) < 0.2
    d = np.linalg.norm(P[:, None, :] - P[None, target, :], axis=2)
    assert np.allclose(an.nearest_distance(P, target), d.min(axis=1))
    other = d.copy()
    other[np.flatnonzero(target), np.arange(target.sum())] = np.inf          # a target point is not its own neighbor
    assert np.allclose(an.nearest_distance(P, target, exclude_self=True), other.min(axis=1))
    assert np.isinf(an.nearest_distance(P, np.zeros(300, bool))).all()
    one = np.zeros(300, bool)
    one[7] = True
    assert np.isinf(an.nearest_distance(P, one, exclude_self=True)[7])
    W = an.knn_graph(P, 6).toarray()
    full = np.linalg.norm(P[:, None, :] - P[None, :, :], axis=2)
    np.fill_diagonal(full, np.inf)
    want = np.zeros_like(W)
    np.put_along_axis(want, np.argsort(full, axis=1)[:, :6], 1.0, axis=1)
    assert np.array_equal(W, want)
    assert an.knn_graph(P[:3], 6).toarray().sum() == 6 and an.knn_graph(P[:1], 6).nnz == 0
    twins = np.array([[0.0, 0.0], [0.0, 0.0], [0.0, 0.0], [5.0, 5.0]])
    G = an.knn_graph(twins, 2).toarray()
    assert (G.sum(axis=1) == 2).all() and not np.diag(G).any()
    D = an.delaunay_graph(P)
    assert np.allclose(np.asarray(D.sum(axis=1)).ravel(), 1.0) and (D != D.T).nnz > 0 and ((D > 0) != (D.T > 0)).nnz == 0


def test_binned_density_and_numbers():
    rng = np.random.default_rng(6)
    v = rng.gamma(2.0, 1.0, 5000)
    d = an.binned_density(v, 0.0, float(v.max()))
    centres = (np.arange(an.GRID) + 0.5) * v.max() / an.GRID
    assert len(d) == an.GRID and np.isclose(d.sum(), 1.0) and (d >= 0).all()
    assert abs((d * centres).sum() - v.mean()) < 0.15
    assert an.binned_density(np.zeros(10), 0.0, 0.0)[0] == 1.0 and not an.binned_density([], 0.0, 1.0).any()
    assert an.five_numbers([]) == [None] * 7 and an.five_numbers([1, 2, 3, 4, 5])[3] == 3
    assert an.finite([1.23456, np.nan, np.inf], 2) == [1.23, None, None]
    assert np.allclose(an.significant([0.000123456, 123456.0, 0.0, 1e-300]), [0.0001235, 123500.0, 0.0, 1e-300])
    assert an.number(float("nan")) is None and an.number(1.23456, 2) == 1.23
    with pytest.raises(ValueError):
        an.table([("a", "A", "int"), ("b", "B", "int")], {"a": [1, 2], "b": [1]})


# ============================================================================
# RAW COUNTS OF A CONTEXT
# ============================================================================

def test_expression_joins_sections_by_gene_name(world, ctx):
    E = ctx.expression()
    assert E.genes == world["genes"] and E.n_unmatched == 5 and np.array_equal(E.matched, world["matched"])
    assert np.array_equal(E.total, world["total"])
    g1, g64 = world["genes"].index("G1"), world["genes"].index("G64")       # G64: only section B has it
    used, missing, cols = E.resolve(["g1", "G64", "Nope", "G1"])
    assert used == ["G1", "G64"] and missing == ["Nope"] and cols == [g1, g64] and g64 >= 60
    every = list(range(len(world["genes"])))
    assert np.array_equal(E.counts(every), world["dense"])
    assert np.array_equal(E.counts([g64, g1]), world["dense"][:, [g64, g1]])
    assert not E.counts([g64])[world["sample"] == 0].any() and E.counts([g64]).any()
    assert E.counts([]).shape == (len(world["x"]), 0)
    rng = np.random.default_rng(8)
    units = rng.permutation(np.flatnonzero(world["matched"]))[:150]           # both sections, any order
    assert np.array_equal(E.matrix(units).toarray(), world["dense"][units])
    only_b = np.flatnonzero(world["matched"] & (world["sample"] == 1))[::-1]
    assert np.array_equal(E.matrix(only_b).toarray(), world["dense"][only_b])
    assert E.matrix([]).shape == (0, len(world["genes"]))
    with pytest.raises(ValueError):
        E.matrix(np.flatnonzero(~world["matched"])[:1])
    # sections with the same genes need no column mapping
    same = an.Expression(240, [world["parts"][0]])
    units = np.flatnonzero(same.matched)[:40]
    assert same.genes == world["sections"]["A"].genes
    assert np.array_equal(same.matrix(units).toarray(), world["dense"][units, :60])


def test_context_fields_and_conditions(world, ctx):
    assert ctx.field_keys() == ["sample", "cell", "positive_alpha", "in_region_of_interest"]
    sample = ctx.field("sample")
    assert sample.text("A") == "control" and np.array_equal(sample.select(["B"], "x"), world["sample"] == 1)
    cell = ctx.field("cell")
    assert np.array_equal(cell.select(["gamma", "alpha"], "x"), np.isin(world["cell"], [0, 2]))
    assert cell.normalise(["gamma", "alpha", "gamma"], "x") == ["alpha", "gamma"]
    call = ctx.field("positive_alpha")
    assert np.array_equal(call.select([False], "x"), ~world["positive"]) and call.text(True) == "positive"
    assert np.array_equal(call.select(["yes"], "x"), world["positive"])
    assert an.field_label("positive_osteoblast_pooled_depthmatched") == "osteoblast (pooled, depth-matched)"
    assert an.field_label("assigned_signature") == "Cell type" and an.field_label("region:Lesion") == "Lesion"
    assert an.bool_text("in_region_of_interest") == ("inside", "outside")
    detects = an.condition_mask(ctx, {"genes": ["G1", "g7"]}, "x")
    want = world["dense"][:, [world["genes"].index("G1"), world["genes"].index("G7")]].sum(axis=1) > 0
    assert np.array_equal(detects, want)
    lacks = an.condition_mask(ctx, {"genes": ["G1", "G7"], "detected": False}, "x")
    assert np.array_equal(lacks, ~want & world["matched"])
    scope = an.scope_mask(ctx, {"samples": ["A"], "roi": True, "where": [{"field": "cell", "values": ["beta"]}]})
    assert np.array_equal(scope, (world["sample"] == 0) & world["roi"] & (world["cell"] == 1))
    assert an.scope_text(ctx, {"samples": ["A"], "roi": True, "where": [{"field": "cell", "values": ["beta"]}]}) == \
        "control; region of interest; Cell: beta"
    assert an.scope_mask(ctx, None).all() and an.scope_text(ctx, None) == "all sections"
    for bad, text in (
            ({"field": "nope", "values": ["x"]}, "no field"), ({"field": "cell", "values": ["delta"]}, "no value"),
            ({"field": "cell", "values": []}, "at least one value"), ({"field": "cell"}, "at least one value"),
            ({"field": "positive_alpha", "values": ["maybe"]}, "yes/no"), ({"genes": ["Nope"]}, "none of these genes"),
            ({"genes": []}, "give 1 to"), ({"field": ""}, "choose a field")):
        with pytest.raises(an.ToolError, match=text):
            an.condition_mask(ctx, bad, "x")
    with pytest.raises(an.ToolError, match="no bin is left"):
        an.scope_mask(ctx, {"where": [{"field": "cell", "values": ["alpha"]}, {"field": "cell", "values": ["beta"]}]})
    with pytest.raises(an.ToolError, match="at most"):
        an.get_conditions([{}] * 13, "x")
    assert an.get_genes("Ctsk, Acp5 +Ctsk;Mmp9", 1, 5, "x") == ["Ctsk", "Acp5", "Mmp9"]


def test_regions_are_fields(world):
    left = an.Region("g-00000001", "Edge", "A", [np.array([[-1, -1], [40, -1], [40, 1000], [-1, 1000]], float)])
    also = an.Region("g-00000002", "Edge", "B", [np.array([[-1, -1], [1000, -1], [1000, 20], [-1, 20]], float),
                                                  np.array([[200, 100], [1000, 100], [1000, 1000], [200, 1000]], float)])
    ctx = make_context(world, regions=[left, also, an.Region("g-00000003", "Gone", "Z", [np.zeros((3, 2))])])
    assert ctx.region_names() == ["Edge", "Gone"] and ctx.field_keys()[-2:] == ["region:Edge", "region:Gone"]
    f = ctx.field("region:Edge")
    x, y, s = world["x"], world["y"], world["sample"]
    want = ((s == 0) & (x < 40)) | ((s == 1) & ((y < 20) | ((x > 200) & (y > 100))))
    assert f.kind == "bool" and np.array_equal(f.values, want) and f.text(True) == "inside"
    assert not ctx.field("region:Gone").values.any()                         # a section the run does not have
    with pytest.raises(an.ToolError, match="no region"):
        ctx.field("region:Nope")
    res = an.run_tool("composition", ctx, {"count": {"calls": ["region:Edge"]}})[0]
    assert res["cells"][0]["n"] == [int((want & (s == 0)).sum())]


# ============================================================================
# TOOLS
# ============================================================================

def test_tool_expression(world, ctx):
    res, arrays = an.run_tool("expression", ctx, {
        "genes": ["G1", "g7", "Nope"], "group_by": {"field": "cell"}, "split_by": {"field": "sample"}})
    assert arrays == {} and res["genes"] == ["G1", "G7"] and res["missing"] == ["Nope"]
    assert [g["label"] for g in res["groups"]] == ["alpha · control", "alpha · treated", "beta · control",
                                                   "beta · treated", "gamma · control", "gamma · treated"]
    assert res["groups"][0]["color"] == "#aa0000" and res["groups"][2]["color"] is None
    lognorm, dense, ok = world["lognorm"], world["dense"], world["matched"]
    for j, gene in enumerate(res["genes"]):
        g = world["genes"].index(gene)
        for k, group in enumerate(res["groups"]):
            cell_i, sample_i = divmod(k, 2)
            m = ok & (world["cell"] == cell_i) & (world["sample"] == sample_i)
            d = res["stats"][j]["groups"][k]
            assert d["n"] == group["n"] == int(m.sum())
            assert d["n_detected"] == int((dense[m, g] > 0).sum())
            assert np.isclose(d["mean"], lognorm[m, g].mean(), atol=1e-4)
            assert np.isclose(d["pct"], 100 * (dense[m, g] > 0).mean(), atol=0.01)
            assert np.isclose(d["q"][3], np.median(lognorm[m, g]), atol=1e-4)
            assert np.isclose(d["mean_cp"], (dense[m, g] * 1e4 / world["total"][m]).mean(), atol=1e-3)
            assert len(d["density"]) == an.GRID and np.isclose(sum(d["density"]), 1.0, atol=1e-3)
        assert np.isclose(res["stats"][j]["max"], lognorm[ok & (world["cell"] >= 0), g].max(), atol=1e-4)
    assert res["table"]["rows"] == 12 and list(col(res, "gene")[:6]) == ["G1"] * 6
    assert any("Not in the data: Nope" in n for n in res["notes"]) and any("not in the raw data" in n for n in res["notes"])
    assert any("differ in depth" in n for n in res["notes"])                 # section A is 1.6 times deeper
    json.dumps(res, allow_nan=False)
    # one group field, chosen values, the region of interest only
    res = an.run_tool("expression", ctx, {"genes": ["G1"], "group_by": {"field": "cell", "values": ["gamma", "alpha"]},
                                          "scope": {"roi": True, "samples": ["B"]}})[0]
    assert [g["label"] for g in res["groups"]] == ["alpha", "gamma"] and res["scope"] == "treated; region of interest"
    m = ok & world["roi"] & (world["sample"] == 1) & (world["cell"] == 0)
    assert res["groups"][0]["n"] == int(m.sum())
    res = an.run_tool("expression", ctx, {"genes": ["G1"], "group_by": {"field": "positive_alpha"}})[0]
    assert [g["label"] for g in res["groups"]] == ["alpha: positive", "alpha: negative"]
    for bad, text in (({"genes": [], "group_by": {"field": "cell"}}, "give 1 to 50 genes"),
                      ({"genes": ["Nope"], "group_by": {"field": "cell"}}, "none of these genes"),
                      ({"genes": ["G1"]}, "choose a field"),
                      ({"genes": ["G1"], "group_by": {"field": "cell"}, "split_by": {"field": "cell"}}, "another field"),
                      ({"genes": ["G1"], "group_by": {"field": "cell"}, "scope": []}, "scope must be"),
                      ({"genes": ["G1"], "group_by": {"field": "cell"}, "scope": {"samples": ["Z"]}}, "no value")):
        with pytest.raises(an.ToolError, match=text):
            an.run_tool("expression", ctx, bad)


def test_tool_de(world, ctx):
    params = {"a": [{"field": "cell", "values": ["alpha"]}], "b": [{"field": "cell", "values": ["beta", "gamma"]}],
              "scope": {"samples": ["A"]}, "min_bins": 3}
    res = an.run_tool("de", ctx, params)[0]
    ok = world["matched"] & (world["sample"] == 0)
    a, b = ok & (world["cell"] == 0), ok & np.isin(world["cell"], [1, 2])
    assert res["a"] == {"label": "Cell: alpha", "n": int(a.sum()), "median_umi": res["a"]["median_umi"]}
    assert res["b"]["n"] == int(b.sum()) and res["method"] == "Wilcoxon rank-sum" and res["statistic"] == "z"
    genes, lognorm, dense, total = world["genes"], world["lognorm"], world["dense"], world["total"]
    detected = (dense[a | b] > 0).sum(axis=0)
    tested = [g for g, n in zip(genes, detected) if n >= 3]
    assert sorted(col(res, "gene")) == sorted(tested) and res["n_tested"] == len(tested)
    assert col(res, "gene")[0] == "G1"                                       # the gene planted in alpha comes first
    p = col(res, "p").astype(float)
    assert (np.diff(p) >= 0).all()
    from statsmodels.stats.multitest import multipletests
    assert np.allclose(col(res, "fdr").astype(float), multipletests(p, method="fdr_bh")[1], rtol=1e-3)
    for i in (0, 1, 5, len(tested) - 1):
        g = genes.index(col(res, "gene")[i])
        xa, xb = lognorm[a, g], lognorm[b, g]
        assert np.isclose(col(res, "stat")[i], z_of(xa, xb), atol=1e-3)
        want = stats.mannwhitneyu(xa, xb, use_continuity=False, method="asymptotic").pvalue
        assert np.isclose(p[i], want, rtol=1e-3)
        cp_a, cp_b = (dense[a, g] * 1e4 / total[a]).mean(), (dense[b, g] * 1e4 / total[b]).mean()
        assert np.isclose(col(res, "log2fc")[i], np.log2((cp_a + 1) / (cp_b + 1)), atol=1e-4)
        assert np.isclose(col(res, "pct_a")[i], 100 * (dense[a, g] > 0).mean(), atol=0.01)
        assert np.isclose(col(res, "mean_b")[i], xb.mean(), atol=1e-4)
    assert res["n_up"] >= 1 and INDEPENDENT in res["notes"][0]
    # group B left empty: every other bin of the scope; a bin in both groups is in neither
    rest = an.run_tool("de", ctx, {"a": params["a"], "scope": {"samples": ["A"]}})[0]
    assert rest["b"] == {"label": "every other bin of the scope", "n": int((ok & (world["cell"] != 0)).sum()),
                         "median_umi": rest["b"]["median_umi"]}
    overlap = an.run_tool("de", ctx, {"a": [{"field": "cell", "values": ["alpha", "beta"]}],
                                      "b": [{"field": "cell", "values": ["beta", "gamma"]}]})[0]
    okk = world["matched"]
    assert overlap["n_both"] == int((world["cell"] == 1).sum())
    assert overlap["a"]["n"] == int((okk & (world["cell"] == 0)).sum())
    assert overlap["b"]["n"] == int((okk & (world["cell"] == 2)).sum())
    assert any("match both groups" in n for n in overlap["notes"])
    # the other test and the uncorrected ranks
    welch = an.run_tool("de", ctx, {**params, "method": "t-test"})[0]
    i = list(col(welch, "gene")).index("G1")
    g = genes.index("G1")
    want = stats.ttest_ind(lognorm[a, g], lognorm[b, g], equal_var=False)
    assert welch["statistic"] == "t" and np.isclose(col(welch, "stat")[i], want.statistic, atol=1e-3)
    raw = an.run_tool("de", ctx, {**params, "ties": "scanpy"})[0]
    i_raw, i_cor = list(col(raw, "gene")).index("G1"), list(col(res, "gene")).index("G1")
    assert abs(col(raw, "stat")[i_raw]) < abs(col(res, "stat")[i_cor])
    assert any("No tie correction" in n for n in raw["notes"])
    # conditions on genes
    by_gene = an.run_tool("de", ctx, {"a": [{"genes": ["G1"]}], "b": [{"genes": ["G1"], "detected": False}]})[0]
    assert by_gene["a"]["label"] == "detects G1" and by_gene["b"]["label"] == "does not detect G1"
    assert by_gene["a"]["n"] + by_gene["b"]["n"] == int(world["matched"].sum())
    for bad, text in (({}, "add at least one condition"),
                      ({"a": [{"field": "cell", "values": ["alpha"]}], "b": [{"field": "cell", "values": ["alpha"]}]},
                       "at least two in each"),
                      ({**params, "method": "anova"}, "Test must be one of"),
                      ({**params, "min_bins": 0}, "whole number from 1"),
                      ({**params, "min_bins": 100000}, "no gene is detected")):
        with pytest.raises(an.ToolError, match=text):
            an.run_tool("de", ctx, bad)


INDEPENDENT = "independent observation"


def test_tool_composition(world, ctx):
    from statsmodels.stats.proportion import proportion_confint
    res = an.run_tool("composition", ctx, {"count": {"field": "cell"}})[0]
    assert res["exclusive"] and [s["label"] for s in res["series"]] == ["alpha", "beta", "gamma"]
    assert [g["label"] for g in res["groups"]] == ["control", "treated"]
    for k, sid in enumerate((0, 1)):
        m = world["sample"] == sid
        cell = res["cells"][k]
        assert cell["total"] == int(m.sum())
        assert cell["n"] == [int((m & (world["cell"] == c)).sum()) for c in range(3)]
        for c in range(3):
            lo, hi = proportion_confint(cell["n"][c], cell["total"], method="wilson")
            assert np.isclose(cell["pct"][c], 100 * cell["n"][c] / cell["total"], atol=1e-3)
            assert np.isclose(cell["lo"][c], 100 * lo, atol=1e-3) and np.isclose(cell["hi"][c], 100 * hi, atol=1e-3)
        assert sum(cell["pct"]) < 100                                         # bins without a cell type count in the total
    listed = an.run_tool("composition", ctx, {"count": {"field": "cell", "values": ["alpha", "beta"]},
                                              "denominator": "listed", "across": {"field": "sample", "values": ["B"]},
                                              "scope": {"roi": True}})[0]
    m = (world["sample"] == 1) & world["roi"] & np.isin(world["cell"], [0, 1])
    assert listed["cells"][0]["total"] == int(m.sum()) and np.isclose(sum(listed["cells"][0]["pct"]), 100, atol=1e-2)
    calls = an.run_tool("composition", ctx, {"count": {"calls": ["positive_alpha", "in_region_of_interest"]},
                                             "across": {"field": "cell"}})[0]
    assert not calls["exclusive"] and [s["label"] for s in calls["series"]] == ["alpha", "Region of interest"]
    assert calls["cells"][0]["n"][0] == int((world["positive"] & (world["cell"] == 0)).sum())
    assert calls["cells"][1]["n"][0] == 0 and calls["table"]["rows"] == 6
    for bad, text in (({}, "choose a field"), ({"count": {"field": "positive_alpha"}}, "yes/no field"),
                      ({"count": {"calls": ["cell"]}}, "not a yes/no call"),
                      ({"count": {"field": "cell"}, "denominator": "some"}, "Share of must be one of")):
        with pytest.raises(an.ToolError, match=text):
            an.run_tool("composition", ctx, bad)


def test_tools_coexpression_and_gene_pair(world, ctx):
    res = an.run_tool("coexpression", ctx, {"gene": "G7", "min_bins": 10})[0]
    ok = world["matched"]
    lognorm, genes = world["lognorm"][ok], world["genes"]
    assert res["gene"] == "G7" and res["n"] == int(ok.sum()) and col(res, "gene")[0] == "G8"
    assert "G7" not in col(res, "gene") and (np.diff(col(res, "r").astype(float)) <= 0).all()
    y = lognorm[:, genes.index("G7")]
    for i in (0, 3, res["table"]["rows"] - 1):
        g = genes.index(col(res, "gene")[i])
        assert np.isclose(col(res, "r")[i], np.corrcoef(lognorm[:, g], y)[0, 1], atol=1e-4)
    detected = (world["dense"][ok] > 0).sum(axis=0)
    assert res["n_tested"] == int((detected >= 10).sum()) - 1
    with pytest.raises(an.ToolError, match="same expression in every bin"):
        an.run_tool("coexpression", ctx, {"gene": "G30"})
    with pytest.raises(an.ToolError, match="is not in the data"):
        an.run_tool("coexpression", ctx, {"gene": "Nope"})

    pair = an.run_tool("gene_pair", ctx, {"x": "G7", "y": "g8"})[0]
    x, yv = lognorm[:, genes.index("G7")], lognorm[:, genes.index("G8")]
    assert (pair["x"], pair["y"], pair["n"]) == ("G7", "G8", int(ok.sum()))
    assert np.isclose(pair["overall"]["r"], np.corrcoef(x, yv)[0, 1], atol=1e-4)
    assert np.isclose(pair["overall"]["rho"], stats.spearmanr(x, yv)[0], atol=1e-4)
    o = pair["overall"]
    assert o["both"] + o["only_x"] + o["only_y"] + o["neither"] == o["n"] == int(ok.sum())
    assert o["both"] == int(((x > 0) & (yv > 0)).sum()) and o["odds_ratio"] > 1
    assert np.array(pair["density"]).shape == (an.DENSITY_2D,) * 2 and np.array(pair["density"]).sum() == o["n"]
    assert list(col(pair, "group")) == ["all sections", "control", "treated"]
    assert sum(col(pair, "n")[1:]) == o["n"]
    with pytest.raises(an.ToolError, match="two different genes"):
        an.run_tool("gene_pair", ctx, {"x": "G7", "y": "g7"})
    with pytest.raises(an.ToolError, match="not in the data: Nope"):
        an.run_tool("gene_pair", ctx, {"x": "G7", "y": "Nope"})


def test_tool_distance_follows_the_manuscript_null(world, ctx):
    """Observed and null distances as bone_analysis.uncoupling_metric computes them: one random generator for all
    sections, the same numbers of A and B bins drawn among the bins of the scope; and the shares within the radius as
    bone_analysis.proximity_table."""
    params = {"a": [{"field": "cell", "values": ["alpha"]}], "b": [{"field": "cell", "values": ["gamma"]}],
              "scope": {"roi": True}, "n_perm": 29, "radius_um": 80, "seed": 3}
    res = an.run_tool("distance", ctx, params)[0]
    rng = np.random.default_rng(3)
    xy_all = np.column_stack([world["x"], world["y"]])
    for k, sid in enumerate((0, 1)):
        m = world["roi"] & (world["sample"] == sid)
        xy, a, b = xy_all[m], world["cell"][m] == 0, world["cell"][m] == 2
        d_obs = cKDTree(xy[b]).query(xy[a])[0]
        null = []
        for _ in range(29):
            ia = rng.choice(len(xy), int(a.sum()), replace=False)
            ib = rng.choice(len(xy), int(b.sum()), replace=False)
            null.append(cKDTree(xy[ib]).query(xy[ia])[0].mean())
        null = np.array(null)
        row = {key: col(res, key)[k] for key in res["table"]["data"]}
        assert (row["status"], row["n_a"], row["n_b"], row["n_scope"]) == ("estimable", a.sum(), b.sum(), m.sum())
        assert np.isclose(row["mean_um"], d_obs.mean(), atol=1e-3)
        assert np.isclose(row["median_um"], np.median(d_obs), atol=1e-3)
        assert np.isclose(row["null_mean_um"], null.mean(), atol=1e-3)
        assert np.isclose(row["ratio"], d_obs.mean() / null.mean(), atol=1e-3)
        assert np.isclose(row["ratio_lo"], d_obs.mean() / np.percentile(null, 97.5), atol=1e-3)
        assert np.isclose(row["p_farther"], (np.sum(null >= d_obs.mean()) + 1) / 30, atol=1e-4)
        assert np.isclose(row["p_closer"], (np.sum(null <= d_obs.mean()) + 1) / 30, atol=1e-4)
        to_b = cKDTree(xy[b]).query(xy)[0]
        assert np.isclose(row["pct_a_within"], 100 * (to_b[a] <= 80).mean(), atol=1e-3)
        assert np.isclose(row["pct_all_within"], 100 * (to_b <= 80).mean(), atol=1e-3)
        assert row["ratio"] > 1.5 and row["p_farther"] <= 0.05                # alpha and gamma lie at opposite ends
        hist = res["histograms"][k]
        assert sum(hist["observed"]) == hist["n_observed"] == a.sum() and len(hist["null"]) == an.HIST_BINS
    # a group in both: its own nearest bin unless told otherwise; a section with too few bins is not estimable
    same = an.run_tool("distance", ctx, {"a": params["a"], "b": params["a"], "n_perm": 0})[0]
    assert set(col(same, "mean_um")) == {0.0} and (col(same, "n_both") == col(same, "n_a")).all()
    assert col(same, "ratio")[0] is None and "null" not in same["histograms"][0]
    other = an.run_tool("distance", ctx, {"a": params["a"], "b": params["a"], "n_perm": 5, "exclude_self": True})[0]
    assert set(col(other, "mean_um")) == {PITCH}                              # the next alpha bin is one bin away
    few = an.run_tool("distance", ctx, {**params, "scope": None, "n_perm": 3, "min_bins": 60})[0]
    assert col(few, "status")[0] == "estimable" and col(few, "status")[1].startswith("not estimable")
    assert col(few, "mean_um")[1] is None and len(few["histograms"]) == 1
    for bad, text in (({**params, "min_bins": 1000}, "no section has at least"), ({"a": params["a"]}, "add at least"),
                      ({**params, "n_perm": 5000}, "from 0 to 999"), ({**params, "exclude_self": "no"}, "true or false")):
        with pytest.raises(an.ToolError, match=text):
            an.run_tool("distance", ctx, bad)
    stop = make_context(world, cancelled=lambda: True)
    with pytest.raises(an.Cancelled):
        an.run_tool("distance", stop, params)


def test_tool_neighborhood(world, ctx):
    res = an.run_tool("neighborhood", ctx, {"field": {"field": "cell"}, "k": 4, "n_perm": 30, "seed": 1})[0]
    assert [c["label"] for c in res["categories"]] == ["alpha", "beta", "gamma"]
    assert [s["section"] for s in res["sections"]] == ["all sections", "control", "treated"]
    xy_all = np.column_stack([world["x"], world["y"]])
    for k, sid in enumerate((0, 1)):
        m = world["sample"] == sid
        lab = world["cell"][m]
        W = an.knn_graph(xy_all[m], 4).toarray()
        want = np.zeros((3, 3), dtype=int)
        for i, j in zip(*np.nonzero(W)):
            if lab[i] >= 0 and lab[j] >= 0:
                want[lab[i], lab[j]] += 1
        sec = res["sections"][k + 1]
        assert sec["observed"] == want.tolist() and sec["n"] == int(m.sum())
        assert sec["counts"] == [int((lab == c).sum()) for c in range(3)]
        z = np.array(sec["z"], dtype=float)
        assert (np.diag(z) > 3).all() and z[0, 2] < -2 and z[2, 0] < -2      # patches: themselves, never the far end
    total = np.array(res["sections"][0]["observed"])
    assert (total == np.array(res["sections"][1]["observed"]) + np.array(res["sections"][2]["observed"])).all()
    assert res["table"]["rows"] == 27
    two = an.run_tool("neighborhood", ctx, {"field": {"field": "cell", "values": ["alpha", "gamma"]},
                                            "scope": {"samples": ["A"]}, "n_perm": 10})[0]
    assert len(two["sections"]) == 1 and np.array(two["sections"][0]["observed"]).shape == (2, 2)
    for bad, text in (({"field": {"field": "positive_alpha"}}, "yes/no field"),
                      ({"field": {"field": "cell", "values": ["alpha"]}}, "at least two values"),
                      ({"field": "cell", "n_perm": 2}, "from 10 to 999"), ({}, "choose a field")):
        with pytest.raises(an.ToolError, match=text):
            an.run_tool("neighborhood", ctx, bad)


def test_tool_score(world, ctx):
    res, arrays = an.run_tool("score", ctx, {"genes": ["G7", "G8", "Nope"], "name": "Beta program",
                                              "group_by": {"field": "cell"}, "scope": {"samples": ["A", "B"]}})
    assert res["name"] == "Beta program" and res["genes"] == ["G7", "G8"] and res["missing"] == ["Nope"]
    assert res["n_control"] > 0 and [m["array"] for m in res["maps"]] == ["score:A", "score:B"]
    assert set(arrays) == {"score:A", "score:B"}
    for sid, code in (("A", 0), ("B", 1)):
        values = arrays[f"score:{sid}"]
        here = world["sample"] == code
        assert len(values) == int(here.sum())                                 # one value per bin of the section, in order
        assert np.array_equal(np.isfinite(values), world["matched"][here])
    full = np.concatenate([arrays["score:A"], arrays["score:B"]])
    ok = world["matched"]
    for k, c in enumerate(range(3)):
        m = ok & (world["cell"] == c)
        assert res["groups"][k]["n"] == int(m.sum())
        assert np.isclose(res["stats"][k]["mean"], full[m].mean(), atol=1e-3)
    means = [s["mean"] for s in res["stats"]]
    assert means[1] > means[0] + 0.3 and means[1] > means[2] + 0.3           # the genes that rise in beta
    assert np.isclose(res["min"], np.nanmin(full), atol=1e-3) and np.isclose(res["max"], np.nanmax(full), atol=1e-3)
    json.dumps(res, allow_nan=False)
    only_a = an.run_tool("score", ctx, {"genes": ["G7", "G8"], "scope": {"samples": ["A"]}})
    assert list(only_a[1]) == ["score:A"] and only_a[0]["name"] == "Gene set"
    assert [g["label"] for g in only_a[0]["groups"]] == ["control"]
    for bad, text in (({"genes": ["G7"]}, "give 2 to 500 genes"), ({"genes": ["G7", "Nope"]}, "fewer than two")):
        with pytest.raises(an.ToolError, match=text):
            an.run_tool("score", ctx, bad)


def test_tool_svg(world, ctx):
    res = an.run_tool("svg", ctx, {"min_bins": 10, "top": 15})[0]
    assert [s["section"] for s in res["sections"]] == ["control", "treated"]
    xy_all = np.column_stack([world["x"], world["y"]])
    for sid, label in ((0, "control"), (1, "treated")):
        units = np.flatnonzero(world["matched"] & (world["sample"] == sid))
        X = world["lognorm"][units]
        idx = np.flatnonzero((world["dense"][units] > 0).sum(axis=0) >= 10)
        score, z, p = an.morans_i(sparse.csc_matrix(X[:, idx]), an.delaunay_graph(xy_all[units]))
        rows = np.flatnonzero(col(res, "section") == label)
        assert len(rows) == 15 and list(col(res, "rank")[rows]) == list(range(1, 16))
        order = np.argsort(-score, kind="stable")[:15]
        assert list(col(res, "gene")[rows]) == [world["genes"][j] for j in idx[order]]
        assert np.allclose(col(res, "I")[rows].astype(float), score[order], atol=1e-4)
        assert np.allclose(col(res, "fdr")[rows].astype(float), an.bh_adjust(p)[order], rtol=1e-3)
        sec = res["sections"][sid]
        assert (sec["status"], sec["n"], sec["n_tested"]) == ("done", len(units), len(idx))
        assert {"G7", "G8"} <= set(col(res, "gene")[rows][:6])               # the planted patterns
    assert "G1" in col(res, "gene")[col(res, "section") == "control"]         # section B has no G1
    assert {"G7", "G8"} <= set(res["shared"]) and res["n_shared"] == len(res["shared"])
    one = an.run_tool("svg", ctx, {"scope": {"samples": ["B"]}, "top": 5})[0]
    assert len(one["sections"]) == 1 and one["shared"] == [] and one["table"]["rows"] == 5
    with pytest.raises(an.ToolError, match="no section could be tested"):
        an.run_tool("svg", ctx, {"min_bins": 100000})


def test_tool_table_chart(world):
    df = pd.DataFrame({"gene": ["a", "b", None], "I": [0.5, np.nan, 0.1], "rank": [1, 2, 3], "ok": [True, False, True]})
    ctx = make_context(world, tables=lambda name: df, table_names=["morans.csv"])
    res = an.run_tool("table_chart", ctx, {"file": "morans.csv", "x": "rank", "y": "I", "label": "gene",
                                           "color": "ok", "kind": "bars"})[0]
    assert (res["kind"], res["x"], res["y"], res["color"], res["label"], res["n_rows"]) == \
        ("bars", "rank", "I", "ok", "gene", 3)
    assert res["table"]["data"] == {"rank": [1.0, 2.0, 3.0], "I": [0.5, None, 0.1], "ok": [True, False, True],
                                    "gene": ["a", "b", None]}
    assert [c["type"] for c in res["table"]["columns"]] == ["number", "number", "bool", "text"]
    for bad, text in (({"file": "other.csv", "x": "rank", "y": "I"}, "choose one of the run's result tables"),
                      ({"file": "morans.csv", "x": "rank"}, "Y: choose a column"),
                      ({"file": "morans.csv", "x": "rank", "y": "nope"}, "no column"),
                      ({"file": "morans.csv", "x": "rank", "y": "gene"}, "is not a number"),
                      ({"file": "morans.csv", "x": "rank", "y": "I", "kind": "pie"}, "Chart must be one of")):
        with pytest.raises(an.ToolError, match=text):
            an.run_tool("table_chart", ctx, bad)
    with pytest.raises(an.ToolError, match="no result tables"):
        an.run_tool("table_chart", make_context(world), {"file": "morans.csv", "x": "rank", "y": "I"})


def test_registry_and_csv(world, ctx):
    ids = [t.id for t in an.TOOLS]
    assert ids == ["expression", "de", "composition", "coexpression", "gene_pair", "score", "distance",
                   "neighborhood", "svg", "table_chart"] and len(set(ids)) == len(ids)
    types = {"genes", "gene", "grouping", "conditions", "scope", "count", "category", "int", "float", "choice", "bool",
             "text", "table", "column"}
    for t in an.TOOLS:
        d = json.loads(json.dumps(t.describe()))
        assert d["title"] and d["summary"] and d["group"] and isinstance(d["expression"], bool)
        keys = [p["key"] for p in d["params"]]
        assert len(set(keys)) == len(keys) and all(p["type"] in types and p["label"] for p in d["params"]), t.id
        for p in d["params"]:
            if p["type"] == "choice":
                assert p["default"] in [o[0] for o in p["options"]]
    with pytest.raises(an.ToolError, match="no analysis tool"):
        an.run_tool("nope", ctx, {})
    with pytest.raises(an.ToolError, match="must be an object"):
        an.run_tool("de", ctx, [])
    res = an.run_tool("composition", ctx, {"count": {"field": "cell"}})[0]
    lines = an.result_csv(res).split("\n")
    assert lines[0] == "Group,Cell,Bins,Of,%,\"95% CI, low\",\"95% CI, high\"" and len(lines) == 8 and lines[-1] == ""
    assert lines[1].startswith("control,alpha,")
    with pytest.raises(an.ToolError, match="no table"):
        an.result_csv({})
    # a context without raw counts: the tools that need none still work, the others say why
    bare = an.Context(samples=[{"id": "A", "label": "a"}], sample_codes=np.zeros(4, int), x=np.arange(4.0),
                      y=np.zeros(4), fields={"cell": an.Field("cell", "category", ["u", "v"], np.array([0, 0, 1, 1]))},
                      no_expression="the raw data moved")
    assert an.run_tool("composition", bare, {"count": {"field": "cell"}})[0]["cells"][0]["n"] == [2, 2]
    with pytest.raises(an.ToolError, match="the raw data moved"):
        an.run_tool("expression", bare, {"genes": ["G1"], "group_by": {"field": "cell"}})
