"""
tests/test_spatial_readers.py
=============================
spatial_readers.py on files written by tools/make_platform_data.py: every reader gives back exactly the counts and
positions it was given (a demo section rewritten in the instrument's layout), leaves out what the instrument adds
(control probes, blank barcodes, background cells, units without a position), and says why it cannot read what it
cannot.
"""
from __future__ import annotations

import gzip
import shutil

import h5py
import numpy as np
import pandas as pd
import pytest
from scipy import sparse

import spatial_readers as sr
from tools import make_platform_data as mp

N = 300  # units of the reference written in each layout (small files)


@pytest.fixture(scope="module")
def ref(tiny_demo):
    d = mp.load_reference(f"{tiny_demo['samples'][0]['path']}/square_016um")
    assert d["X"].shape[0] > N and d["X"].nnz
    return mp.subset(d, N)


def by_id(sec: sr.Section, ids) -> np.ndarray:
    """The rows of a section, in the order of `ids`."""
    at = {b: i for i, b in enumerate(sec.barcodes)}
    return np.array([at[i] for i in ids])


def same_units(sec: sr.Section, ref: dict, ids: list[str], scale: float = 1.0, drop=()):
    """The section holds the reference's units (ids given in reference order, `drop` left out) with the same counts
    and positions (x * microns_per_unit = the reference's micrometres)."""
    keep = [i for i, b in enumerate(ids) if b not in set(drop)]
    rows = by_id(sec, [ids[i] for i in keep])
    assert sec.n == len(keep) and sec.genes == ref["genes"]
    assert (sec.X[rows] != ref["X"][keep]).nnz == 0
    assert np.allclose(sec.x[rows] * sec.microns_per_unit, ref["x_um"][keep], atol=1e-6 * max(1.0, scale))
    assert np.allclose(sec.y[rows] * sec.microns_per_unit, ref["y_um"][keep], atol=1e-6 * max(1.0, scale))
    assert sec.X.dtype == np.int64 and len(set(sec.barcodes)) == sec.n


def test_xenium(ref, tmp_path):
    for csv in (False, True):
        folder = tmp_path / f"xenium-{csv}"
        made = mp.write_xenium(folder, ref, csv=csv)
        assert sr.detect(folder) == "xenium"
        loc = sr.locate(folder)
        assert loc.platform == "xenium" and loc.files["positions"].name == ("cells.csv.gz" if csv else "cells.parquet")
        sec = sr.read(loc)
        same_units(sec, ref, made["ids"], drop=[made["missing"]])
        assert sec.unit == "cell" and sec.microns_per_unit == 1.0 and sec.n_read == N and sec.grid is None
        assert any("1 cells of the matrix have no centroid" in n for n in sec.notes)
        assert any("Synthetic bone panel" in n for n in sec.notes)
        info = sr.inspect(loc)
        assert info["n_units"] == N and info["genes"] == ref["genes"] and info["unit"] == "cell"


def test_merscope(ref, tmp_path):
    made = mp.write_merscope(tmp_path / "region_0", ref)
    loc = sr.locate(tmp_path / "region_0")
    assert loc.platform == "merscope"
    sec = sr.read(loc)
    same_units(sec, ref, made["ids"])
    assert not any(g.lower().startswith("blank") for g in sec.genes)
    assert any("5 Blank-* control columns left out" in n for n in sec.notes)
    info = sr.inspect(loc)
    assert info["genes"] == ref["genes"] and info["n_units"] == N


def test_cosmx(ref, tmp_path):
    for gz in (True, False):
        folder = tmp_path / f"cosmx-{gz}"
        made = mp.write_cosmx(folder, ref, gz=gz)
        loc = sr.locate(folder)
        assert loc.platform == "cosmx"
        sec = sr.read(loc)
        assert sec.microns_per_unit == sr.COSMX_UM_PER_PX
        same_units(sec, ref, made["ids"], scale=1 / sr.COSMX_UM_PER_PX)
        assert not any(g.startswith(("NegPrb", "SystemControl")) for g in sec.genes)
        assert not any(b.endswith("_0") for b in sec.barcodes)                # the background of every field
        assert sr.inspect(loc)["genes"] == ref["genes"]
    # the sample's own micrometres per pixel replaces the platform's
    assert sr.read(sr.locate(tmp_path / "cosmx-True"), microns_per_unit=0.18).microns_per_unit == 0.18


@pytest.mark.parametrize("mode,ensembl", [("layers", False), ("raw", True), ("X", False)])
def test_h5ad(ref, tmp_path, mode, ensembl):
    path = tmp_path / f"{mode}.h5ad"
    mp.write_h5ad(path, ref, mode=mode, ensembl=ensembl)
    assert sr.detect(path) == "h5ad" and sr.detect(tmp_path) is None or sr.detect(tmp_path) == "h5ad"
    sec = sr.read(sr.locate(path))
    same_units(sec, ref, ref["ids"])
    source = {"layers": "layers/counts", "raw": "raw/X", "X": "X"}[mode]
    assert any(f"counts from {source}" in n for n in sec.notes)
    assert any("gene symbols from var['gene_symbols']" in n for n in sec.notes) == ensembl
    assert any("positions taken as micrometres" in n for n in sec.notes)
    info = sr.inspect(sr.locate(path))
    assert info["n_units"] == N


def test_h5ad_without_counts_is_refused(ref, tmp_path):
    import anndata as ad
    X = sparse.csr_matrix(ref["X"], dtype=np.float32)
    X.data = np.log1p(X.data)
    a = ad.AnnData(X=X, obs=pd.DataFrame(index=ref["ids"]), var=pd.DataFrame(index=ref["genes"]))
    a.obsm["spatial"] = np.column_stack([ref["x_um"], ref["y_um"]])
    a.write_h5ad(tmp_path / "norm.h5ad")
    with pytest.raises(sr.ReadError, match="no raw counts"):
        sr.read(sr.locate(tmp_path / "norm.h5ad"))
    del a.obsm["spatial"]
    a.X = sparse.csr_matrix(ref["X"], dtype=np.float32)
    a.write_h5ad(tmp_path / "nopos.h5ad")
    with pytest.raises(sr.ReadError, match=r"no obsm\['spatial'\]"):
        sr.read(sr.locate(tmp_path / "nopos.h5ad"))


def test_tables(ref, tmp_path):
    for mode in ("mex", "csv"):
        folder = tmp_path / mode
        mp.write_table(folder, ref, mode=mode)
        loc = sr.locate(folder)
        assert loc.platform == "table" and ("matrix" in loc.files) == (mode == "mex")
        sec = sr.read(loc)
        same_units(sec, ref, ref["ids"])
        assert sr.inspect(loc)["genes"] == ref["genes"]


def test_positions_of_another_run_are_refused(ref, tmp_path):
    mp.write_table(tmp_path / "t", ref, mode="mex")
    coords = pd.read_csv(tmp_path / "t" / "coordinates.csv")
    coords["barcode"] = [f"other-{i}" for i in range(len(coords))]
    coords.iloc[:10].assign(barcode=ref["ids"][:10]).to_csv(tmp_path / "t" / "coordinates.csv", index=False)
    with pytest.raises(sr.ReadError, match=r"only 10 of the 300 units of the counts have a position"):
        sr.read(sr.locate(tmp_path / "t"))


def test_visium_standard_is_found(ref, tmp_path):
    made = mp.write_visium(tmp_path / "SR_slide", ref)
    assert sr.detect(tmp_path / "SR_slide") == "visium"
    loc = sr.locate(tmp_path / "SR_slide")
    assert loc.files["positions"].name == "tissue_positions_list.csv"
    assert loc.files["counts"] == tmp_path / "SR_slide" / "outs" / "filtered_feature_bc_matrix.h5"
    assert made["mpp"] == pytest.approx(55.0 / mp.VISIUM_SPOT_DIAMETER_PX)
    with pytest.raises(sr.ReadError, match="Space Ranger readers"):
        sr.read(loc)


def expected_bins(r: dict, bin_dnb: int) -> pd.DataFrame:
    """The records summed into square bins: one row per (bin, gene) with a count."""
    return (pd.DataFrame({"bx": r["x"] // bin_dnb, "by": r["y"] // bin_dnb, "gene": [r["genes"][g] for g in r["gene"]],
                          "count": r["count"]})
            .groupby(["bx", "by", "gene"], as_index=False)["count"].sum())


def as_long(sec: sr.Section) -> pd.DataFrame:
    coo = sec.X.tocoo()
    row, col = sec.grid
    return pd.DataFrame({"bx": col[coo.row], "by": row[coo.row], "gene": [sec.genes[j] for j in coo.col],
                         "count": coo.data}).sort_values(["bx", "by", "gene"]).reset_index(drop=True)


def test_stereo_square_bins(tmp_path):
    r = mp.stereo_records(seed=3)
    mp.write_stereo_gem(tmp_path / "chip.gem.gz", r)
    mp.write_stereo_gef(tmp_path / "idx.gef", r, levels=(1, 50), coarse="index")
    mp.write_stereo_gef(tmp_path / "dnb.gef", r, levels=(50,), coarse="dnb")
    for bin_um, bin_dnb in ((16.0, 32), (25.0, 50)):
        want = expected_bins(r, bin_dnb).sort_values(["bx", "by", "gene"]).reset_index(drop=True)
        files = ["chip.gem.gz", "idx.gef"] + (["dnb.gef"] if bin_dnb == 50 else [])
        for name in files:
            sec = sr.read(sr.locate(tmp_path / name, bin_um=bin_um))
            got = as_long(sec)
            assert got.equals(want[got.columns].astype(got.dtypes.to_dict())), (name, bin_um)
            assert sec.unit == "bin" and sec.size_um == pytest.approx(bin_dnb * 0.5)
            row, col = sec.grid
            assert np.allclose(sec.x, (col * bin_dnb + bin_dnb / 2) * 0.5) and sec.microns_per_unit == 1.0
            assert any(f"square bins of {bin_dnb} DNBs" in n for n in sec.notes)
    # a level that does not tile the bin size, without bin1
    with pytest.raises(sr.ReadError, match="tiles bins of 32 DNBs"):
        sr.read(sr.locate(tmp_path / "dnb.gef", bin_um=16.0))
    assert sr.detect(tmp_path) == "stereo_seq" and sr.inspect(sr.locate(tmp_path / "idx.gef"))["genes"] == r["genes"]


def test_stereo_cells(tmp_path):
    r = mp.stereo_records(seed=4, n_cells=25)
    mp.write_stereo_gem(tmp_path / "cells.gem", r, cells=True)
    mp.write_stereo_cellbin_gef(tmp_path / "chip.cellbin.gef", r)
    m = r["cell"] > 0
    want = (pd.DataFrame({"cell": r["cell"][m].astype(str), "gene": [r["genes"][g] for g in r["gene"][m]],
                          "count": r["count"][m]}).groupby(["cell", "gene"])["count"].sum())
    secs = [sr.read(sr.locate(tmp_path / n)) for n in ("cells.gem", "chip.cellbin.gef")]
    for sec in secs:
        assert sec.unit == "cell" and sec.microns_per_unit == 0.5 and sec.grid is None
        coo = sec.X.tocoo()
        got = pd.Series(coo.data, index=pd.MultiIndex.from_arrays(
            [[sec.barcodes[i] for i in coo.row], [sec.genes[j] for j in coo.col]], names=["cell", "gene"])).sort_index()
        assert got.equals(want.sort_index().astype(got.dtype))
    gem, gef = secs
    rows = by_id(gef, gem.barcodes)
    assert np.abs(gem.x - gef.x[rows]).max() <= 0.5 and np.abs(gem.y - gef.y[rows]).max() <= 0.5   # GEF rounds
    assert sr.inspect(sr.locate(tmp_path / "chip.cellbin.gef"))["n_units"] == gef.n


def test_detection_and_missing_files(ref, tmp_path):
    mp.write_xenium(tmp_path / "x", ref)
    mp.write_merscope(tmp_path / "m", ref)
    (tmp_path / "two").mkdir()
    mp.write_h5ad(tmp_path / "two" / "a.h5ad", ref)
    shutil.copy(tmp_path / "two" / "a.h5ad", tmp_path / "two" / "b.h5ad")
    assert [(p, q.name) for p, q in sr.candidates(tmp_path / "two")] == [("h5ad", "a.h5ad"), ("h5ad", "b.h5ad")]
    assert sr.candidates(tmp_path / "x") == [("xenium", tmp_path / "x")]
    assert sr.detect(tmp_path) is None and sr.candidates(tmp_path) == []
    (tmp_path / "x" / "cells.parquet").unlink()
    assert sr.detect(tmp_path / "x") is None
    with pytest.raises(sr.ReadError, match=r"10x Xenium: no cell_feature_matrix.h5 and cells.parquet"):
        sr.locate(tmp_path / "x", "xenium")
    with pytest.raises(sr.ReadError, match="no data of a known instrument"):
        sr.locate(tmp_path / "two")
    with pytest.raises(sr.ReadError, match="unknown platform"):
        sr.locate(tmp_path / "m", "seqfish")
    # counts that are not whole numbers are not counts
    cbg = pd.read_csv(tmp_path / "m" / "cell_by_gene.csv")
    cbg[cbg.columns[1]] = cbg[cbg.columns[1]] + 0.5
    cbg.to_csv(tmp_path / "m" / "cell_by_gene.csv", index=False)
    with pytest.raises(sr.ReadError, match="not whole numbers"):
        sr.read(sr.locate(tmp_path / "m"))
    # a section too large for the caller: refused before its counts are read where the file says how many units
    with pytest.raises(sr.ReadError, match="holds 300 units; at most 100 are read here"):
        sr.read(sr.locate(tmp_path / "two" / "a.h5ad"), max_units=100)
    mp.write_merscope(tmp_path / "m2", ref)
    with pytest.raises(sr.ReadError, match="more than 100 cells; at most that many are read here"):
        sr.read(sr.locate(tmp_path / "m2"), max_units=100)


def test_key_follows_the_files(ref, tmp_path):
    mp.write_table(tmp_path / "t", ref, mode="csv")
    loc = sr.locate(tmp_path / "t")
    k1 = loc.key()
    assert k1 == sr.locate(tmp_path / "t").key()
    with open(tmp_path / "t" / "positions.csv", "a", encoding="utf-8") as fh:
        fh.write("extra,1,1\n")
    assert sr.locate(tmp_path / "t").key() != k1
    assert sr.make_unique(["a", "a", "a-1", "b", "a"]) == ["a", "a-2", "a-1", "b", "a-3"]
    with gzip.open(tmp_path / "x.csv.gz", "wt") as fh:
        fh.write("a\n1\n2\n")
    assert sr._count_lines(tmp_path / "x.csv.gz") == 3
