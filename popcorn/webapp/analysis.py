"""
webapp/analysis.py
==================
The tools of a run's Analysis tab (docs/ARCHITECTURE.md, section 8). A finished run leaves a per-bin table (section,
position, region of interest, cell type, tissue class, Leiden domain, positivity calls) and the raw counts of its
sections; each tool answers one kind of question on them with the settings chosen when it is used, so that no analysis
is fixed before the run:

    expression    expression of chosen genes in groups of bins (violin, box, dot plot, heatmap)
    de            differential expression between two groups of bins (Wilcoxon rank-sum or Welch's t)
    composition   share of each cell type, domain or positivity call per section or group
    coexpression  genes whose expression follows a gene
    gene_pair     two genes against each other
    distance      distance from one group of bins to the nearest bin of another, against random placement
    neighborhood  which categories lie next to each other more often than chance
    score         score of a gene set in every bin, by group and on the map
    svg           spatially variable genes (Moran's I)
    table_chart   a chart of any result table of the run

The manuscript's fixed analyses are instances of these tools (Figure 4h: `de`; Figure 4i and the proximity tables:
`distance`; Figures 4g and 6a: `composition`; Figure 6b and S4: `expression`; Figure S2: `svg`), computed here with
numpy and scipy only, because the server never imports scanpy. Where a tool follows a step of bone_analysis.py its
docstring says how; tests/test_analysis_tools.py checks the statistics against scipy, statsmodels and scanpy.

A tool is a function run(ctx, params) -> result (JSON data; optionally {"result": ..., "arrays": {name: array}} for
per-bin values kept beside the card). It raises ToolError, with a message that says what to change, when the request
cannot be computed. `ctx` is a Context: the bins of the run and their fields, the regions drawn on it and, through an
Expression, the raw counts. Nothing here knows about HTTP or the workspace (webapp/server.py does).
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field as dataclass_field
from typing import Callable

import numpy as np
import pandas as pd
from scipy import sparse, stats
from scipy.spatial import Delaunay, QhullError, cKDTree

MAX_GENES = 50               # genes of one expression chart, of one condition
MAX_SET_GENES = 500            # genes of one gene set (score)
MAX_GROUPS = 80                # groups of one chart
MAX_PERMUTATIONS = 999
MAX_CONDITIONS = 12
GRID = 48                      # points of a density curve
HIST_BINS = 40                 # cells of a distance histogram
DENSITY_2D = 32                # cells per axis of a two-gene density
RANK_CHUNK_NNZ = 3_000_000     # stored values ranked at a time (bounds the memory of the rank-sum test)
MORAN_CHUNK_NNZ = 1_500_000    # stored values multiplied with the neighbor graph at a time
TABLE_CHART_ROWS = 20_000      # rows of a result table a chart may draw
DEPTH_NOTE_RATIO = 1.5         # groups whose median UMIs differ by this factor get a note
POOLED_RE = re.compile(r"_pooled(_depthmatched)?$")
FIELD_LABELS = {
    "sample": "Section", "tissue_class": "Tissue class", "assigned_signature": "Cell type",
    "leiden_domain": "Leiden domain", "in_region_of_interest": "Region of interest", "in_lesion": "Lesion",
}
BOOL_TEXT = {"in_region_of_interest": ("inside", "outside")}
REGION_PREFIX = "region:"
INDEPENDENCE_NOTE = ("P values treat every bin as an independent observation. Neighboring bins are correlated, so "
                     "they are optimistic: rank genes by effect size and check them on the map.")


class ToolError(Exception):
    """The analysis cannot be computed as asked; the message says what to change (HTTP 422)."""


class Cancelled(Exception):
    """The card of the analysis was deleted while it ran."""


# ============================================================================
# NUMBERS FOR JSON
# ============================================================================

def finite(values, digits: int | None = None) -> list:
    """A float array as a JSON list: rounded to `digits` decimals when given, NaN and infinities as None."""
    a = np.asarray(values, dtype=np.float64)
    if digits is not None:
        a = np.round(a, digits)
    out = a.tolist()
    if not np.isfinite(a).all():
        out = [v if math.isfinite(v) else None for v in out]
    return out


def significant(values, digits: int = 4) -> np.ndarray:
    """Rounded to `digits` significant digits, so that a P value keeps its order of magnitude."""
    a = np.asarray(values, dtype=np.float64)
    out = a.copy()
    ok = np.isfinite(a) & (np.abs(a) > 1e-290)
    if ok.any():
        mag = np.power(10.0, digits - 1 - np.floor(np.log10(np.abs(a[ok]))))
        out[ok] = np.round(a[ok] * mag) / mag
    return out


def number(value, digits: int | None = None):
    """One float for JSON: None when it is not finite."""
    if value is None:
        return None
    v = float(value)
    if not math.isfinite(v):
        return None
    return round(v, digits) if digits is not None else v


def table(columns: list[tuple[str, str, str]], data: dict[str, list]) -> dict:
    """A result table by column: columns = [(key, label, "text" | "number" | "int" | "bool")], data[key] = values of
    that column. The Analysis tab lists it under the chart and the server writes it as CSV."""
    n = len(next(iter(data.values()))) if data else 0
    for key, _, _ in columns:
        if len(data[key]) != n:
            raise ValueError(f"column {key} has {len(data[key])} values, expected {n}")
    return {"columns": [{"key": k, "label": lab, "type": kind} for k, lab, kind in columns], "rows": n,
            "data": {k: data[k] for k, _, _ in columns}}


# ============================================================================
# STATISTICS
# ============================================================================

def bh_adjust(p) -> np.ndarray:
    """Benjamini-Hochberg adjusted P values over the defined ones (NaN stays NaN), as
    statsmodels.stats.multitest.multipletests(method="fdr_bh")."""
    p = np.asarray(p, dtype=np.float64)
    out = np.full(p.shape, np.nan)
    idx = np.flatnonzero(np.isfinite(p))
    if len(idx):
        order = idx[np.argsort(p[idx], kind="stable")]
        q = p[order] * len(order) / np.arange(1, len(order) + 1)
        out[order] = np.minimum(1.0, np.minimum.accumulate(q[::-1])[::-1])
    return out


def wilson_interval(k, n, alpha: float = 0.05) -> tuple[np.ndarray, np.ndarray]:
    """Wilson score interval of k successes in n trials, as fractions (NaN where n is 0): the interval
    bone_analysis.positivity_table reports (statsmodels' proportion_confint(method="wilson"))."""
    k = np.asarray(k, dtype=np.float64)
    n = np.asarray(n, dtype=np.float64)
    z = stats.norm.isf(alpha / 2)
    with np.errstate(divide="ignore", invalid="ignore"):
        p = k / n
        denom = 1 + z * z / n
        center = (p + z * z / (2 * n)) / denom
        half = z * np.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    lo = np.where(n > 0, np.clip(center - half, 0.0, 1.0), np.nan)
    hi = np.where(n > 0, np.clip(center + half, 0.0, 1.0), np.nan)
    return lo, hi


def lognorm(X, total, target_sum: float = 1e4) -> sparse.csr_matrix:
    """log1p(counts / UMIs of the bin * target_sum) of a counts matrix (bins x genes), as scanpy's normalize_total
    and log1p in bone_analysis.normalize_and_cluster; `total` is each bin's UMIs over all genes. A bin without counts
    stays empty."""
    total = np.asarray(total, dtype=np.float64)
    scale = np.divide(float(target_sum), total, out=np.zeros_like(total), where=total > 0)
    Y = (sparse.diags(scale) @ sparse.csr_matrix(X, dtype=np.float64)).tocsr()
    Y.eliminate_zeros()
    Y.data = np.log1p(Y.data)
    return Y


def rank_sum_test(X, in_a, ties: str = "corrected", chunk_nnz: int = RANK_CHUNK_NNZ):
    """Wilcoxon rank-sum (Mann-Whitney U) test of every column of X (bins x genes; values >= 0, the zeros not stored)
    between the bins `in_a` and the other bins: (z, two-sided P from the normal approximation, U of group a).

    The zeros of a gene all share the lowest rank, so only its stored values are sorted (columns of at most
    `chunk_nnz` stored values at a time, which bounds the memory). ties:
      corrected  the variance is reduced for tied ranks, as scipy.stats.mannwhitneyu(method="asymptotic",
                 use_continuity=False): right for counts, where most bins tie at zero
      scanpy     no tie correction, as scanpy.tl.rank_genes_groups(method="wilcoxon") with its default
                 tie_correct=False, which bone_analysis.compare_osteoclast_states uses (Figure 4h); |z| is smaller
    A gene with the same value in every bin has z 0 and P 1."""
    if ties not in ("corrected", "scanpy"):
        raise ValueError(f"ties must be corrected or scanpy, got {ties!r}")
    X = sparse.csc_matrix(X)
    n, n_genes = X.shape
    in_a = np.asarray(in_a, dtype=bool)
    n_a = int(in_a.sum())
    n_b = n - n_a
    per_gene = np.diff(X.indptr).astype(np.int64)
    u = np.full(n_genes, n_a * n_b / 2.0)
    var = np.zeros(n_genes)
    if ties == "scanpy":
        var[:] = n_a * n_b * (n + 1) / 12.0
    start = 0
    while start < n_genes:
        # as many whole columns as fit in the chunk (at least one)
        stop = int(np.searchsorted(X.indptr, X.indptr[start] + chunk_nnz, side="right")) - 1
        stop = min(n_genes, max(stop, start + 1))
        s, e = int(X.indptr[start]), int(X.indptr[stop])
        k = stop - start
        n0 = (n - per_gene[start:stop]).astype(np.float64)        # zeros of each gene: tied at the lowest ranks
        tie_sum = n0 ** 3 - n0
        rank_a = np.zeros(k)
        stored_a = np.zeros(k)
        if e > s:
            d = np.asarray(X.data[s:e], dtype=np.float64)
            if d.min() < 0:
                raise ValueError("the rank-sum test needs values of 0 or more")
            g = np.repeat(np.arange(k), per_gene[start:stop])
            order = np.lexsort((d, g))
            d, g = d[order], g[order]
            a = in_a[X.indices[s:e][order]]
            new = np.ones(len(d), dtype=bool)
            new[1:] = (g[1:] != g[:-1]) | (d[1:] != d[:-1])
            first = np.flatnonzero(new)                            # first stored value of each group of ties
            size = np.diff(np.append(first, len(d))).astype(np.float64)
            before = first - (X.indptr[start:stop] - s)[g[first]]  # stored values of the gene below the group
            average = before + (size + 1) / 2.0                    # its rank among the gene's stored values
            rank = n0[g] + average[np.cumsum(new) - 1]
            rank_a = np.bincount(g[a], weights=rank[a], minlength=k)
            stored_a = np.bincount(g[a], minlength=k).astype(np.float64)
            tie_sum = tie_sum + np.bincount(g[first], weights=size ** 3 - size, minlength=k)
        rank_sum = rank_a + (n_a - stored_a) * (n0 + 1) / 2.0
        u[start:stop] = rank_sum - n_a * (n_a + 1) / 2.0
        if ties == "corrected" and n > 1:
            var[start:stop] = n_a * n_b / 12.0 * ((n + 1) - tie_sum / (n * (n - 1.0)))
        start = stop
    ok = var > 1e-12
    z = np.zeros(n_genes)
    z[ok] = (u[ok] - n_a * n_b / 2.0) / np.sqrt(var[ok])
    p = np.ones(n_genes)
    p[ok] = 2 * stats.norm.sf(np.abs(z[ok]))
    return z, p, u


def welch_test(X, in_a):
    """Welch's t test (unequal variances) of every column of X (bins x genes) between the bins `in_a` and the others,
    from sparse sums: (t, two-sided P), as scipy.stats.ttest_ind(equal_var=False). A gene constant in both groups has
    t 0 and P 1."""
    X = sparse.csr_matrix(X, dtype=np.float64)
    a = np.asarray(in_a, dtype=bool).astype(np.float64)
    b = 1.0 - a
    n_a, n_b = a.sum(), b.sum()
    X2 = X.multiply(X)
    m_a, m_b = (X.T @ a) / n_a, (X.T @ b) / n_b
    with np.errstate(divide="ignore", invalid="ignore"):
        v_a = np.maximum(0.0, (X2.T @ a) - n_a * m_a ** 2) / (n_a - 1)
        v_b = np.maximum(0.0, (X2.T @ b) - n_b * m_b ** 2) / (n_b - 1)
        se2 = v_a / n_a + v_b / n_b
        t = (m_a - m_b) / np.sqrt(se2)
        df = se2 ** 2 / ((v_a / n_a) ** 2 / (n_a - 1) + (v_b / n_b) ** 2 / (n_b - 1))
    ok = np.isfinite(t) & np.isfinite(df) & (se2 > 1e-300)
    p = np.ones(X.shape[1])
    p[ok] = 2 * stats.t.sf(np.abs(t[ok]), df[ok])
    return np.where(ok, t, 0.0), p


def pearson_columns(X, y):
    """Pearson correlation of every column of X (sparse, bins x genes) with the vector y, from sparse sums: (r,
    two-sided P of the t test with n - 2 degrees of freedom). A constant column has r 0 and P 1."""
    X = sparse.csr_matrix(X, dtype=np.float64)
    y = np.asarray(y, dtype=np.float64)
    n = X.shape[0]
    s1 = np.asarray(X.sum(axis=0)).ravel()
    s2 = np.asarray(X.multiply(X).sum(axis=0)).ravel()
    sxy = np.asarray(X.T @ y).ravel()
    mean_x, mean_y = s1 / n, y.mean()
    var_x, var_y = s2 / n - mean_x ** 2, y.var()
    with np.errstate(divide="ignore", invalid="ignore"):
        r = (sxy / n - mean_x * mean_y) / np.sqrt(var_x * var_y)
    ok = np.isfinite(r) & (var_x > 1e-12) & (var_y > 1e-12)
    r = np.where(ok, np.clip(r, -1.0, 1.0), 0.0)
    p = np.ones(X.shape[1])
    if n > 2:
        with np.errstate(divide="ignore", invalid="ignore"):
            t = r * np.sqrt((n - 2) / np.maximum(1e-300, 1 - r ** 2))
        p[ok] = 2 * stats.t.sf(np.abs(t[ok]), n - 2)
    return r, p


def binned_density(values, lo: float, hi: float, n_grid: int = GRID) -> np.ndarray:
    """The distribution of `values` on n_grid cells from lo to hi for a violin: their counts per cell smoothed with a
    Gaussian kernel of Scott's bandwidth (a binned kernel density estimate, mirrored at both ends so that no mass
    leaves the range), as shares that sum to 1."""
    v = np.asarray(values, dtype=np.float64)
    v = v[np.isfinite(v)]
    out = np.zeros(n_grid)
    if not len(v) or not hi > lo:
        if len(v):
            out[0] = 1.0
        return out
    counts = np.histogram(v, bins=np.linspace(lo, hi, n_grid + 1))[0].astype(np.float64)
    step = (hi - lo) / n_grid
    sigma = max(0.6, 1.06 * float(v.std()) * len(v) ** -0.2 / step)
    radius = min(n_grid - 1, int(math.ceil(3 * sigma)))
    kernel = np.exp(-0.5 * (np.arange(-radius, radius + 1) / sigma) ** 2)
    smooth = np.convolve(np.pad(counts, radius, mode="symmetric"), kernel / kernel.sum(), mode="valid")
    total = smooth.sum()
    return smooth / total if total > 0 else out


def five_numbers(values) -> list:
    """[minimum, 5th, 25th, 50th, 75th, 95th percentile, maximum] of the finite values (None when there is none)."""
    v = np.asarray(values, dtype=np.float64)
    v = v[np.isfinite(v)]
    if not len(v):
        return [None] * 7
    return finite(np.percentile(v, [0, 5, 25, 50, 75, 95, 100]), 4)


def points_in_polygon(x, y, polygon) -> np.ndarray:
    """True for the points inside a polygon (its vertices as an N x 2 array; even-odd rule, a point on an edge may
    count either way)."""
    x = np.asarray(x, dtype=np.float64)
    y = np.asarray(y, dtype=np.float64)
    poly = np.asarray(polygon, dtype=np.float64).reshape(-1, 2)
    inside = np.zeros(len(x), dtype=bool)
    if len(poly) < 3:
        return inside
    box = (x >= poly[:, 0].min()) & (x <= poly[:, 0].max()) & (y >= poly[:, 1].min()) & (y <= poly[:, 1].max())
    px, py = x[box], y[box]
    hit = np.zeros(len(px), dtype=bool)
    xj, yj = poly[-1]
    for xi, yi in poly:
        if yi != yj:
            hit ^= ((yi > py) != (yj > py)) & (px < (xj - xi) * (py - yi) / (yj - yi) + xi)
        xj, yj = xi, yi
    inside[box] = hit
    return inside


def nearest_distance(P, target, exclude_self: bool = False) -> np.ndarray:
    """Distance from every point of P to the nearest target point (as bone_analysis._nearest_target_distance); with
    exclude_self a target point is measured to the nearest other target point. No target point: infinite."""
    target = np.asarray(target, dtype=bool)
    n_t = int(target.sum())
    if n_t == 0:
        return np.full(len(P), np.inf)
    tree = cKDTree(P[target])
    if not exclude_self:
        return tree.query(P, k=1)[0]
    k = 2 if n_t > 1 else 1
    d = np.asarray(tree.query(P, k=k)[0]).reshape(len(P), k)
    out = d[:, 0].copy()
    out[target] = d[target, 1] if k == 2 else np.inf
    return out


def knn_graph(xy, k: int) -> sparse.csr_matrix:
    """n x n 0/1 matrix: row i marks the k nearest other points of point i (fewer when there are not k others)."""
    n = len(xy)
    kk = min(k + 1, n)
    if n == 0 or kk < 2:
        return sparse.csr_matrix((n, n), dtype=np.float64)
    idx = np.asarray(cKDTree(xy).query(xy, k=kk)[1]).reshape(n, kk)
    rows = np.repeat(np.arange(n), kk)
    cols = idx.ravel()
    keep = cols != rows
    # a point with a twin at the same position may not come first among its own neighbors: drop one entry per row
    extra = np.bincount(rows[keep], minlength=n) > kk - 1
    if extra.any():
        last = np.zeros(len(rows), dtype=bool)
        last[np.arange(n) * kk + kk - 1] = True
        keep &= ~(last & extra[rows])
    return sparse.csr_matrix((np.ones(int(keep.sum())), (rows[keep], cols[keep])), shape=(n, n))


def delaunay_graph(xy) -> sparse.csr_matrix:
    """The Delaunay graph of the points, every row scaled to sum to 1: the graph of bone_analysis._morans_i_builtin
    (squidpy's spatial_neighbors(coord_type="generic", delaunay=True))."""
    xy = np.asarray(xy, dtype=np.float64)
    n = len(xy)
    indptr, indices = Delaunay(xy).vertex_neighbor_vertices
    g = sparse.csr_matrix((np.ones(len(indices)), indices, indptr), shape=(n, n))
    rows = np.asarray(g.sum(axis=1)).ravel()
    return (sparse.diags(np.divide(1.0, rows, out=np.zeros(n), where=rows > 0)) @ g).tocsr()


def morans_i(X, W, chunk_nnz: int = MORAN_CHUNK_NNZ):
    """Moran's I of every column of X (sparse, bins x genes) on the graph W (weights, bins x bins), as
    scanpy.metrics.morans_i, with squidpy's analytic P value under normality, as bone_analysis._morans_i_builtin
    reports them: (I, z, P one-sided in the direction of z). A constant gene has I, z and P NaN.

    With m the gene's mean, sum_ij w_ij (x_i - m)(x_j - m) = x'Wx - m (r'x + c'x) + m^2 S0 (r, c: the row and column
    sums of W; S0 their total), so the matrix stays sparse; W @ X is taken a few genes at a time."""
    X = sparse.csc_matrix(X, dtype=np.float64)
    W = sparse.csr_matrix(W, dtype=np.float64)
    n, n_genes = X.shape
    s0 = W.sum()
    r, c = np.asarray(W.sum(axis=1)).ravel(), np.asarray(W.sum(axis=0)).ravel()
    mean = np.asarray(X.sum(axis=0)).ravel() / n
    centered = np.asarray(X.multiply(X).sum(axis=0)).ravel() - n * mean ** 2
    xwx = np.zeros(n_genes)
    start = 0
    while start < n_genes:
        stop = int(np.searchsorted(X.indptr, X.indptr[start] + chunk_nnz, side="right")) - 1
        stop = min(n_genes, max(stop, start + 1))
        part = X[:, start:stop]
        xwx[start:stop] = np.asarray((W @ part).multiply(part).sum(axis=0)).ravel()
        start = stop
    numerator = xwx - mean * (np.asarray(X.T @ r).ravel() + np.asarray(X.T @ c).ravel()) + mean ** 2 * s0
    with np.errstate(divide="ignore", invalid="ignore"):
        score = np.where(centered > 1e-12, n / s0 * numerator / centered, np.nan)
    t = W.T + W
    s1 = t.multiply(t).sum() / 2.0
    s2 = float(((r + c) ** 2).sum())
    v_norm = (n * n * s1 - n * s2 + 3 * s0 * s0) / ((n - 1) * (n + 1) * s0 * s0) - (1.0 / (n - 1)) ** 2
    with np.errstate(invalid="ignore"):
        z = (score - (-1.0 / (n - 1))) / math.sqrt(v_norm) if v_norm > 0 else np.full(n_genes, np.nan)
        p = np.where(z > 0, stats.norm.sf(z), stats.norm.cdf(z))
    p[np.isnan(z)] = np.nan
    return score, z, p


def score_gene_set(Xn, cols, ctrl_size: int = 50, n_bins: int = 25, seed: int = 0):
    """Per-bin score of a gene set as Seurat's AddModuleScore and scanpy's score_genes (bone_analysis.score_all): the
    mean log-normalized expression of the set's genes minus that of control genes, drawn `ctrl_size` at a time from
    each of the `n_bins` bins of average expression that hold a gene of the set (the set's own genes left out).
    Xn: log-normalized expression (bins x genes); cols: the columns of the set. Returns (score, control columns).
    The control genes are drawn with numpy's Generator(seed), not as scanpy draws them, so a score differs slightly
    from the pipeline's score of the same genes."""
    Xn = sparse.csc_matrix(Xn, dtype=np.float64)
    n, n_genes = Xn.shape
    cols = np.unique(np.asarray(cols, dtype=np.int64))
    average = np.asarray(Xn.mean(axis=0)).ravel()
    per_bin = max(1, int(round(n_genes / (n_bins - 1))))
    cut = stats.rankdata(average, method="min").astype(np.int64) // per_bin
    rng = np.random.default_rng(seed)
    control = []
    for c in np.unique(cut[cols]):
        pool = np.flatnonzero(cut == c)
        if ctrl_size < len(pool):
            pool = rng.choice(pool, ctrl_size, replace=False)
        control.append(pool)
    control = np.setdiff1d(np.concatenate(control), cols) if control else np.zeros(0, dtype=np.int64)
    score = np.asarray(Xn[:, cols].mean(axis=1)).ravel()
    if len(control):
        score = score - np.asarray(Xn[:, control].mean(axis=1)).ravel()
    return score, control


# ============================================================================
# THE BINS OF A RUN
# ============================================================================

def field_label(key: str) -> str:
    """Display name of a per-bin field (as fieldLabel of the spatial viewer, shortened)."""
    if key in FIELD_LABELS:
        return FIELD_LABELS[key]
    if key.startswith(REGION_PREFIX):
        return key[len(REGION_PREFIX):]          # a region goes by its own name ("Lesion: inside")
    if key.startswith("positive_"):
        raw = key[len("positive_"):]
        m = POOLED_RE.search(raw)
        name = raw[:m.start()] if m else raw
        suffix = (" (pooled, depth-matched)" if m.group(1) else " (pooled)") if m else ""
        return f"{name.replace('_', ' ')}{suffix}"
    text = key.replace("_", " ")
    return text[:1].upper() + text[1:]


def bool_text(key: str) -> tuple[str, str]:
    """What the two values of a yes/no field are called."""
    if key in BOOL_TEXT:
        return BOOL_TEXT[key]
    if key.startswith(REGION_PREFIX):
        return "inside", "outside"
    return ("positive", "negative") if key.startswith("positive_") else ("yes", "no")


@dataclass
class Field:
    """A per-bin field a tool can group or filter by. kind "category": `codes` holds each bin's position in
    `categories` (-1: no value), `labels` the display text of a category when it differs (sections); kind "bool":
    `values` holds each bin's True or False."""
    key: str
    kind: str
    categories: list = dataclass_field(default_factory=list)
    codes: np.ndarray | None = None
    values: np.ndarray | None = None
    colors: dict = dataclass_field(default_factory=dict)
    labels: dict = dataclass_field(default_factory=dict)

    @property
    def label(self) -> str:
        return field_label(self.key)

    def text(self, value) -> str:
        """Display text of one value."""
        if self.kind == "bool":
            return bool_text(self.key)[0 if value else 1]
        return str(self.labels.get(value, value))

    def options(self) -> list:
        return [True, False] if self.kind == "bool" else list(self.categories)

    def mask_of(self, value) -> np.ndarray:
        if self.kind == "bool":
            return self.values if value else ~self.values
        return self.codes == self.categories.index(value)

    def normalise(self, values, what: str) -> list:
        """The requested values of this field as its own values, in the field's order; ToolError when one is not a
        value of the field or none is given."""
        if not isinstance(values, (list, tuple)) or not values:
            raise ToolError(f"{what}: choose at least one value of {self.label}")
        out = []
        for v in values:
            if self.kind == "bool":
                if isinstance(v, str) and v.strip().lower() in ("true", "yes", "1", "false", "no", "0"):
                    v = v.strip().lower() in ("true", "yes", "1")
                if not isinstance(v, bool):
                    raise ToolError(f"{what}: {self.label} is a yes/no field; its values are true and false")
            else:
                v = str(v) if not isinstance(v, str) else v
                if v not in self.categories:
                    raise ToolError(f"{what}: {self.label} has no value {v!r} in this run")
            if v not in out:
                out.append(v)
        order = self.options()
        return sorted(out, key=order.index)

    def select(self, values, what: str) -> np.ndarray:
        """True for the bins whose value is one of `values`."""
        mask = np.zeros(len(self.values if self.kind == "bool" else self.codes), dtype=bool)
        for v in self.normalise(values, what):
            mask |= self.mask_of(v)
        return mask


@dataclass
class Region:
    """A region drawn on one section in the Analysis tab: polygons in the per-bin table's micrometres. Regions of the
    same name in several sections are one group."""
    id: str
    name: str
    sample: str
    polygons: list
    color: str | None = None


class Expression:
    """The raw counts of the bins of a context, read from the sections the run analysed.

    parts: [(units, rows, section)], one per section: `units` the positions of its bins in the context, `rows` each
    one's row in `section` (-1: the raw data has no such bin), `section` an object with X (bins x genes counts, by
    gene: CSC), genes (names) and total (UMIs of every bin over all genes); webapp.server.RawSection is one. Sections
    with different genes are joined by name, a gene absent from a section counting 0 there, as the analysis joins
    them (anndata.concat(join="outer"))."""

    def __init__(self, n_units: int, parts: list):
        self.n = n_units
        self.parts = parts
        self.genes: list[str] = []
        index: dict[str, int] = {}
        self._maps = []                                   # per part: its columns as columns of the joint gene list
        for _, _, section in parts:
            cols = np.empty(len(section.genes), dtype=np.int64)
            for j, g in enumerate(section.genes):
                at = index.get(g)
                if at is None:
                    at = index[g] = len(self.genes)
                    self.genes.append(g)
                cols[j] = at
            self._maps.append(cols)
        self._exact = index
        self._folded: dict[str, int] = {}
        for g, j in index.items():
            self._folded.setdefault(g.casefold(), j)
        self._same = all(len(m) == len(self.genes) and np.array_equal(m, np.arange(len(m))) for m in self._maps)
        self.part_of = np.full(n_units, -1, dtype=np.int64)
        self.row_of = np.full(n_units, -1, dtype=np.int64)
        self.total = np.zeros(n_units, dtype=np.float64)
        for i, (units, rows, section) in enumerate(parts):
            units, rows = np.asarray(units, dtype=np.int64), np.asarray(rows, dtype=np.int64)
            ok = rows >= 0
            self.part_of[units[ok]] = i
            self.row_of[units[ok]] = rows[ok]
            self.total[units[ok]] = np.asarray(section.total, dtype=np.float64)[rows[ok]]
        self.matched = self.part_of >= 0
        self._by_bin: dict[int, sparse.csr_matrix] = {}

    @property
    def n_unmatched(self) -> int:
        return int((~self.matched).sum())

    def resolve(self, names: list[str]) -> tuple[list[str], list[str], list[int]]:
        """(genes used, names not found, their columns): an exact name, else the first gene of that name in any case;
        each gene once (as RawSection.resolve)."""
        used, missing, cols = [], [], []
        for name in names:
            col = self._exact.get(name)
            if col is None:
                col = self._folded.get(name.casefold())
            if col is None:
                missing.append(name)
            elif col not in cols:
                cols.append(col)
                used.append(self.genes[col])
        return used, missing, cols

    def counts(self, cols: list[int]) -> np.ndarray:
        """Counts of a few genes in every bin of the context (bins x len(cols), int64; 0 where the raw data has no
        such bin)."""
        out = np.zeros((self.n, len(cols)), dtype=np.int64)
        for i, (_, _, section) in enumerate(self.parts):
            units = np.flatnonzero(self.part_of == i)
            if not len(units):
                continue
            local = {int(g): j for j, g in enumerate(self._maps[i])}
            have = [(k, local[c]) for k, c in enumerate(cols) if c in local]
            if not have:
                continue
            block = section.X[:, [j for _, j in have]].tocsr()[self.row_of[units]]
            out[np.ix_(units, [k for k, _ in have])] = block.toarray()
        return out

    def matrix(self, units) -> sparse.csr_matrix:
        """Counts of every gene (the joint gene list) in the given bins, in their order (bins x genes, float64). Every
        bin must have raw data (`matched`)."""
        units = np.asarray(units, dtype=np.int64)
        if len(units) and not self.matched[units].all():
            raise ValueError("matrix() takes bins that have raw data only")
        blocks, order = [], []
        for i, (_, _, section) in enumerate(self.parts):
            at = np.flatnonzero(self.part_of[units] == i)
            if not len(at):
                continue
            by_bin = self._by_bin.get(i)
            if by_bin is None:
                by_bin = self._by_bin[i] = section.X.tocsr()
            block = by_bin[self.row_of[units[at]]].astype(np.float64)
            if not self._same:
                block = sparse.csr_matrix((block.data, self._maps[i][block.indices], block.indptr),
                                          shape=(block.shape[0], len(self.genes)))
                block.sort_indices()
            blocks.append(block)
            order.append(at)
        if not blocks:
            return sparse.csr_matrix((0, len(self.genes)), dtype=np.float64)
        if len(blocks) == 1 and np.array_equal(order[0], np.arange(len(units))):
            return blocks[0]
        stacked = sparse.vstack(blocks, format="csr")
        back = np.empty(len(units), dtype=np.int64)
        back[np.concatenate(order)] = np.arange(len(units))
        return stacked[back]


class Context:
    """What a tool sees of a run: its bins (section, position, fields), the regions drawn on it and its raw counts.

    samples: [{"id", "label"}] in the run's order; sample_codes: each bin's position in `samples`; x, y: bin centres
    in micrometres; fields: {key: Field} of the per-bin table; expression: an Expression, or None with `no_expression`
    saying why the raw data cannot be read; total_umi: UMIs per bin as the run counted them (the per-bin table);
    target_sum: the run's normalization target; tables: name -> DataFrame of a result table of the run (table_chart);
    cancelled: a function that is true once the analysis is no longer wanted."""

    def __init__(self, *, samples: list[dict], sample_codes, x, y, fields: dict[str, Field],
                 expression: Expression | Callable[[], Expression] | None = None, no_expression: str = "",
                 regions: list[Region] | None = None, total_umi=None, target_sum: float = 1e4, unit: str = "bin",
                 tables: Callable | None = None, table_names: list[str] | None = None,
                 cancelled: Callable[[], bool] | None = None):
        self.samples = samples
        self.sample_codes = np.asarray(sample_codes, dtype=np.int64)
        self.n = len(self.sample_codes)
        self.x = np.asarray(x, dtype=np.float64)
        self.y = np.asarray(y, dtype=np.float64)
        self.regions = list(regions or [])
        self.total_umi = None if total_umi is None else np.asarray(total_umi, dtype=np.float64)
        self.target_sum = float(target_sum)
        self.unit = unit
        self.tables = tables
        self.table_names = list(table_names or [])
        self._expression = expression
        self._no_expression = no_expression
        self._cancelled = cancelled
        self._fields = dict(fields)
        self._fields["sample"] = Field("sample", "category", [s["id"] for s in samples], self.sample_codes,
                                       labels={s["id"]: s.get("label") or s["id"] for s in samples},
                                       colors={s["id"]: s["color"] for s in samples if s.get("color")})
        self._region_fields: dict[str, Field] = {}

    # ---- fields
    @property
    def units(self) -> str:
        return f"{self.unit}s"

    def region_names(self) -> list[str]:
        return list(dict.fromkeys(r.name for r in self.regions))

    def field_keys(self) -> list[str]:
        return ["sample", *[k for k in self._fields if k != "sample"],
                *[REGION_PREFIX + name for name in self.region_names()]]

    def field(self, key, what: str = "field") -> Field:
        if not isinstance(key, str) or not key:
            raise ToolError(f"{what}: choose a field")
        if key in self._fields:
            return self._fields[key]
        if key.startswith(REGION_PREFIX):
            name = key[len(REGION_PREFIX):]
            if name not in self._region_fields:
                drawn = [r for r in self.regions if r.name == name]
                if not drawn:
                    raise ToolError(f"{what}: there is no region {name!r} in this run (it may have been deleted)")
                inside = np.zeros(self.n, dtype=bool)
                ids = [s["id"] for s in self.samples]
                for r in drawn:
                    if r.sample not in ids:
                        continue
                    here = np.flatnonzero(self.sample_codes == ids.index(r.sample))
                    hit = np.zeros(len(here), dtype=bool)
                    for polygon in r.polygons:
                        hit |= points_in_polygon(self.x[here], self.y[here], polygon)
                    inside[here[hit]] = True
                self._region_fields[name] = Field(key, "bool", values=inside,
                                                  colors={True: drawn[0].color} if drawn[0].color else {})
            return self._region_fields[name]
        raise ToolError(f"{what}: this run has no field {key!r}")

    # ---- raw counts
    def expression(self) -> Expression:
        if callable(self._expression):
            self._expression = self._expression()
        if self._expression is None:
            raise ToolError(self._no_expression or "the raw counts of this run cannot be read, and this analysis "
                                                   "needs them")
        return self._expression

    def check(self) -> None:
        """Raise Cancelled when the analysis is no longer wanted (called between the steps of a long computation)."""
        if self._cancelled is not None and self._cancelled():
            raise Cancelled()


# ============================================================================
# REQUEST PARAMETERS
# ============================================================================

def _number(p: dict, key: str, default, lo, hi, what: str, integer: bool):
    v = p.get(key, default)
    if v is None and default is None:
        return None
    ok = isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(float(v))
    if ok and integer and not float(v).is_integer():
        ok = False
    if not ok or not lo <= v <= hi:
        kind = "a whole number" if integer else "a number"
        raise ToolError(f"{what} must be {kind} from {lo:g} to {hi:g}")
    return int(v) if integer else float(v)


def get_int(p: dict, key: str, default, lo, hi, what: str) -> int:
    return _number(p, key, default, lo, hi, what, True)


def get_float(p: dict, key: str, default, lo, hi, what: str) -> float:
    return _number(p, key, default, lo, hi, what, False)


def get_choice(p: dict, key: str, choices: tuple, default: str, what: str) -> str:
    v = p.get(key, default)
    if v not in choices:
        raise ToolError(f"{what} must be one of: {', '.join(choices)}")
    return v


def get_bool(p: dict, key: str, default: bool, what: str) -> bool:
    v = p.get(key, default)
    if not isinstance(v, bool):
        raise ToolError(f"{what} must be true or false")
    return v


def get_genes(value, lo: int, hi: int, what: str) -> list[str]:
    """Gene names of a request: a list (or one text with names separated by commas, blanks, + or ;), each once."""
    if isinstance(value, str):
        value = [t for t in re.split(r"[\s,;+]+", value) if t]
    if not isinstance(value, (list, tuple)):
        value = []
    names = []
    for v in value:
        if not isinstance(v, str) or not v.strip() or len(v.strip()) > 200:
            raise ToolError(f"{what}: every gene must be a name of 1 to 200 characters")
        names.append(v.strip())
    names = list(dict.fromkeys(names))
    if not lo <= len(names) <= hi:
        need = f"{lo}" if lo == hi else f"{lo} to {hi}"
        raise ToolError(f"{what}: give {need} gene{'s' if hi > 1 else ''}"
                        + (f" ({len(names)} given)" if names else ""))
    return names


def get_conditions(value, what: str, required: bool = False) -> list[dict]:
    if value is None:
        value = []
    if not isinstance(value, list) or not all(isinstance(c, dict) for c in value):
        raise ToolError(f"{what} must be a list of conditions")
    if required and not value:
        raise ToolError(f"{what}: add at least one condition (a field and its values, or genes)")
    if len(value) > MAX_CONDITIONS:
        raise ToolError(f"{what}: at most {MAX_CONDITIONS} conditions")
    return value


def condition_mask(ctx: Context, cond: dict, what: str) -> np.ndarray:
    """The bins one condition selects: {"field", "values"} (the bins whose field has one of the values) or
    {"genes", "detected": true | false} (the bins with a count of any of the genes; false: with none of them, among
    the bins that have raw data)."""
    if "genes" in cond:
        names = get_genes(cond.get("genes"), 1, MAX_GENES, what)
        E = ctx.expression()
        used, missing, cols = E.resolve(names)
        if not used:
            raise ToolError(f"{what}: none of these genes is in the data: {', '.join(missing)}")
        detected = E.counts(cols).sum(axis=1) > 0
        return detected if cond.get("detected", True) is not False else (~detected & E.matched)
    return ctx.field(cond.get("field"), what).select(cond.get("values"), what)


def conditions_mask(ctx: Context, conds: list[dict], what: str) -> np.ndarray:
    mask = np.ones(ctx.n, dtype=bool)
    for cond in conds:
        mask &= condition_mask(ctx, cond, what)
    return mask


def conditions_text(ctx: Context, conds: list[dict]) -> str:
    """One line saying what a list of conditions selects."""
    parts = []
    for cond in conds:
        if "genes" in cond:
            names = get_genes(cond.get("genes"), 1, MAX_GENES, "genes")
            verb = "detects" if cond.get("detected", True) is not False else "does not detect"
            parts.append(f"{verb} {' or '.join(names)}")
        else:
            f = ctx.field(cond.get("field"))
            parts.append(f"{f.label}: {', '.join(f.text(v) for v in f.normalise(cond.get('values'), f.label))}")
    return "; ".join(parts) if parts else f"all {ctx.units}"


def scope_mask(ctx: Context, scope) -> np.ndarray:
    """The bins an analysis works on: {"samples": [ids] (default: every section), "roi": true (only the bins of the
    run's region of interest), "where": [conditions]}."""
    if scope is None:
        scope = {}
    if not isinstance(scope, dict):
        raise ToolError("scope must be an object")
    mask = np.ones(ctx.n, dtype=bool)
    if scope.get("samples"):
        mask &= ctx.field("sample").select(scope["samples"], "Sections")
    if scope.get("roi"):
        if "in_region_of_interest" not in ctx.field_keys():
            raise ToolError("this run has no region of interest")
        mask &= ctx.field("in_region_of_interest").values
    mask &= conditions_mask(ctx, get_conditions(scope.get("where"), "Only bins where"), "Only bins where")
    if not mask.any():
        raise ToolError(f"no {ctx.unit} is left in the scope of the analysis: widen the sections or conditions")
    return mask


def scope_text(ctx: Context, scope) -> str:
    scope = scope or {}
    parts = []
    if scope.get("samples"):
        f = ctx.field("sample")
        parts.append(", ".join(f.text(v) for v in f.normalise(scope["samples"], "Sections")))
    else:
        parts.append("all sections" if len(ctx.samples) > 1 else ctx.field("sample").text(ctx.samples[0]["id"]))
    if scope.get("roi"):
        parts.append("region of interest")
    if scope.get("where"):
        parts.append(conditions_text(ctx, scope["where"]))
    return "; ".join(parts)


@dataclass
class Group:
    key: str
    label: str
    mask: np.ndarray
    color: str | None = None

    @property
    def n(self) -> int:
        return int(self.mask.sum())


def groups_of(ctx: Context, spec, scope: np.ndarray, what: str, split=None) -> list[Group]:
    """The groups of a grouping {"field", "values" (default: every value)} inside `scope`, each crossed with the
    values of `split` (the same shape) when given; groups without a bin are left out."""
    def one(s, label):
        if not isinstance(s, dict):
            raise ToolError(f"{label}: choose a field")
        f = ctx.field(s.get("field"), label)
        values = f.normalise(s["values"], label) if s.get("values") else f.options()
        return f, values

    f, values = one(spec, what)
    inner = one(split, "Split by") if split else None
    if inner and inner[0].key == f.key:
        raise ToolError("Split by: choose another field than the groups'")
    groups = []
    for v in values:
        base = scope & f.mask_of(v)
        color = f.colors.get(v)
        if inner is None:
            groups.append(Group(str(v), f.text(v) if f.kind != "bool" else f"{f.label}: {f.text(v)}", base, color))
            continue
        g, inner_values = inner
        for w in inner_values:
            text = g.text(w) if g.kind != "bool" else f"{g.label}: {g.text(w)}"
            name = f.text(v) if f.kind != "bool" else f"{f.label}: {f.text(v)}"
            groups.append(Group(f"{v}|{w}", f"{name} · {text}", base & g.mask_of(w), color))
    groups = [g for g in groups if g.n]
    if not groups:
        raise ToolError(f"{what}: no {ctx.unit} is in any of the groups (check the scope and the chosen values)")
    if len(groups) > MAX_GROUPS:
        raise ToolError(f"{what}: {len(groups)} groups; choose at most {MAX_GROUPS} (pick values of the field)")
    return groups


def depth_note(ctx: Context, groups: list[tuple[str, np.ndarray]]) -> tuple[list, str | None]:
    """(median UMIs per group, a note when the groups differ in depth by DEPTH_NOTE_RATIO or more)."""
    if ctx.total_umi is None:
        return [None] * len(groups), None
    med = [float(np.median(ctx.total_umi[m])) if m.any() else float("nan") for _, m in groups]
    known = [(label, v) for (label, _), v in zip(groups, med) if math.isfinite(v) and v > 0]
    note = None
    if len(known) > 1:
        lo, hi = min(known, key=lambda t: t[1]), max(known, key=lambda t: t[1])
        if hi[1] / lo[1] >= DEPTH_NOTE_RATIO:
            note = (f"The groups differ in depth: {hi[0]} has a median of {hi[1]:g} UMIs per {ctx.unit}, {lo[0]} "
                    f"{lo[1]:g}. Deeper {ctx.units} detect more genes, so part of a difference may be depth.")
    return [number(v, 1) for v in med], note


def unmatched_note(ctx: Context, n: int) -> str | None:
    if not n:
        return None
    return (f"{n:,} {ctx.unit if n == 1 else ctx.units} of the selection {'is' if n == 1 else 'are'} not in the raw "
            f"data any more and {'was' if n == 1 else 'were'} left out.")


def notes_of(*notes) -> list[str]:
    return [n for n in notes if n]


# [APP] 2026-11-14: the texts of the tools say "bin"; a run of spots (Visium) or cells (Xenium, MERSCOPE, CosMx) reads
# its own unit instead. score_genes' "expression bin" (genes binned by mean expression) is another word and is kept.
_BIN_WORD = re.compile(r"(?<!expression )\b(bin|Bin|BIN)(s?)\b")


def unit_text(text, unit: str = "bin"):
    """`text` with the word bin(s) as `unit` (spot, cell): capitalised like the original; anything not a string is
    returned as it is."""
    if unit == "bin" or not isinstance(text, str):
        return text

    def word(m):
        w = unit + m.group(2)
        return w.upper() if m.group(1).isupper() else w.capitalize() if m.group(1)[0].isupper() else w
    return _BIN_WORD.sub(word, text)


def in_units(result: dict, unit: str) -> dict:
    """A tool's result with its notes, column labels and section statuses in the run's unit."""
    if unit == "bin" or not isinstance(result, dict):
        return result
    if isinstance(result.get("notes"), list):
        result["notes"] = [unit_text(n, unit) for n in result["notes"]]
    t = result.get("table")
    if isinstance(t, dict) and isinstance(t.get("columns"), list):
        for c in t["columns"]:
            if isinstance(c, dict):
                c["label"] = unit_text(c.get("label"), unit)
    for key in ("sections",):
        for row in result.get(key) or []:
            if isinstance(row, dict) and isinstance(row.get("status"), str):
                row["status"] = unit_text(row["status"], unit)
    return result


# ============================================================================
# TOOLS
# ============================================================================

def distribution(values, masks: list[np.ndarray], lo: float, hi: float) -> list[dict]:
    """Per group: n, mean, sd, the seven quantiles and the density on the grid from lo to hi."""
    out = []
    for m in masks:
        v = values[m]
        out.append({"n": int(len(v)), "mean": number(v.mean(), 4) if len(v) else None,
                    "sd": number(v.std(ddof=1), 4) if len(v) > 1 else None, "q": five_numbers(v),
                    "density": finite(binned_density(v, lo, hi), 5)})
    return out


def run_expression(ctx: Context, p: dict) -> dict:
    """Expression of chosen genes in groups of bins: per gene and group the share of bins detecting it, the mean and
    the distribution of its normalized expression, log1p(UMIs per target_sum UMIs of the bin) with the bin's UMIs over
    all genes (the run's normalization)."""
    names = get_genes(p.get("genes"), 1, MAX_GENES, "Genes")
    scope = scope_mask(ctx, p.get("scope"))
    groups = groups_of(ctx, p.get("group_by"), scope, "Groups", p.get("split_by"))
    E = ctx.expression()
    used, missing, cols = E.resolve(names)
    if not used:
        raise ToolError(f"none of these genes is in the data: {', '.join(missing)}")
    union = np.zeros(ctx.n, dtype=bool)
    for g in groups:
        union |= g.mask
    units = np.flatnonzero(union & E.matched)
    if not len(units):
        raise ToolError(f"the raw data holds none of the selected {ctx.units}")
    counts = E.counts(cols)[units].astype(np.float64)
    total = E.total[units]
    cp = counts * np.divide(ctx.target_sum, total, out=np.zeros_like(total), where=total > 0)[:, None]
    values = np.log1p(cp)
    masks = [g.mask[units] for g in groups]
    medians, depth = depth_note(ctx, [(g.label, g.mask) for g in groups])
    stats_out, rows = [], {k: [] for k in ("gene", "group", "n", "n_detected", "pct_detected", "mean", "median",
                                           "mean_cp")}
    for j, gene in enumerate(used):
        ctx.check()
        v = values[:, j]
        hi = float(v.max()) if len(v) else 0.0
        dist = distribution(v, masks, 0.0, hi)
        for g, m, d in zip(groups, masks, dist):
            n_det = int((counts[m, j] > 0).sum())
            d.update(n_detected=n_det, pct=number(100.0 * n_det / d["n"], 2) if d["n"] else None,
                     mean_cp=number(cp[m, j].mean(), 4) if d["n"] else None)
            for key, value in (("gene", gene), ("group", g.label), ("n", d["n"]), ("n_detected", n_det),
                               ("pct_detected", d["pct"]), ("mean", d["mean"]), ("median", d["q"][3]),
                               ("mean_cp", d["mean_cp"])):
                rows[key].append(value)
        stats_out.append({"gene": gene, "max": number(hi, 4), "groups": dist})
    cp_label = f"Mean UMIs per {ctx.target_sum:g}"
    return {
        "genes": used, "missing": missing,
        "groups": [{"key": g.key, "label": g.label, "n": int(m.sum()), "color": g.color, "median_umi": med}
                   for g, m, med in zip(groups, masks, medians)],
        "stats": stats_out, "grid": GRID,
        "expression": f"log1p(UMIs per {ctx.target_sum:g} UMIs of the {ctx.unit})",
        "scope": scope_text(ctx, p.get("scope")),
        "table": table([("gene", "Gene", "text"), ("group", "Group", "text"), ("n", f"{ctx.units.capitalize()}", "int"),
                        ("n_detected", "Detecting", "int"), ("pct_detected", "% detecting", "number"),
                        ("mean", "Mean expression", "number"), ("median", "Median expression", "number"),
                        ("mean_cp", cp_label, "number")], rows),
        "notes": notes_of(f"Not in the data: {', '.join(missing)}." if missing else None,
                          unmatched_note(ctx, int((union & ~E.matched).sum())), depth),
    }


def run_de(ctx: Context, p: dict) -> dict:
    """Differential expression between two groups of bins, on the normalized expression of every gene detected in
    them: Wilcoxon rank-sum (default) or Welch's t test, Benjamini-Hochberg over the genes tested, and the fold change
    log2((mean UMIs per target_sum in A + 1) / (the same in B + 1)), as Figure 4h's table
    (bone_analysis.compare_osteoclast_states). Group B is the bins of its conditions, or every other bin of the scope;
    a bin in both groups is in neither."""
    scope = scope_mask(ctx, p.get("scope"))
    a_conds = get_conditions(p.get("a"), "Group A", required=True)
    b_conds = get_conditions(p.get("b"), "Group B")
    method = get_choice(p, "method", ("wilcoxon", "t-test"), "wilcoxon", "Test")
    ties = get_choice(p, "ties", ("corrected", "scanpy"), "corrected", "Ties")
    min_units = get_int(p, "min_bins", 3, 1, 1_000_000, "Detected in at least")
    a = scope & conditions_mask(ctx, a_conds, "Group A")
    b = scope & conditions_mask(ctx, b_conds, "Group B") if b_conds else scope & ~a
    both = a & b
    a, b = a & ~both, b & ~both
    E = ctx.expression()
    units = np.flatnonzero((a | b) & E.matched)
    in_a = a[units]
    n_a, n_b = int(in_a.sum()), int(len(units) - in_a.sum())
    if n_a < 2 or n_b < 2:
        raise ToolError(f"group A has {n_a:,} {ctx.units} and group B {n_b:,}; the test needs at least two in each")
    X = E.matrix(units)
    total = E.total[units]
    ctx.check()
    detected = X.copy()
    detected.data[:] = 1.0
    flag = in_a.astype(np.float64)
    det_a = np.asarray(detected.T @ flag).ravel()
    det_b = np.asarray(detected.T @ (1.0 - flag)).ravel()
    scale = np.divide(ctx.target_sum, total, out=np.zeros_like(total), where=total > 0)
    cp = (sparse.diags(scale) @ X).tocsr()
    cp_a = np.asarray(cp.T @ flag).ravel() / n_a
    cp_b = np.asarray(cp.T @ (1.0 - flag)).ravel() / n_b
    Xn = cp
    Xn.data = np.log1p(Xn.data)
    mean_a = np.asarray(Xn.T @ flag).ravel() / n_a
    mean_b = np.asarray(Xn.T @ (1.0 - flag)).ravel() / n_b
    ctx.check()
    if method == "wilcoxon":
        stat, pval, _ = rank_sum_test(Xn, in_a, ties)
    else:
        stat, pval = welch_test(Xn, in_a)
    tested = (det_a + det_b) >= min_units
    if not tested.any():
        raise ToolError(f"no gene is detected in at least {min_units} of the {len(units):,} {ctx.units}")
    idx = np.flatnonzero(tested)
    fdr = bh_adjust(pval[idx])
    lfc = np.log2((cp_a[idx] + 1.0) / (cp_b[idx] + 1.0))
    order = np.lexsort((idx, -np.abs(stat[idx]), pval[idx]))
    idx, fdr, lfc = idx[order], fdr[order], lfc[order]
    medians, depth = depth_note(ctx, [("group A", a), ("group B", b)])
    n_up = int(((fdr <= 0.05) & (lfc >= 1)).sum())
    n_down = int(((fdr <= 0.05) & (lfc <= -1)).sum())
    return {
        "a": {"label": conditions_text(ctx, a_conds), "n": n_a, "median_umi": medians[0]},
        "b": {"label": conditions_text(ctx, b_conds) if b_conds else f"every other {ctx.unit} of the scope",
              "n": n_b, "median_umi": medians[1]},
        "scope": scope_text(ctx, p.get("scope")),
        "method": "Wilcoxon rank-sum" if method == "wilcoxon" else "Welch's t test",
        "statistic": "z" if method == "wilcoxon" else "t",
        "n_tested": int(len(idx)), "n_up": n_up, "n_down": n_down, "n_both": int(both.sum()),
        "expression": f"log1p(UMIs per {ctx.target_sum:g} UMIs of the {ctx.unit})",
        "table": table(
            [("gene", "Gene", "text"), ("log2fc", "log2 fold change", "number"), ("pct_a", "% detecting, A", "number"),
             ("pct_b", "% detecting, B", "number"), ("mean_a", "Mean expression, A", "number"),
             ("mean_b", "Mean expression, B", "number"), ("stat", "z" if method == "wilcoxon" else "t", "number"),
             ("p", "P", "number"), ("fdr", "FDR", "number")],
            {"gene": [E.genes[j] for j in idx.tolist()], "log2fc": finite(lfc, 4),
             "pct_a": finite(100.0 * det_a[idx] / n_a, 2), "pct_b": finite(100.0 * det_b[idx] / n_b, 2),
             "mean_a": finite(mean_a[idx], 4), "mean_b": finite(mean_b[idx], 4), "stat": finite(stat[idx], 3),
             "p": finite(significant(pval[idx])), "fdr": finite(significant(fdr))}),
        "notes": notes_of(
            INDEPENDENCE_NOTE, depth,
            f"{int(both.sum()):,} {ctx.units} match both groups and are in neither." if both.any() else None,
            unmatched_note(ctx, int(((a | b) & ~E.matched).sum())),
            "No tie correction (scanpy's default): the z scores are smaller than the corrected ones."
            if method == "wilcoxon" and ties == "scanpy" else None),
    }


def run_composition(ctx: Context, p: dict) -> dict:
    """Share of the bins of each group that have each value: of a category field (cell type, tissue class, Leiden
    domain: the values of a bin exclude each other, the shares of a group add up to 100%), or of several yes/no
    calls (each on its own: Figures 4g and 6a), with Wilson 95% intervals as bone_analysis.positivity_table."""
    scope = scope_mask(ctx, p.get("scope"))
    count = p.get("count")
    if not isinstance(count, dict) or not (count.get("field") or count.get("calls")):
        raise ToolError("Count: choose a field, or one or more yes/no calls")
    across = groups_of(ctx, p.get("across") or {"field": "sample"}, scope, "Across")
    series = []                                   # (key, label, color, mask of the bins that have the value)
    exclusive = bool(count.get("field"))
    if exclusive:
        f = ctx.field(count["field"], "Count")
        if f.kind != "category":
            raise ToolError(f"Count: {f.label} is a yes/no field; add it to the calls instead")
        values = f.normalise(count["values"], "Count") if count.get("values") else f.options()
        series = [(str(v), f.text(v), f.colors.get(v), f.mask_of(v)) for v in values]
        denominator = get_choice(p, "denominator", ("all", "listed"), "all", "Share of")
        base = scope
        if denominator == "listed":
            base = scope & np.logical_or.reduce([m for *_, m in series])
        what = f.label
    else:
        calls = count["calls"]
        if not isinstance(calls, list) or not calls:
            raise ToolError("Count: choose one or more yes/no calls")
        for key in dict.fromkeys(calls):
            f = ctx.field(key, "Count")
            if f.kind != "bool":
                raise ToolError(f"Count: {f.label} is not a yes/no call")
            series.append((key, f.label, f.colors.get(True), f.values))
        denominator, base, what = "all", scope, "calls"
    if len(series) * len(across) > 4000:
        raise ToolError("too many values and groups for one chart; choose fewer values")
    rows = {k: [] for k in ("group", "value", "n", "total", "pct", "ci_lo", "ci_hi")}
    cells = []
    for g in across:
        m = g.mask & base
        tot = int(m.sum())
        ks = np.array([int((m & sm).sum()) for *_, sm in series], dtype=np.float64)
        lo, hi = wilson_interval(ks, np.full(len(ks), tot))
        pct = np.divide(100.0 * ks, tot, out=np.full(len(ks), np.nan), where=tot > 0)
        cells.append({"n": [int(k) for k in ks], "total": tot, "pct": finite(pct, 3), "lo": finite(100 * lo, 3),
                      "hi": finite(100 * hi, 3)})
        for (_, label, _, _), k, pc, l_, h_ in zip(series, ks, pct, lo, hi):
            for key, value in (("group", g.label), ("value", label), ("n", int(k)), ("total", tot),
                               ("pct", number(pc, 3)), ("ci_lo", number(100 * l_, 3)), ("ci_hi", number(100 * h_, 3))):
                rows[key].append(value)
    _, depth = depth_note(ctx, [(g.label, g.mask & base) for g in across])
    return {
        "exclusive": exclusive, "what": what, "denominator": denominator,
        "series": [{"key": k, "label": lab, "color": color} for k, lab, color, _ in series],
        "groups": [{"key": g.key, "label": g.label, "color": g.color} for g in across], "cells": cells,
        "scope": scope_text(ctx, p.get("scope")),
        "table": table([("group", "Group", "text"), ("value", what.capitalize() if not exclusive else what, "text"),
                        ("n", f"{ctx.units.capitalize()}", "int"), ("total", "Of", "int"), ("pct", "%", "number"),
                        ("ci_lo", "95% CI, low", "number"), ("ci_hi", "95% CI, high", "number")], rows),
        "notes": notes_of(
            "Intervals are Wilson 95% intervals of the share; they treat bins as independent observations.",
            depth if not exclusive else None),
    }


def run_coexpression(ctx: Context, p: dict) -> dict:
    """Genes whose normalized expression follows one gene over the bins of the scope: Pearson r of every gene with
    it, two-sided P (t test), Benjamini-Hochberg over the genes detected in at least `min_bins` bins."""
    gene = get_genes(p.get("gene"), 1, 1, "Gene")[0]
    scope = scope_mask(ctx, p.get("scope"))
    min_units = get_int(p, "min_bins", 10, 1, 1_000_000, "Detected in at least")
    E = ctx.expression()
    used, missing, cols = E.resolve([gene])
    if not used:
        raise ToolError(f"{gene} is not in the data")
    units = np.flatnonzero(scope & E.matched)
    if len(units) < 3:
        raise ToolError(f"the scope holds {len(units)} {ctx.units} with raw data; at least three are needed")
    Xn = lognorm(E.matrix(units), E.total[units], ctx.target_sum)
    ctx.check()
    y = np.asarray(Xn[:, cols[0]].todense()).ravel()
    if not y.std() > 0:
        raise ToolError(f"{used[0]} has the same expression in every {ctx.unit} of the scope (it is not detected "
                        f"there, or everywhere alike)")
    r, pval = pearson_columns(Xn, y)
    detected = np.diff(Xn.tocsc().indptr)
    tested = detected >= min_units
    tested[cols[0]] = False
    idx = np.flatnonzero(tested)
    if not len(idx):
        raise ToolError(f"no other gene is detected in at least {min_units} {ctx.units} of the scope")
    fdr = bh_adjust(pval[idx])
    order = np.lexsort((idx, -r[idx]))
    idx, fdr = idx[order], fdr[order]
    return {
        "gene": used[0], "n": int(len(units)), "n_tested": int(len(idx)),
        "n_detected": int((y > 0).sum()), "scope": scope_text(ctx, p.get("scope")),
        "expression": f"log1p(UMIs per {ctx.target_sum:g} UMIs of the {ctx.unit})",
        "table": table([("gene", "Gene", "text"), ("r", "Pearson r", "number"), ("p", "P", "number"),
                        ("fdr", "FDR", "number"), ("pct_detected", "% detecting", "number")],
                       {"gene": [E.genes[j] for j in idx.tolist()], "r": finite(r[idx], 4),
                        "p": finite(significant(pval[idx])), "fdr": finite(significant(fdr)),
                        "pct_detected": finite(100.0 * detected[idx] / len(units), 2)}),
        "notes": notes_of(INDEPENDENCE_NOTE, unmatched_note(ctx, int((scope & ~E.matched).sum())),
                          "Genes captured from the same cells and genes that follow depth both correlate: a high r "
                          "is a lead, not proof of co-expression in one cell."),
    }


def run_gene_pair(ctx: Context, p: dict) -> dict:
    """Two genes against each other over the bins of the scope: Pearson r and Spearman rho of their normalized
    expression, the bins detecting both, one or neither (odds ratio, Fisher's exact test), per section and overall,
    and the joint distribution on a grid."""
    gx = get_genes(p.get("x"), 1, 1, "Gene X")[0]
    gy = get_genes(p.get("y"), 1, 1, "Gene Y")[0]
    scope = scope_mask(ctx, p.get("scope"))
    E = ctx.expression()
    used, missing, cols = E.resolve([gx, gy])
    if missing:
        raise ToolError(f"not in the data: {', '.join(missing)}")
    if len(used) < 2:
        raise ToolError("choose two different genes")
    units = np.flatnonzero(scope & E.matched)
    if len(units) < 3:
        raise ToolError(f"the scope holds {len(units)} {ctx.units} with raw data; at least three are needed")
    counts = E.counts(cols)[units].astype(np.float64)
    total = E.total[units]
    values = np.log1p(counts * np.divide(ctx.target_sum, total, out=np.zeros_like(total), where=total > 0)[:, None])
    codes = ctx.sample_codes[units]

    def describe(label, m):
        x, y = values[m, 0], values[m, 1]
        dx, dy = counts[m, 0] > 0, counts[m, 1] > 0
        both, only_x, only_y = int((dx & dy).sum()), int((dx & ~dy).sum()), int((~dx & dy).sum())
        neither = int(m.sum()) - both - only_x - only_y
        ok = len(x) > 2 and x.std() > 0 and y.std() > 0
        odds, fisher = stats.fisher_exact([[both, only_x], [only_y, neither]]) if m.sum() else (float("nan"),) * 2
        return {"group": label, "n": int(m.sum()), "r": number(np.corrcoef(x, y)[0, 1], 4) if ok else None,
                "rho": number(stats.spearmanr(x, y)[0], 4) if ok else None, "both": both, "only_x": only_x,
                "only_y": only_y, "neither": neither, "odds_ratio": number(odds, 4), "fisher_p": number(fisher)}

    every = np.ones(len(units), dtype=bool)
    lines = [describe("all sections" if len(ctx.samples) > 1 else ctx.samples[0].get("label") or ctx.samples[0]["id"],
                      every)]
    if len(ctx.samples) > 1:
        for i, s in enumerate(ctx.samples):
            if (codes == i).any():
                lines.append(describe(s.get("label") or s["id"], codes == i))
    hx, hy = float(values[:, 0].max()), float(values[:, 1].max())
    grid = np.histogram2d(values[:, 0], values[:, 1], bins=DENSITY_2D,
                          range=[[0, hx if hx > 0 else 1.0], [0, hy if hy > 0 else 1.0]])[0]
    keys = ["group", "n", "r", "rho", "both", "only_x", "only_y", "neither", "odds_ratio", "fisher_p"]
    return {
        "x": used[0], "y": used[1], "n": int(len(units)), "max_x": number(hx, 4), "max_y": number(hy, 4),
        "density": grid.astype(np.int64).tolist(), "overall": lines[0], "scope": scope_text(ctx, p.get("scope")),
        "expression": f"log1p(UMIs per {ctx.target_sum:g} UMIs of the {ctx.unit})",
        "table": table([("group", "Section", "text"), ("n", f"{ctx.units.capitalize()}", "int"),
                        ("r", "Pearson r", "number"), ("rho", "Spearman rho", "number"),
                        ("both", "Detect both", "int"), ("only_x", f"Only {used[0]}", "int"),
                        ("only_y", f"Only {used[1]}", "int"), ("neither", "Neither", "int"),
                        ("odds_ratio", "Odds ratio", "number"), ("fisher_p", "Fisher P", "number")],
                       {k: [line[k] for line in lines] for k in keys}),
        "notes": notes_of(INDEPENDENCE_NOTE, unmatched_note(ctx, int((scope & ~E.matched).sum()))),
    }


def run_distance(ctx: Context, p: dict) -> dict:
    """Distance from each bin of group A to the nearest bin of group B, per section, against a random-placement null
    that draws the same numbers of A and B bins among the bins of the scope (Figure 4i, as
    bone_analysis.uncoupling_metric; positions are the per-bin table's micrometres, there the bin grid), and the share
    of A bins with a B bin within the radius against the same share for every bin of the scope (the proximity tables,
    bone_analysis.proximity_table). observed / null mean below 1: A lies closer to B than chance."""
    scope = scope_mask(ctx, p.get("scope"))
    a_conds = get_conditions(p.get("a"), "From (group A)", required=True)
    b_conds = get_conditions(p.get("b"), "To (group B)", required=True)
    n_perm = get_int(p, "n_perm", 199, 0, MAX_PERMUTATIONS, "Random placements")
    radius = get_float(p, "radius_um", 50.0, 0.0, 1e7, "Radius")
    min_units = get_int(p, "min_bins", 10, 1, 1_000_000, "Minimum bins per group")
    exclude_self = get_bool(p, "exclude_self", False, "Measure B bins to the nearest other B bin")
    seed = get_int(p, "seed", 0, 0, 2 ** 31 - 1, "Seed")
    A = scope & conditions_mask(ctx, a_conds, "From (group A)")
    B = scope & conditions_mask(ctx, b_conds, "To (group B)")
    rng = np.random.default_rng(seed)
    keys = ["section", "status", "n_a", "n_b", "n_scope", "mean_um", "median_um", "null_mean_um", "ratio", "ratio_lo",
            "ratio_hi", "p_closer", "p_farther", "pct_a_within", "pct_all_within", "n_both"]
    rows = {k: [] for k in keys}
    hists = []
    xy_all = np.column_stack([ctx.x, ctx.y])
    for i, s in enumerate(ctx.samples):
        m = scope & (ctx.sample_codes == i)
        if not m.any():
            continue
        xy, a, b = xy_all[m], A[m], B[m]
        if not np.isfinite(xy).all():
            raise ToolError(f"section {s['id']} has {ctx.units} without a position")
        n_a, n_b = int(a.sum()), int(b.sum())
        row = dict.fromkeys(keys)
        row.update(section=s.get("label") or s["id"], n_a=n_a, n_b=n_b, n_scope=int(m.sum()),
                   n_both=int((a & b).sum()))
        if n_a < min_units or n_b < min_units:
            row["status"] = f"not estimable (fewer than {min_units} {ctx.units} in a group)"
        else:
            to_b = nearest_distance(xy, b, exclude_self)
            d_obs = to_b[a]
            d_obs = d_obs[np.isfinite(d_obs)]
            mean = float(d_obs.mean())
            null_means, pooled = [], []
            for _ in range(n_perm):
                ctx.check()
                ia = rng.choice(len(xy), n_a, replace=False)
                ib = rng.choice(len(xy), n_b, replace=False)
                if exclude_self:
                    target = np.zeros(len(xy), dtype=bool)
                    target[ib] = True
                    dn = nearest_distance(xy, target, True)[ia]
                    dn = dn[np.isfinite(dn)]
                else:
                    dn = cKDTree(xy[ib]).query(xy[ia])[0]
                null_means.append(dn.mean())
                pooled.append(dn)
            row.update(status="estimable", mean_um=mean, median_um=float(np.median(d_obs)),
                       pct_a_within=100.0 * float((to_b[a] <= radius).mean()),
                       pct_all_within=100.0 * float((to_b <= radius).mean()))
            top = float(d_obs.max())
            if n_perm:
                null_means = np.asarray(null_means)
                lo, hi = np.percentile(null_means, [2.5, 97.5])
                row.update(null_mean_um=float(null_means.mean()), ratio=mean / float(null_means.mean()),
                           ratio_lo=mean / float(hi), ratio_hi=mean / float(lo),
                           p_closer=float((np.sum(null_means <= mean) + 1) / (n_perm + 1)),
                           p_farther=float((np.sum(null_means >= mean) + 1) / (n_perm + 1)))
                pooled = np.concatenate(pooled)
                top = max(top, float(np.percentile(pooled, 99.5)))
            edges = np.linspace(0.0, top if top > 0 else 1.0, HIST_BINS + 1)
            hist = {"section": row["section"], "edges": finite(edges, 3),
                    "observed": np.histogram(d_obs, bins=edges)[0].tolist(), "n_observed": int(len(d_obs))}
            if n_perm:
                hist["null"] = finite(np.histogram(pooled, bins=edges)[0] / n_perm, 3)
            hists.append(hist)
        for k in keys:
            v = row[k]
            rows[k].append(number(v, 4) if isinstance(v, float) else v)
    if not any(s == "estimable" for s in rows["status"]):
        raise ToolError(f"no section has at least {min_units} {ctx.units} in both groups (A: "
                        f"{', '.join(str(n) for n in rows['n_a'])}; B: {', '.join(str(n) for n in rows['n_b'])})")
    R = f"{radius:g}"
    return {
        "a": conditions_text(ctx, a_conds), "b": conditions_text(ctx, b_conds), "radius_um": radius,
        "n_perm": n_perm, "histograms": hists, "scope": scope_text(ctx, p.get("scope")),
        "table": table(
            [("section", "Section", "text"), ("status", "Status", "text"), ("n_a", "A", "int"), ("n_b", "B", "int"),
             ("n_scope", f"{ctx.units.capitalize()} in scope", "int"), ("mean_um", "Mean distance (um)", "number"),
             ("median_um", "Median distance (um)", "number"), ("null_mean_um", "Null mean (um)", "number"),
             ("ratio", "Observed / null", "number"), ("ratio_lo", "95% null interval, low", "number"),
             ("ratio_hi", "95% null interval, high", "number"), ("p_closer", "P closer than chance", "number"),
             ("p_farther", "P farther than chance", "number"), ("pct_a_within", f"% of A within {R} um of B", "number"),
             ("pct_all_within", f"% of all within {R} um of B", "number"), ("n_both", "In both groups", "int")], rows),
        "notes": notes_of(
            "Raw distances depend on how many bins each group has: compare observed / null between sections, not "
            "the distances themselves.",
            "The null places the same numbers of A and B bins at random among the bins of the scope, "
            f"{n_perm} times; the interval is the observed mean over the 97.5th and 2.5th percentile of the null means."
            if n_perm else "No random placements were asked for, so there is no null.",
            "A bin in both groups is its own nearest B bin (0 um)." if not exclude_self and any(rows["n_both"])
            else None),
    }


def run_neighborhood(ctx: Context, p: dict) -> dict:
    """Which categories lie next to each other more often than chance, per section: for every pair, the number of
    (bin of the row category, neighbor of the column category) pairs among each bin's k nearest bins, against the
    same count after shuffling the categories among the bins of the scope; z = (observed - mean of the shuffles) /
    their standard deviation (squidpy's nhood_enrichment)."""
    scope = scope_mask(ctx, p.get("scope"))
    spec = p.get("field")
    if isinstance(spec, str):
        spec = {"field": spec}
    if not isinstance(spec, dict):
        raise ToolError("Categories: choose a field")
    f = ctx.field(spec.get("field"), "Categories")
    if f.kind != "category":
        raise ToolError(f"Categories: {f.label} is a yes/no field; choose a field with categories")
    values = f.normalise(spec["values"], "Categories") if spec.get("values") else f.options()
    k = get_int(p, "k", 8, 1, 50, "Neighbors")
    n_perm = get_int(p, "n_perm", 199, 10, MAX_PERMUTATIONS, "Shuffles")
    seed = get_int(p, "seed", 0, 0, 2 ** 31 - 1, "Seed")
    rng = np.random.default_rng(seed)
    code_of = np.full(len(f.categories), -1, dtype=np.int64)
    code_of[[f.categories.index(v) for v in values]] = np.arange(len(values))
    labels = np.where(f.codes >= 0, code_of[np.maximum(f.codes, 0)], -1)
    n_cat = len(values)
    if n_cat < 2:
        raise ToolError("Categories: choose at least two values")
    xy_all = np.column_stack([ctx.x, ctx.y])
    sections, total_obs, total_null = [], np.zeros((n_cat, n_cat)), None

    def counts_of(W, lab):
        ok = np.flatnonzero(lab >= 0)
        L = sparse.csr_matrix((np.ones(len(ok)), (ok, lab[ok])), shape=(len(lab), n_cat))
        return np.asarray((L.T @ (W @ L)).todense())

    def z_of(obs, null):
        sd = null.std(axis=0)
        with np.errstate(divide="ignore", invalid="ignore"):
            return np.where(sd > 0, (obs - null.mean(axis=0)) / sd, np.nan)

    for i, s in enumerate(ctx.samples):
        m = scope & (ctx.sample_codes == i)
        if m.sum() < k + 2:
            continue
        lab = labels[m]
        W = knn_graph(xy_all[m], k)
        obs = counts_of(W, lab)
        null = np.empty((n_perm, n_cat, n_cat))
        for j in range(n_perm):
            ctx.check()
            null[j] = counts_of(W, rng.permutation(lab))
        total_obs += obs
        total_null = null if total_null is None else total_null + null
        sections.append({"section": s.get("label") or s["id"], "n": int(m.sum()),
                         "counts": [int(v) for v in np.bincount(lab[lab >= 0], minlength=n_cat)],
                         "z": [finite(row, 3) for row in z_of(obs, null)], "observed": obs.astype(np.int64).tolist()})
    if not sections:
        raise ToolError(f"no section has more than {k + 1} {ctx.units} in the scope")
    if len(sections) > 1:
        sections.insert(0, {"section": "all sections", "n": int(sum(s["n"] for s in sections)),
                            "counts": [int(v) for v in np.sum([s["counts"] for s in sections], axis=0)],
                            "z": [finite(row, 3) for row in z_of(total_obs, total_null)],
                            "observed": total_obs.astype(np.int64).tolist()})
    names = [f.text(v) for v in values]
    rows = {k_: [] for k_ in ("section", "category", "neighbor", "pairs", "z")}
    for sec in sections:
        for a_, name_a in enumerate(names):
            for b_, name_b in enumerate(names):
                for key, value in (("section", sec["section"]), ("category", name_a), ("neighbor", name_b),
                                   ("pairs", sec["observed"][a_][b_]), ("z", sec["z"][a_][b_])):
                    rows[key].append(value)
    return {
        "field": f.label, "categories": [{"key": str(v), "label": name, "color": f.colors.get(v)}
                                         for v, name in zip(values, names)],
        "k": k, "n_perm": n_perm, "sections": sections, "scope": scope_text(ctx, p.get("scope")),
        "table": table([("section", "Section", "text"), ("category", f.label, "text"), ("neighbor", "Neighbor", "text"),
                        ("pairs", "Neighbor pairs", "int"), ("z", "z", "number")], rows),
        "notes": notes_of(
            f"z compares each count with {n_perm} shuffles of the categories among the {ctx.units} of the scope, "
            f"section by section. Categories with few {ctx.units} give unstable z values.",
            "A category that forms compact patches is its own neighbor far more often than chance (the diagonal)."),
    }


def run_score(ctx: Context, p: dict) -> dict:
    """Score of a gene set in every bin of the scope (score_gene_set: the set's mean normalized expression minus that
    of expression-matched control genes), its distribution per group, and the score of every bin for the map."""
    names = get_genes(p.get("genes"), 2, MAX_SET_GENES, "Genes")
    scope = scope_mask(ctx, p.get("scope"))
    groups = groups_of(ctx, p.get("group_by") or {"field": "sample"}, scope, "Groups", p.get("split_by"))
    ctrl_size = get_int(p, "ctrl_size", 50, 1, 500, "Control genes per expression bin")
    seed = get_int(p, "seed", 0, 0, 2 ** 31 - 1, "Seed")
    title = str(p.get("name") or "").strip()[:80] or "Gene set"
    E = ctx.expression()
    used, missing, cols = E.resolve(names)
    if len(used) < 2:
        raise ToolError(f"fewer than two of the genes are in the data ({', '.join(used) or 'none'}); a score needs "
                        f"at least two")
    units = np.flatnonzero(scope & E.matched)
    if len(units) < 2:
        raise ToolError(f"the scope holds {len(units)} {ctx.units} with raw data")
    Xn = lognorm(E.matrix(units), E.total[units], ctx.target_sum)
    ctx.check()
    score, control = score_gene_set(Xn, cols, ctrl_size, seed=seed)
    masks = [g.mask[units] for g in groups]
    lo, hi = float(score.min()), float(score.max())
    dist = distribution(score, masks, lo, hi)
    medians, depth = depth_note(ctx, [(g.label, g.mask) for g in groups])
    rows = {k: [] for k in ("group", "n", "mean", "median", "q25", "q75")}
    for g, d in zip(groups, dist):
        for key, value in (("group", g.label), ("n", d["n"]), ("mean", d["mean"]), ("median", d["q"][3]),
                           ("q25", d["q"][2]), ("q75", d["q"][4])):
            rows[key].append(value)
    arrays, maps = {}, []
    full = np.full(ctx.n, np.nan)
    full[units] = score
    for i, s in enumerate(ctx.samples):
        here = ctx.sample_codes == i
        if (here & scope).any():
            arrays[f"score:{s['id']}"] = full[here]
            maps.append({"sample": s["id"], "label": s.get("label") or s["id"], "array": f"score:{s['id']}",
                         "n": int(np.isfinite(full[here]).sum())})
    result = {
        "name": title, "genes": used, "missing": missing, "n_control": int(len(control)), "min": number(lo, 4),
        "max": number(hi, 4), "grid": GRID,
        "groups": [{"key": g.key, "label": g.label, "n": d["n"], "color": g.color, "median_umi": med}
                   for g, d, med in zip(groups, dist, medians)],
        "stats": dist, "maps": maps, "scope": scope_text(ctx, p.get("scope")),
        "table": table([("group", "Group", "text"), ("n", f"{ctx.units.capitalize()}", "int"),
                        ("mean", "Mean score", "number"), ("median", "Median score", "number"),
                        ("q25", "25th percentile", "number"), ("q75", "75th percentile", "number")], rows),
        "notes": notes_of(
            f"Not in the data: {', '.join(missing)}." if missing else None,
            f"Score: mean normalized expression of the {len(used)} genes minus that of {len(control):,} control "
            f"genes of similar average expression (as scanpy's score_genes; the control genes are drawn here, so the "
            f"values differ slightly from the run's own signature scores).",
            unmatched_note(ctx, int((scope & ~E.matched).sum())), depth),
    }
    return {"result": result, "arrays": arrays}


def run_svg(ctx: Context, p: dict) -> dict:
    """Spatially variable genes: Moran's I of the normalized expression of every gene detected in at least `min_bins`
    bins, per section, on the Delaunay graph of the bins of the scope (morans_i; Supplementary Figure S2, where
    bone_analysis.morans_i tests the highly variable genes only)."""
    scope = scope_mask(ctx, p.get("scope"))
    min_units = get_int(p, "min_bins", 10, 1, 1_000_000, "Detected in at least")
    top = get_int(p, "top", 200, 1, 5000, "Genes kept per section")
    E = ctx.expression()
    xy_all = np.column_stack([ctx.x, ctx.y])
    rows = {k: [] for k in ("section", "rank", "gene", "I", "z", "p", "fdr", "pct_detected")}
    sections, per_section = [], {}
    for i, s in enumerate(ctx.samples):
        units = np.flatnonzero(scope & (ctx.sample_codes == i) & E.matched)
        if not len(units):
            continue
        label = s.get("label") or s["id"]
        if len(units) < 4:
            sections.append({"section": label, "n": int(len(units)), "status": "fewer than four bins: skipped"})
            continue
        ctx.check()
        Xn = lognorm(E.matrix(units), E.total[units], ctx.target_sum).tocsc()
        detected = np.diff(Xn.indptr)
        idx = np.flatnonzero(detected >= min_units)
        if not len(idx):
            sections.append({"section": label, "n": int(len(units)),
                             "status": f"no gene is detected in {min_units} {ctx.units}: skipped"})
            continue
        try:
            W = delaunay_graph(xy_all[units])
        except (QhullError, ValueError) as exc:
            sections.append({"section": label, "n": int(len(units)),
                             "status": f"the neighbor graph cannot be built ({str(exc).splitlines()[0][:120]})"})
            continue
        ctx.check()
        score, z, pval = morans_i(Xn[:, idx], W)
        fdr = bh_adjust(pval)
        order = np.lexsort((idx, -np.nan_to_num(score, nan=-np.inf)))
        rank = np.empty(len(idx), dtype=np.int64)
        rank[order] = np.arange(1, len(idx) + 1)
        per_section[label] = {E.genes[j]: int(r) for j, r in zip(idx.tolist(), rank.tolist()) if r <= top}
        keep = order[:top]
        sections.append({"section": label, "n": int(len(units)), "status": "done", "n_tested": int(len(idx)),
                         "n_significant": int((fdr <= 0.05).sum())})
        for key, value in (("section", [label] * len(keep)), ("rank", rank[keep].tolist()),
                           ("gene", [E.genes[j] for j in idx[keep].tolist()]), ("I", finite(score[keep], 4)),
                           ("z", finite(z[keep], 3)), ("p", finite(significant(pval[keep]))),
                           ("fdr", finite(significant(fdr[keep]))),
                           ("pct_detected", finite(100.0 * detected[idx[keep]] / len(units), 2))):
            rows[key].extend(value)
    if not rows["gene"]:
        raise ToolError("no section could be tested: " + "; ".join(f"{s['section']}: {s['status']}" for s in sections)
                        if sections else f"the scope holds no {ctx.unit} with raw data")
    shared = []
    if len(per_section) > 1:
        common = set.intersection(*[set(v) for v in per_section.values()])
        shared = sorted(common, key=lambda g: (np.mean([v[g] for v in per_section.values()]), g))
    return {
        "sections": sections, "top": top, "shared": shared[:500], "n_shared": len(shared),
        "scope": scope_text(ctx, p.get("scope")),
        "expression": f"log1p(UMIs per {ctx.target_sum:g} UMIs of the {ctx.unit})",
        "table": table([("section", "Section", "text"), ("rank", "Rank", "int"), ("gene", "Gene", "text"),
                        ("I", "Moran's I", "number"), ("z", "z", "number"), ("p", "P", "number"),
                        ("fdr", "FDR", "number"), ("pct_detected", "% detecting", "number")], rows),
        "notes": notes_of(
            f"Every gene detected in at least {min_units} {ctx.units} is tested; the {top} genes with the highest "
            f"Moran's I of each section are listed. P values are the analytic ones under normality (one-sided), "
            f"adjusted over the genes tested in the section.",
            "Abundant genes reach a high Moran's I more easily: look at the map before reading biology into a rank.",
            unmatched_note(ctx, int((scope & ~E.matched).sum()))),
    }


def run_table_chart(ctx: Context, p: dict) -> dict:
    """A chart of a result table of the run: the chosen columns of its rows (at most TABLE_CHART_ROWS), drawn as
    points, lines or bars by the Analysis tab."""
    if ctx.tables is None:
        raise ToolError("this run has no result tables")
    name = p.get("file")
    if not isinstance(name, str) or name not in ctx.table_names:
        raise ToolError("Table: choose one of the run's result tables")
    df = ctx.tables(name)
    cols = {}
    for key, label, required in (("x", "X", True), ("y", "Y", True), ("color", "Color by", False),
                                 ("label", "Label", False)):
        c = p.get(key)
        if c in (None, ""):
            if required:
                raise ToolError(f"{label}: choose a column of {name}")
            continue
        if not isinstance(c, str) or c not in df.columns:
            raise ToolError(f"{label}: {name} has no column {c!r}")
        cols[key] = c
    kind = get_choice(p, "kind", ("points", "line", "bars"), "points", "Chart")
    n_all = len(df)
    df = df.loc[:, list(dict.fromkeys(cols.values()))].head(TABLE_CHART_ROWS)
    data, columns = {}, []
    for c in df.columns:
        s = df[c]
        if pd.api.types.is_bool_dtype(s):
            data[c], kind_c = [bool(v) for v in s.tolist()], "bool"
        elif pd.api.types.is_numeric_dtype(s):
            data[c], kind_c = finite(s.to_numpy(dtype=np.float64, na_value=np.nan)), "number"
        else:
            data[c], kind_c = [None if pd.isna(v) else str(v) for v in s.tolist()], "text"
        columns.append((c, c, kind_c))
    if dict(((c, k) for c, _, k in columns)).get(cols["y"]) != "number":
        raise ToolError(f"Y: column {cols['y']} of {name} is not a number")
    return {
        "file": name, "kind": kind, **{k: cols.get(k) for k in ("x", "y", "color", "label")}, "n_rows": n_all,
        "table": table(columns, data),
        "notes": notes_of(f"The table has {n_all:,} rows; the first {TABLE_CHART_ROWS:,} are drawn."
                          if n_all > TABLE_CHART_ROWS else None),
    }


# ============================================================================
# REGISTRY
# ============================================================================
# Each parameter of a tool is described for the form of the Analysis tab: {"key", "label", "type", ...}. Types:
#   genes (a list of gene names; min, max), gene (one), grouping ({"field", "values"}: a field and the values that
#   become groups; optional), conditions (a list of {"field", "values"} or {"genes", "detected"}), scope ({"samples",
#   "roi", "where"}), count (composition: {"field", "values"} or {"calls": [yes/no fields]}), category (a category
#   field and its values), int / float (min, max, step, default), choice (options [[value, label]], default), bool
#   (default), text, table / column (table_chart). "advanced": shown under "More settings". "help": one line.

@dataclass(frozen=True)
class Tool:
    id: str
    title: str
    group: str
    summary: str
    params: tuple
    run: Callable
    expression: bool = True      # needs the raw counts of the run
    icon: str = "chart"

    def describe(self, unit: str = "bin") -> dict:
        """The tool for the Analysis tab's forms, its texts in the run's unit (bin, spot or cell)."""
        def param(q: dict) -> dict:
            q = dict(q)
            for k in ("label", "help", "placeholder"):
                q[k] = unit_text(q[k], unit) if k in q else None
                if q[k] is None:
                    del q[k]
            if isinstance(q.get("options"), list):
                q["options"] = [[o[0], unit_text(o[1], unit), *o[2:]] if isinstance(o, (list, tuple)) and len(o) > 1
                                else o for o in q["options"]]
            return q
        return {"id": self.id, "title": unit_text(self.title, unit), "group": self.group,
                "summary": unit_text(self.summary, unit), "params": [param(q) for q in self.params],
                "expression": self.expression, "icon": self.icon}


SCOPE = {"key": "scope", "label": "Scope", "type": "scope",
         "help": "The bins the analysis works on: sections, the region of interest, and any condition."}
SEED = {"key": "seed", "label": "Seed", "type": "int", "min": 0, "max": 2 ** 31 - 1, "default": 0, "advanced": True,
        "help": "The same seed gives the same random draws."}
MIN_BINS = {"key": "min_bins", "label": "Detected in at least (bins)", "type": "int", "min": 1, "max": 1_000_000,
            "advanced": True}

TOOLS = (
    Tool("expression", "Expression by group", "Expression",
         "How strongly chosen genes are expressed in each group of bins: violin, box, dot plot or heatmap.",
         ({"key": "genes", "label": "Genes", "type": "genes", "min": 1, "max": MAX_GENES},
          {"key": "group_by", "label": "Groups", "type": "grouping",
           "help": "Each value of the field is one group; pick values to leave the others out."},
          {"key": "split_by", "label": "Split each group by", "type": "grouping", "optional": True,
           "help": "For example by section, to compare the same cell type between sections."},
          SCOPE), run_expression),
    Tool("de", "Differential expression", "Expression",
         "Genes higher or lower in one group of bins than in another: volcano plot and table.",
         ({"key": "a", "label": "Group A", "type": "conditions", "required": True,
           "help": "The bins that meet every condition."},
          {"key": "b", "label": "Group B", "type": "conditions",
           "help": "Leave empty to compare group A with every other bin of the scope."},
          SCOPE,
          {"key": "method", "label": "Test", "type": "choice", "default": "wilcoxon",
           "options": [["wilcoxon", "Wilcoxon rank-sum"], ["t-test", "Welch's t test"]], "advanced": True},
          {"key": "ties", "label": "Tied ranks", "type": "choice", "default": "corrected",
           "options": [["corrected", "Corrected (recommended)"], ["scanpy", "Not corrected (scanpy's default)"]],
           "advanced": True, "help": "Wilcoxon only. Most bins tie at zero; the correction accounts for it."},
          {**MIN_BINS, "default": 3, "help": "Genes detected in fewer bins of the two groups are not tested."}),
         run_de),
    Tool("composition", "Composition", "Composition",
         "What share of the bins of each section or group is each cell type, domain or positive call.",
         ({"key": "count", "label": "Count", "type": "count",
           "help": "A field whose values exclude each other (cell type, tissue class, Leiden domain), or yes/no "
                   "calls counted one by one."},
          {"key": "across", "label": "Across", "type": "grouping", "default": {"field": "sample"},
           "help": "One bar per value of this field."},
          {"key": "denominator", "label": "Share of", "type": "choice", "default": "all", "advanced": True,
           "options": [["all", "All bins of the group"], ["listed", "The bins of the chosen values only"]]},
          SCOPE), run_composition, expression=False),
    Tool("coexpression", "Genes that follow a gene", "Expression",
         "The genes whose expression rises and falls with one gene over the bins.",
         ({"key": "gene", "label": "Gene", "type": "gene"}, SCOPE,
          {**MIN_BINS, "default": 10, "help": "Genes detected in fewer bins of the scope are not tested."}),
         run_coexpression),
    Tool("gene_pair", "Two genes", "Expression",
         "Two genes against each other: correlation, bins detecting both, and their joint distribution.",
         ({"key": "x", "label": "Gene X", "type": "gene"}, {"key": "y", "label": "Gene Y", "type": "gene"}, SCOPE),
         run_gene_pair),
    Tool("score", "Gene-set score", "Expression",
         "Score your own gene list in every bin; compare the groups and see it on the map.",
         ({"key": "name", "label": "Name of the gene set", "type": "text", "optional": True},
          {"key": "genes", "label": "Genes", "type": "genes", "min": 2, "max": MAX_SET_GENES},
          {"key": "group_by", "label": "Groups", "type": "grouping", "default": {"field": "sample"}},
          {"key": "split_by", "label": "Split each group by", "type": "grouping", "optional": True}, SCOPE,
          {"key": "ctrl_size", "label": "Control genes per expression bin", "type": "int", "min": 1, "max": 500,
           "default": 50, "advanced": True}, SEED), run_score, icon="dna"),
    Tool("distance", "Distance between two groups", "Space",
         "How far the bins of one group lie from the nearest bin of another, against random placement.",
         ({"key": "a", "label": "From (group A)", "type": "conditions", "required": True},
          {"key": "b", "label": "To (group B)", "type": "conditions", "required": True},
          {**SCOPE, "help": "The bins both groups are placed among under the null; each section is tested on its own."},
          {"key": "radius_um", "label": "Radius (um)", "type": "float", "min": 0, "max": 1e7, "default": 50, "step": 1,
           "help": "Also reported: the share of A bins with a B bin within this distance."},
          {"key": "n_perm", "label": "Random placements", "type": "int", "min": 0, "max": MAX_PERMUTATIONS,
           "default": 199, "advanced": True},
          {**MIN_BINS, "key": "min_bins", "label": "Minimum bins per group", "default": 10},
          {"key": "exclude_self", "label": "Measure a B bin to the nearest other B bin", "type": "bool",
           "default": False, "advanced": True}, SEED), run_distance, expression=False, icon="map"),
    Tool("neighborhood", "Neighborhood enrichment", "Space",
         "Which cell types, classes or domains sit next to each other more often than chance.",
         ({"key": "field", "label": "Categories", "type": "category"}, SCOPE,
          {"key": "k", "label": "Neighbors per bin", "type": "int", "min": 1, "max": 50, "default": 8,
           "help": "8 is the ring of bins around a bin on a square grid."},
          {"key": "n_perm", "label": "Shuffles", "type": "int", "min": 10, "max": MAX_PERMUTATIONS, "default": 199,
           "advanced": True}, SEED), run_neighborhood, expression=False, icon="grid"),
    Tool("svg", "Spatially variable genes", "Space",
         "Genes whose expression is patterned in space rather than scattered (Moran's I).",
         (SCOPE, {**MIN_BINS, "default": 10, "help": "Genes detected in fewer bins of a section are not tested."},
          {"key": "top", "label": "Genes kept per section", "type": "int", "min": 1, "max": 5000, "default": 200,
           "advanced": True}), run_svg, icon="map"),
    Tool("table_chart", "Chart from a table", "Custom",
         "Draw any result table of the run: choose the columns for X, Y and color.",
         ({"key": "file", "label": "Table", "type": "table"}, {"key": "x", "label": "X", "type": "column"},
          {"key": "y", "label": "Y", "type": "column", "numeric": True},
          {"key": "color", "label": "Color by", "type": "column", "optional": True},
          {"key": "label", "label": "Label", "type": "column", "optional": True},
          {"key": "kind", "label": "Chart", "type": "choice", "default": "points",
           "options": [["points", "Points"], ["line", "Line"], ["bars", "Bars"]]}), run_table_chart,
         expression=False, icon="table"),
)
TOOLS_BY_ID = {t.id: t for t in TOOLS}


def run_tool(tool_id: str, ctx: Context, params: dict) -> tuple[dict, dict]:
    """(result, arrays) of one tool; ToolError when it cannot be computed as asked."""
    tool = TOOLS_BY_ID.get(tool_id)
    if tool is None:
        raise ToolError(f"there is no analysis tool {tool_id!r}")
    if not isinstance(params, dict):
        raise ToolError("the settings of an analysis must be an object")
    out = tool.run(ctx, params)
    unit = getattr(ctx, "unit", "bin")
    if isinstance(out, dict) and set(out) == {"result", "arrays"}:
        return in_units(out["result"], unit), out["arrays"]
    return in_units(out, unit), {}


def result_csv(result: dict) -> str:
    """The table of a result as CSV text (comma-separated, LF line endings; empty cells for missing values)."""
    import csv
    import io
    t = result.get("table") if isinstance(result, dict) else None
    if not isinstance(t, dict) or not t.get("columns"):
        raise ToolError("this analysis has no table")
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\n")
    keys = [c["key"] for c in t["columns"]]
    writer.writerow([c.get("label") or c["key"] for c in t["columns"]])
    data = t.get("data") or {}
    for i in range(int(t.get("rows") or 0)):
        writer.writerow(["" if data[k][i] is None else data[k][i] for k in keys])
    return out.getvalue()
