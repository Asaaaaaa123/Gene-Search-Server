#!/usr/bin/env python3
"""
tools/make_platform_data.py
===========================
[APP] 2026-11-14. The synthetic sections of tools/make_demo_data.py written again in the layouts of other instruments,
for the tests of spatial_readers.py and for trying the application with them:

    python -m tools.make_platform_data OUT_DIR [--size tiny|small]

Each Visium HD bin of the demo becomes a unit of the other platform with the same counts and the same position (its
centre, in micrometres), so every reader must give back exactly the demo's counts and positions; each layout also
holds what the instrument adds and the reader must leave out (control probes and codewords, blank barcodes, the
background "cell" 0 of a CosMx field of view, a unit without a position, an unused cell). The Stereo-seq files are
written from per-DNB records instead (stereo_records), since Stereo-seq bins are made by the reader.

The layouts follow the instruments' documentation (see spatial_readers.py); they are not files from the instruments.
"""
from __future__ import annotations

import argparse
import gzip
import json
import re
import sys
from pathlib import Path

import h5py
import numpy as np
import pandas as pd
from scipy import io as sio
from scipy import sparse

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

COSMX_UM_PER_PX = 0.12028
VISIUM_SPOT_DIAMETER_PX = 89.43            # Space Ranger's spot_diameter_fullres of a typical Visium slide
GZ = {"compression": "gzip", "compression_opts": 4, "shuffle": True}


# ============================================================================
# THE REFERENCE: A DEMO SECTION AS UNITS
# ============================================================================

def load_reference(square_dir) -> dict:
    """The in-tissue bins of a Visium HD square_XXXum/ folder of the demo: {"X" (CSR int64, bins x genes), "ids",
    "genes", "x_um", "y_um"}, in matrix order."""
    square_dir = Path(square_dir)
    with h5py.File(square_dir / "filtered_feature_bc_matrix.h5", "r") as f:
        m = f["matrix"]
        n_genes, n = (int(v) for v in m["shape"][()][:2])
        X = sparse.csr_matrix((m["data"][()].astype(np.int64), m["indices"][()], m["indptr"][()]), shape=(n, n_genes))
        ids = [b.decode() for b in m["barcodes"][()]]
        genes = [g.decode() for g in m["features"]["name"][()]]
    pos = pd.read_parquet(square_dir / "spatial" / "tissue_positions.parquet").set_index("barcode")
    sf = json.loads((square_dir / "spatial" / "scalefactors_json.json").read_text(encoding="utf-8"))
    pos = pos.reindex(ids)
    ok = pos["pxl_col_in_fullres"].notna().to_numpy()
    rows = np.flatnonzero(ok)
    mpp = float(sf["microns_per_pixel"])
    return {"X": X[rows].tocsr(), "ids": [re.sub(r"-\d+$", "", ids[i]) for i in rows.tolist()], "genes": genes,
            "x_um": pos["pxl_col_in_fullres"].to_numpy(float)[rows] * mpp,
            "y_um": pos["pxl_row_in_fullres"].to_numpy(float)[rows] * mpp}


def subset(d: dict, n: int) -> dict:
    """The first n units of a reference (small files for the format tests)."""
    return {"X": d["X"][:n].tocsr(), "ids": d["ids"][:n], "genes": list(d["genes"]), "x_um": d["x_um"][:n],
            "y_um": d["y_um"][:n]}


# ============================================================================
# WRITERS
# ============================================================================

def write_10x_h5(path, X: sparse.csr_matrix, barcodes, names, kinds=None) -> None:
    """A feature-barcode matrix in the 10x HDF5 layout (CSC by barcode), with feature types (default Gene
    Expression)."""
    X = sparse.csr_matrix(X, dtype=np.int64)
    kinds = kinds or ["Gene Expression"] * len(names)
    with h5py.File(path, "w") as f:
        f.attrs["filetype"] = "matrix"
        f.attrs["version"] = 2
        g = f.create_group("matrix")
        g.create_dataset("barcodes", data=np.array([b.encode() for b in barcodes]), **GZ)
        g.create_dataset("data", data=X.data.astype(np.int32), **GZ)
        g.create_dataset("indices", data=X.indices.astype(np.int64), **GZ)
        g.create_dataset("indptr", data=X.indptr.astype(np.int64), **GZ)
        g.create_dataset("shape", data=np.array([len(names), X.shape[0]], np.int32))
        ft = g.create_group("features")
        ft.create_dataset("feature_type", data=np.array([k.encode() for k in kinds]), **GZ)
        ft.create_dataset("id", data=np.array([f"F{i:06d}".encode() for i in range(len(names))]), **GZ)
        ft.create_dataset("name", data=np.array([n.encode() for n in names]), **GZ)


def _controls(rng, n_units: int, k: int, rate: float = 0.3) -> np.ndarray:
    return rng.poisson(rate, size=(n_units, k)).astype(np.int64)


def write_xenium(folder, d: dict, seed: int = 0, csv: bool = False) -> dict:
    """A Xenium output bundle: cell_feature_matrix.h5 (the genes, then negative control probes and unassigned
    codewords), cells.parquet (or cells.csv.gz; the cells in another order, one more cell than the matrix, one cell
    of the matrix without a centroid) and experiment.xenium. Returns {"missing": id of the cell without a position}."""
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(seed)
    n = d["X"].shape[0]
    # Xenium cell ids: eight letters a-p (hexadecimal digits shifted), then -1
    ids = ["".join(chr(ord("a") + int(c, 16)) for c in f"{i:08x}") + "-1" for i in range(1, n + 1)]
    ctrl = _controls(rng, n, 3) + 0
    X = sparse.hstack([d["X"], sparse.csr_matrix(ctrl)], format="csr")
    names = list(d["genes"]) + ["NegControlProbe_00001", "NegControlProbe_00002", "UnassignedCodeword_0001"]
    kinds = ["Gene Expression"] * len(d["genes"]) + ["Negative Control Probe"] * 2 + ["Unassigned Codeword"]
    write_10x_h5(folder / "cell_feature_matrix.h5", X, ids, names, kinds)
    order = rng.permutation(n)
    missing = ids[order[-1]]
    keep = order[:-1]
    cells = pd.DataFrame({"cell_id": [ids[i] for i in keep] + ["zzzzzzzz-1"],
                          "x_centroid": np.r_[d["x_um"][keep], 1.0], "y_centroid": np.r_[d["y_um"][keep], 1.0],
                          "transcript_counts": np.r_[np.asarray(d["X"][keep].sum(axis=1)).ravel(), 3],
                          "cell_area": 80.0, "nucleus_area": 30.0})
    if csv:
        cells.to_csv(folder / "cells.csv.gz", index=False)
    else:
        cells.to_parquet(folder / "cells.parquet", index=False)
    (folder / "experiment.xenium").write_text(json.dumps({"panel_name": "Synthetic bone panel", "pixel_size": 0.2125,
                                                          "num_cells": n}), encoding="utf-8")
    return {"missing": missing, "ids": ids}


def write_merscope(folder, d: dict, seed: int = 0) -> dict:
    """A MERSCOPE region folder: cell_by_gene.csv (column "cell", the genes and five Blank-* columns) and
    cell_metadata.csv (an unnamed first column of EntityIDs, fov, volume, center_x, center_y, bounds)."""
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(seed)
    n = d["X"].shape[0]
    ids = (np.arange(n, dtype=np.int64) * 7 + 1_000_000_000_000).tolist()
    dense = d["X"].toarray()
    cbg = pd.DataFrame(dense, columns=d["genes"])
    for k in range(5):
        cbg[f"Blank-{k}"] = rng.poisson(0.2, n)
    cbg.insert(0, "cell", ids)
    cbg.to_csv(folder / "cell_by_gene.csv", index=False)
    meta = pd.DataFrame({"fov": rng.integers(0, 4, n), "volume": 900.0, "center_x": d["x_um"], "center_y": d["y_um"],
                         "min_x": d["x_um"] - 5, "max_x": d["x_um"] + 5, "min_y": d["y_um"] - 5,
                         "max_y": d["y_um"] + 5}, index=pd.Index(ids, name=""))
    meta.to_csv(folder / "cell_metadata.csv")
    return {"ids": [str(i) for i in ids]}


def write_cosmx(folder, d: dict, seed: int = 0, run: str = "Run5", gz: bool = True) -> dict:
    """CosMx flat files: <run>_exprMat_file.csv.gz (fov, cell_ID, the genes, negative probes, system controls and the
    background row cell_ID 0 of every field of view) and <run>_metadata_file.csv(.gz) (CenterX_global_px,
    CenterY_global_px in pixels of 0.12028 um)."""
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(seed)
    n = d["X"].shape[0]
    fov = 1 + (np.arange(n) % 3)
    cell_id = np.zeros(n, dtype=np.int64)
    for f_ in (1, 2, 3):
        m = fov == f_
        cell_id[m] = np.arange(1, int(m.sum()) + 1)
    dense = d["X"].toarray()
    expr = pd.DataFrame(dense, columns=d["genes"])
    expr.insert(0, "cell_ID", cell_id)
    expr.insert(0, "fov", fov)
    for k in range(1, 4):
        expr[f"NegPrb{k}"] = rng.poisson(0.2, n)
    expr["SystemControl1"] = rng.poisson(0.1, n)
    background = pd.DataFrame(rng.poisson(2.0, (3, expr.shape[1])), columns=expr.columns)
    background["fov"], background["cell_ID"] = [1, 2, 3], 0
    expr = pd.concat([background, expr], ignore_index=True)
    name = f"{run}_exprMat_file.csv" + (".gz" if gz else "")
    expr.to_csv(folder / name, index=False)
    meta = pd.DataFrame({"fov": fov, "cell_ID": cell_id, "Area": 900, "AspectRatio": 1.1,
                         "CenterX_local_px": 100, "CenterY_local_px": 100,
                         "CenterX_global_px": d["x_um"] / COSMX_UM_PER_PX, "CenterY_global_px": d["y_um"] / COSMX_UM_PER_PX,
                         "Width": 60, "Height": 60})
    meta.to_csv(folder / (f"{run}_metadata_file.csv" + (".gz" if gz else "")), index=False)
    return {"ids": [f"{a}_{b}" for a, b in zip(fov.tolist(), cell_id.tolist())]}


def write_h5ad(path, d: dict, mode: str = "layers", ensembl: bool = False) -> None:
    """An AnnData file: the counts in layers["counts"] (mode "layers", X log-normalized), in raw.X (mode "raw") or
    in X (mode "X"); obsm["spatial"] in micrometres; with ensembl, var's index holds Ensembl ids and
    var["gene_symbols"] the names."""
    import anndata as ad
    X = sparse.csr_matrix(d["X"], dtype=np.float32)
    total = np.asarray(X.sum(axis=1)).ravel()
    norm = sparse.diags(np.divide(1e4, total, out=np.zeros_like(total), where=total > 0)) @ X
    norm.data = np.log1p(norm.data)
    var_index = [f"ENSMUSG{i:011d}" for i in range(len(d["genes"]))] if ensembl else list(d["genes"])
    var = pd.DataFrame(index=pd.Index(var_index))
    if ensembl:
        var["gene_symbols"] = list(d["genes"])
    obs = pd.DataFrame(index=pd.Index(list(d["ids"])))
    if mode == "layers":
        a = ad.AnnData(X=norm.tocsr(), obs=obs, var=var, layers={"counts": X.tocsr()})
    elif mode == "raw":
        a = ad.AnnData(X=X.tocsr(), obs=obs, var=var)
        a.raw = a.copy()
        a.X = norm.tocsr()
    else:
        a = ad.AnnData(X=X.tocsr(), obs=obs, var=var)
    a.obsm["spatial"] = np.column_stack([d["x_um"], d["y_um"]])
    a.write_h5ad(path)


def write_table(folder, d: dict, mode: str = "mex") -> None:
    """Plain tables: mode "mex", a 10x MEX folder (matrix.mtx.gz genes x units, barcodes.tsv.gz, features.tsv.gz) and
    coordinates.csv (barcode, x, y); mode "csv", counts.csv (one row per unit) and positions.csv (cell_id, x_um,
    y_um)."""
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    if mode == "mex":
        with gzip.open(folder / "matrix.mtx.gz", "wb") as fh:
            sio.mmwrite(fh, sparse.csr_matrix(d["X"]).T.tocoo().astype(np.int64))
        with gzip.open(folder / "barcodes.tsv.gz", "wt", encoding="utf-8") as fh:
            fh.write("".join(f"{b}\n" for b in d["ids"]))
        with gzip.open(folder / "features.tsv.gz", "wt", encoding="utf-8") as fh:
            fh.write("".join(f"G{i:05d}\t{g}\tGene Expression\n" for i, g in enumerate(d["genes"])))
        pd.DataFrame({"barcode": d["ids"], "x": d["x_um"], "y": d["y_um"]}).to_csv(folder / "coordinates.csv",
                                                                                 index=False)
    else:
        counts = pd.DataFrame(d["X"].toarray(), columns=d["genes"])
        counts.insert(0, "", d["ids"])
        counts.to_csv(folder / "counts.csv", index=False)
        pd.DataFrame({"cell_id": d["ids"], "x_um": d["x_um"], "y_um": d["y_um"]}).to_csv(folder / "positions.csv",
                                                                                       index=False)


def write_visium(folder, d: dict, seed: int = 0) -> dict:
    """A standard Visium Space Ranger outs/ folder: filtered_feature_bc_matrix.h5, spatial/tissue_positions_list.csv
    (no header: every spot, also two outside the tissue), scalefactors_json.json (spot diameter, no microns per pixel)
    and tissue_hires_image.png. Positions are full-resolution pixels of 55 / spot_diameter_fullres um."""
    from PIL import Image
    folder = Path(folder)
    spatial = folder / "outs" / "spatial"
    spatial.mkdir(parents=True, exist_ok=True)
    n = d["X"].shape[0]
    mpp = 55.0 / VISIUM_SPOT_DIAMETER_PX
    barcodes = [f"{''.join('ACGT'[(i >> (2 * k)) & 3] for k in range(16))}-1" for i in range(n + 2)]
    write_10x_h5(folder / "outs" / "filtered_feature_bc_matrix.h5", d["X"], barcodes[:n], d["genes"])
    px, py = d["x_um"] / mpp, d["y_um"] / mpp
    rows = [[barcodes[i], 1, i // 50, (i % 50) * 2, round(py[i], 3), round(px[i], 3)] for i in range(n)]
    rows += [[barcodes[n], 0, 99, 0, 10.0, 10.0], [barcodes[n + 1], 0, 99, 2, 20.0, 20.0]]
    pd.DataFrame(rows).to_csv(spatial / "tissue_positions_list.csv", index=False, header=False)
    hires = 0.15
    (spatial / "scalefactors_json.json").write_text(json.dumps({
        "spot_diameter_fullres": VISIUM_SPOT_DIAMETER_PX, "tissue_hires_scalef": hires,
        "fiducial_diameter_fullres": 144.5, "tissue_lowres_scalef": 0.045}), encoding="utf-8")
    side = int(max(px.max(), py.max()) * hires) + 20
    Image.new("RGB", (side, side), (230, 200, 220)).save(spatial / "tissue_hires_image.png")
    return {"mpp": mpp, "barcodes": barcodes[:n]}


# ---- Stereo-seq ---------------------------------------------------------------------------------------------------

def stereo_records(seed: int = 0, n_genes: int = 12, size_dnb: int = 400, n_records: int = 6000,
                   n_cells: int = 0) -> dict:
    """Per-DNB records of a small synthetic Stereo-seq chip: {"genes": names, "gene": index per record, "x", "y"
    (DNB coordinates), "count", "cell" (cell id per record, 0 outside every cell; with n_cells)}; every (gene, x, y)
    once."""
    rng = np.random.default_rng(seed)
    gene = rng.integers(0, n_genes, n_records)
    x = rng.integers(0, size_dnb, n_records) + 1000
    y = rng.integers(0, size_dnb, n_records) + 2000
    key = (gene * 10_000 + (x - 1000)) * 10_000 + (y - 2000)
    _, first = np.unique(key, return_index=True)
    first = np.sort(first)
    gene, x, y = gene[first], x[first], y[first]
    count = rng.integers(1, 6, len(gene))
    cell = np.zeros(len(gene), dtype=np.int64)
    if n_cells:
        centres = rng.integers(0, size_dnb, (n_cells, 2)) + [1000, 2000]
        d2 = (x[:, None] - centres[None, :, 0]) ** 2 + (y[:, None] - centres[None, :, 1]) ** 2
        near = d2.argmin(axis=1)
        inside = d2[np.arange(len(x)), near] < 30 ** 2
        cell[inside] = near[inside] + 1
    return {"genes": [f"Gene{g:02d}" for g in range(n_genes)], "gene_ids": [f"ENSG{g:011d}" for g in range(n_genes)],
            "gene": gene, "x": x, "y": y, "count": count, "cell": cell}


def write_stereo_gem(path, r: dict, cells: bool = False) -> None:
    """A GEM table (tab-separated, # header lines): geneID, geneName, x, y, MIDCount, ExonCount (and CellID, the
    records of cells only, with cells)."""
    path = Path(path)
    df = pd.DataFrame({"geneID": [r["gene_ids"][g] for g in r["gene"]], "geneName": [r["genes"][g] for g in r["gene"]],
                       "x": r["x"], "y": r["y"], "MIDCount": r["count"], "ExonCount": r["count"]})
    head = ["#FileFormat=GEMv0.2", "#SortedBy=None", f"#BinType={'CellBin' if cells else 'Bin'}",
            f"#BinSize={'Cell' if cells else 1}", "#Omics=Transcriptomics", "#Stereo-seqChip=SYNTH01",
            "#OffsetX=0", "#OffsetY=0"]
    if cells:
        df["CellID"] = r["cell"]
        df = df[df["CellID"] > 0]
    text = "\n".join(head) + "\n" + df.to_csv(sep="\t", index=False, lineterminator="\n")
    if path.name.endswith(".gz"):
        with gzip.open(path, "wt", encoding="utf-8", newline="") as fh:
            fh.write(text)
    else:
        path.write_text(text, encoding="utf-8", newline="")


def _gef_level(group, r: dict, level: int, coarse: str) -> None:
    """geneExp/bin<level>: the records summed into bins of `level` DNBs, x and y the bin index (coarse "index") or
    the DNB coordinate of its corner (coarse "dnb"); rows grouped by gene."""
    bx, by = r["x"] // level, r["y"] // level
    df = pd.DataFrame({"g": r["gene"], "bx": bx, "by": by, "c": r["count"]}).groupby(["g", "bx", "by"],
                                                                                      as_index=False)["c"].sum()
    df = df.sort_values(["g", "bx", "by"], kind="stable")
    mult = 1 if (coarse == "index" or level == 1) else level
    expr = np.zeros(len(df), dtype=[("x", "<i4"), ("y", "<i4"), ("count", "<u2")])
    expr["x"], expr["y"], expr["count"] = df["bx"] * mult, df["by"] * mult, df["c"]
    counts = df.groupby("g").size().reindex(range(len(r["genes"])), fill_value=0).to_numpy()
    offsets = np.r_[0, np.cumsum(counts)[:-1]]
    gene = np.zeros(len(r["genes"]), dtype=[("geneID", "S64"), ("geneName", "S64"), ("offset", "<u4"),
                                            ("count", "<u4")])
    gene["geneID"] = [s.encode() for s in r["gene_ids"]]
    gene["geneName"] = [s.encode() for s in r["genes"]]
    gene["offset"], gene["count"] = offsets, counts
    lvl = group.create_group(f"bin{level}")
    lvl.create_dataset("gene", data=gene)
    e = lvl.create_dataset("expression", data=expr)
    for k, v in (("minX", expr["x"].min()), ("minY", expr["y"].min()), ("maxX", expr["x"].max()),
                 ("maxY", expr["y"].max()), ("maxExp", expr["count"].max()), ("resolution", 500)):
        e.attrs[k] = np.int32(v) if k != "maxExp" else np.uint32(v)


def write_stereo_gef(path, r: dict, levels=(1, 50), coarse: str = "index") -> None:
    """A square-bin GEF (HDF5): root attributes (version, resolution 500 nm, ...) and geneExp/bin<N>/gene and
    /expression for every level."""
    with h5py.File(path, "w") as f:
        f.attrs["version"] = np.uint32(2)
        f.attrs["resolution"] = np.uint32(500)
        f.attrs["omics"] = np.bytes_(b"Transcriptomics")
        f.attrs["bin_type"] = np.bytes_(b"Bin")
        g = f.create_group("geneExp")
        for level in levels:
            _gef_level(g, r, level, coarse)


def write_stereo_cellbin_gef(path, r: dict) -> None:
    """A cell-bin GEF: cellBin/cell (id, x, y = count-weighted centre, offset, geneCount, expCount, ...),
    cellBin/cellExp (geneID = gene index, count) and cellBin/gene (geneID, geneName, ...), resolution 500 nm."""
    m = r["cell"] > 0
    df = pd.DataFrame({"cell": r["cell"][m], "g": r["gene"][m], "c": r["count"][m], "x": r["x"][m], "y": r["y"][m]})
    per = df.groupby(["cell", "g"], as_index=False)["c"].sum().sort_values(["cell", "g"], kind="stable")
    cells = sorted(per["cell"].unique().tolist())
    n_per = per.groupby("cell").size().reindex(cells).to_numpy()
    w = df.assign(wx=df["x"] * df["c"], wy=df["y"] * df["c"]).groupby("cell")[["wx", "wy", "c"]].sum().reindex(cells)
    cell = np.zeros(len(cells), dtype=[("id", "<u4"), ("x", "<i4"), ("y", "<i4"), ("offset", "<u4"),
                                       ("geneCount", "<u2"), ("expCount", "<u2"), ("dnbCount", "<u2"),
                                       ("area", "<u2"), ("cellTypeID", "<u4"), ("clusterID", "<u4")])
    cell["id"] = cells
    cell["x"] = np.rint(w["wx"] / w["c"]).astype(int)
    cell["y"] = np.rint(w["wy"] / w["c"]).astype(int)
    cell["offset"] = np.r_[0, np.cumsum(n_per)[:-1]]
    cell["geneCount"] = n_per
    cell["expCount"] = w["c"].to_numpy()
    cexp = np.zeros(len(per), dtype=[("geneID", "<u4"), ("count", "<u2")])
    cexp["geneID"], cexp["count"] = per["g"], per["c"]
    gene = np.zeros(len(r["genes"]), dtype=[("geneID", "S32"), ("geneName", "S32"), ("offset", "<u4"),
                                            ("cellCount", "<u4"), ("expCount", "<u4"), ("maxMIDcount", "<u2")])
    gene["geneID"] = [s.encode() for s in r["gene_ids"]]
    gene["geneName"] = [s.encode() for s in r["genes"]]
    with h5py.File(path, "w") as f:
        f.attrs["resolution"] = np.uint32(500)
        f.attrs["bin_type"] = np.bytes_(b"CellBin")
        f.attrs["offsetX"], f.attrs["offsetY"] = np.int32(0), np.int32(0)
        cb = f.create_group("cellBin")
        cb.create_dataset("cell", data=cell)
        cb.create_dataset("cellExp", data=cexp)
        cb.create_dataset("gene", data=gene)


# ============================================================================
# ALL OF THEM
# ============================================================================

def generate(out_dir, size: str = "tiny", seed: int = 0) -> list[dict]:
    """The demo sections in every layout, one folder per platform and section, and a Stereo-seq chip; returns the
    sample entries of a project that reads them (id, label, condition, color, path, platform)."""
    from tools.make_demo_data import generate as demo
    out = Path(out_dir)
    base = demo(out / "visium_hd", size=size, seed=seed)
    samples = []
    for s in base:
        d = load_reference(Path(s["path"]) / "square_016um")
        for platform, write in (("xenium", write_xenium), ("merscope", write_merscope), ("cosmx", write_cosmx)):
            folder = out / platform / s["id"]
            write(folder, d, seed=seed)
            samples.append({**s, "id": f"{s['id']}-{platform}", "path": str(folder), "platform": platform,
                            "microns_per_pixel": None})
        h5ad = out / "h5ad" / f"{s['id']}.h5ad"
        h5ad.parent.mkdir(parents=True, exist_ok=True)
        write_h5ad(h5ad, d)
        samples.append({**s, "id": f"{s['id']}-h5ad", "path": str(h5ad), "platform": "h5ad", "microns_per_pixel": None})
    r = stereo_records(seed=seed, n_cells=40)
    (out / "stereo_seq").mkdir(parents=True, exist_ok=True)
    write_stereo_gef(out / "stereo_seq" / "SYNTH01.tissue.gef", r)
    return samples


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="The demo sections in the layouts of other instruments.")
    ap.add_argument("out_dir")
    ap.add_argument("--size", choices=["tiny", "small"], default="tiny")
    args = ap.parse_args(argv)
    for s in generate(args.out_dir, size=args.size):
        print(f"{s['platform']:9s} {s['id']:24s} {s['path']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
