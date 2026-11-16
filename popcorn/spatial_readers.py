"""
spatial_readers.py
==================
[APP] 2026-11-14. The outputs of the main spatial transcriptomics instruments read into one form, a Section: the counts
of every unit (a bin, a spot or a cell) by gene, and the position of every unit. The analysis
(bone_analysis.load_sections) and the web server (webapp/server.py: the data check, the Explore tab, the gene maps and
the Analysis tab) read every platform through it, so nothing after the reading depends on the instrument.

Platforms, and the files read (as each instrument's software writes them):

  visium_hd   10x Genomics Visium HD, Space Ranger: binned_outputs/square_XXXum/filtered_feature_bc_matrix.h5 and
              spatial/tissue_positions.parquet. Bins of 2, 8 or 16 um; positions in full-resolution image pixels.
              Read by bone_analysis.read_visium_hd and webapp.server.RawSection (the numbers of the manuscript); here
              only located and described.
  visium      10x Genomics Visium (CytAssist or not), Space Ranger: outs/filtered_feature_bc_matrix.h5 and
              outs/spatial/tissue_positions.csv (tissue_positions_list.csv before Space Ranger 2.0). 55 um spots;
              micrometres per pixel from the spot diameter in scalefactors_json.json. Read like Visium HD.
  xenium      10x Genomics Xenium: cell_feature_matrix.h5 and cells.parquet (or cells.csv.gz). Cells; micrometres.
              Only the "Gene Expression" features are kept (control probes and codewords are not genes).
  merscope    Vizgen MERSCOPE: cell_by_gene.csv and cell_metadata.csv. Cells; micrometres (center_x, center_y).
              The Blank-* columns (blank barcodes, controls) are dropped.
  cosmx       Bruker (NanoString) CosMx SMI flat files: *_exprMat_file.csv(.gz) and *_metadata_file.csv(.gz). Cells;
              global pixels of 0.12028 um (CenterX_global_px, CenterY_global_px). Negative probes (NegPrb*), system
              controls and false codes are dropped; cell 0 of a field of view is the background, not a cell.
  stereo_seq  STOmics Stereo-seq, SAW: a square-bin GEF (bins of the analysis bin size, taken from geneExp/binN or
              summed from a finer level), a cell-bin GEF (*.cellbin.gef: cells), or a GEM table (*.gem, *.gem.gz;
              cells when it has a CellID column, else bins). DNB coordinates, 500 nm apart unless the GEF says
              otherwise (its resolution attribute).
  h5ad        An AnnData file (Scanpy, Squidpy, Curio Seeker, Seurat converted with SeuratDisk or sceasy, ...): the raw
              counts (layers["counts"], raw.X, or X when it holds whole numbers) and obsm["spatial"]. Read with h5py,
              without anndata. Positions are taken as micrometres unless the file or the sample says otherwise.
  table       A folder of plain tables, for any other instrument: the counts (a 10x MEX folder: matrix.mtx(.gz),
              barcodes.tsv(.gz) and features.tsv(.gz); or a CSV with one row per unit and one column per gene, the
              first column the unit's id) and a coordinates CSV (the unit's id, x and y in micrometres).

Format sources: 10x Genomics' documentation of the feature-barcode matrix HDF5, Space Ranger spatial outputs and the
Xenium output bundle; Vizgen's description of cell_by_gene.csv and cell_metadata.csv (entity metadata format); the
CosMx flat-file description (pixel edge 0.12028 um); the SAW 8 manual, "Expression matrix format" (GEF datasets
geneExp/binN/gene: geneID, geneName, offset, count; geneExp/binN/expression: x, y, count; cellBin/cell, cellBin/cellExp,
cellBin/gene; GEM columns geneID, geneName, x, y, MIDCount, ExonCount, CellID). The readers were tested on files
written by tools/make_platform_data.py in these layouts, not on files from the instruments themselves.
"""
from __future__ import annotations

import gzip
import io
import json
import math
import os
import re
from dataclasses import dataclass, field
from pathlib import Path

import h5py
import numpy as np
import pandas as pd
from scipy import io as sio
from scipy import sparse

PLATFORMS = {
    "visium_hd": {"label": "10x Visium HD", "unit": "bin"},
    "visium": {"label": "10x Visium", "unit": "spot"},
    "xenium": {"label": "10x Xenium", "unit": "cell"},
    "merscope": {"label": "Vizgen MERSCOPE", "unit": "cell"},
    "cosmx": {"label": "Bruker CosMx", "unit": "cell"},
    "stereo_seq": {"label": "STOmics Stereo-seq", "unit": "bin"},
    "h5ad": {"label": "AnnData (.h5ad)", "unit": "spot"},
    "table": {"label": "Counts and coordinates tables", "unit": "spot"},
}
TEN_X = ("visium_hd", "visium")          # read by the Space Ranger readers of bone_analysis and webapp.server
VISIUM_SPOT_UM = 55.0                    # diameter of a Visium spot
COSMX_UM_PER_PX = 0.12028                # pixel edge of the CosMx SMI images (global pixel coordinates)
STEREO_PITCH_NM = 500                    # distance between the DNBs of a Stereo-seq chip
GENE_EXPRESSION = "Gene Expression"
CSV_CHUNK = 20_000                       # rows of a wide counts table converted at a time
SQUARE_RE = re.compile(r"^square_(\d{3})um$")
COSMX_CONTROL_RE = re.compile(r"^(negprb|negative|systemcontrol|falsecode)", re.IGNORECASE)
MERSCOPE_CONTROL_RE = re.compile(r"^blank-", re.IGNORECASE)
ENSEMBL_RE = re.compile(r"^ENS[A-Z]*G\d{6,}")
SYMBOL_COLUMNS = ("feature_name", "gene_symbols", "gene_symbol", "gene_name", "gene_names", "symbol", "name",
                  "gene_short_name", "Symbol")
X_COLUMNS = ("x_um", "x", "x_centroid", "center_x", "x_location", "xcoord", "x_coord", "imagecol",
             "pxl_col_in_fullres", "X", "x_global_px")
Y_COLUMNS = ("y_um", "y", "y_centroid", "center_y", "y_location", "ycoord", "y_coord", "imagerow",
             "pxl_row_in_fullres", "Y", "y_global_px")
ID_COLUMNS = ("barcode", "cell_id", "cell", "id", "spot", "bin", "entityid", "entity_id", "cellid", "unit")
COORD_FILES = ("coordinates", "positions", "spatial", "locations", "centroids", "spatial_coordinates",
               "tissue_positions")
COUNT_FILES = ("counts", "expression", "matrix", "count_matrix", "counts_matrix")


class ReadError(ValueError):
    """The files are there but cannot be read as the platform writes them; the message says which and why."""


# ============================================================================
# SECTIONS
# ============================================================================

@dataclass
class Section:
    """One section read from an instrument's output.

    X: units x genes, the counts (CSR, int64); barcodes: the ids of the units (unique, in the order of X); genes: their
    names (unique, the instrument's controls left out); x, y: the units' positions, in the section's own frame;
    microns_per_unit: micrometres per unit of x and y (1.0 when they are micrometres); grid: (row, column) of every
    unit on the capture grid, for bins and spots (None for cells); size_um: the side of a bin or the diameter of a
    spot (None for cells); n_read: units in the counts before those without a position were left out; sources: the
    files read; notes: what the reader had to decide or leave out."""
    platform: str
    unit: str
    X: sparse.csr_matrix
    barcodes: list[str]
    genes: list[str]
    x: np.ndarray
    y: np.ndarray
    microns_per_unit: float = 1.0
    grid: tuple[np.ndarray, np.ndarray] | None = None
    size_um: float | None = None
    n_read: int = 0
    sources: list[Path] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    @property
    def n(self) -> int:
        return self.X.shape[0]


@dataclass
class Located:
    """Where a sample's data is: its platform, the folder or file the sample points at, and the files the reader
    reads (role -> path). bin_um: the bin size asked for (Stereo-seq square bins)."""
    platform: str
    path: Path
    files: dict[str, Path]
    bin_um: float | None = None

    def key(self) -> tuple:
        """Identifies what reading gives (cache keys): the platform, the bin size and every file's path, modification
        time and size."""
        stamp = []
        for role in sorted(self.files):
            p = self.files[role]
            try:
                st = p.stat()
                stamp.append((role, str(p), st.st_mtime_ns, st.st_size))
            except OSError as exc:
                raise ReadError(f"{p} cannot be read ({exc})") from exc
        return (self.platform, self.bin_um, *stamp)

    @property
    def main(self) -> Path:
        """The file that holds the counts."""
        return self.files.get("counts") or next(iter(self.files.values()))


# ============================================================================
# SMALL HELPERS
# ============================================================================

def decode(values) -> list[str]:
    return [v.decode("utf-8", "replace") if isinstance(v, (bytes, np.bytes_)) else str(v) for v in values]


def make_unique(values: list[str]) -> list[str]:
    """anndata's make_index_unique: the second and later copies of a name become <name>-1, <name>-2, ..., skipping
    names already in use (the rule webapp.server.make_unique follows)."""
    seen, dups = set(), []
    for i, v in enumerate(values):
        if v in seen:
            dups.append(i)
        seen.add(v)
    if not dups:
        return list(values)
    out, counter = list(values), {}
    for i in dups:
        v = values[i]
        while True:
            counter[v] = counter.get(v, 0) + 1
            name = f"{v}-{counter[v]}"
            if name not in seen:
                seen.add(name)
                out[i] = name
                break
    return out


def _first(folder: Path, names, suffixes=("",)) -> Path | None:
    for n in names:
        for s in suffixes:
            p = folder / f"{n}{s}"
            if p.is_file():
                return p
    return None


def _glob_one(folder: Path, patterns) -> Path | None:
    for pattern in patterns:
        found = sorted(p for p in folder.glob(pattern) if p.is_file())
        if found:
            return found[0]
    return None


def _open_text(path: Path):
    return gzip.open(path, "rt", encoding="utf-8", newline="") if path.name.endswith(".gz") else \
        open(path, "r", encoding="utf-8", newline="")


def _header(path: Path, sep: str | None = None, comment: str | None = None) -> list[str]:
    """The column names of a CSV or TSV file (its first line that is not a comment)."""
    with _open_text(path) as fh:
        for line in fh:
            if comment and line.startswith(comment):
                continue
            line = line.rstrip("\r\n")
            delim = sep or ("\t" if line.count("\t") > line.count(",") else ",")
            return [c.strip().strip('"') for c in line.split(delim)]
    return []


def _count_lines(path: Path, limit_bytes: int = 2 << 30) -> int | None:
    """Lines of a text file (gzip too), None when it is larger than limit_bytes (counting would take too long)."""
    try:
        if path.stat().st_size > limit_bytes:
            return None
        n = 0
        opener = gzip.open if path.name.endswith(".gz") else open
        with opener(path, "rb") as fh:
            for block in iter(lambda: fh.read(1 << 20), b""):
                n += block.count(b"\n")
        return n
    except OSError:
        return None


def _integer_counts(values: np.ndarray, what: str) -> np.ndarray:
    """Counts as int64; ReadError when they are not whole numbers of 0 or more (normalized values are not counts)."""
    a = np.asarray(values)
    if a.dtype.kind in "iu":
        if a.size and a.min() < 0:
            raise ReadError(f"{what} holds negative values; they are not counts")
        return a.astype(np.int64, copy=False)
    a = a.astype(np.float64, copy=False)
    if a.size and (not np.isfinite(a).all() or a.min() < 0 or not np.array_equal(a, np.rint(a))):
        raise ReadError(f"{what} holds values that are not whole numbers of 0 or more (normalized or transformed "
                        f"data); the analysis needs the raw counts")
    return np.rint(a).astype(np.int64)


def _column(df: pd.DataFrame, names, what: str, required: bool = True) -> str | None:
    lower = {str(c).lower(): c for c in df.columns}
    for n in names:
        if n in df.columns:
            return n
        if n.lower() in lower:
            return lower[n.lower()]
    if required:
        raise ReadError(f"{what}: no column named {' or '.join(names[:6])} (columns: "
                        f"{', '.join(map(str, list(df.columns)[:12]))})")
    return None


def _attach(X: sparse.csr_matrix, ids: list[str], pos_ids, px, py, what: str, files: str):
    """The units of the counts that have a position, in the order of the counts: (X, ids, x, y, n_without). ids of
    both are compared as written (surrounding blanks removed); a unit listed twice in the positions takes the first.
    ReadError when fewer than half of the units have a position (the two files do not belong together)."""
    pos = pd.DataFrame({"x": pd.to_numeric(pd.Series(np.asarray(px)), errors="coerce").to_numpy(float),
                        "y": pd.to_numeric(pd.Series(np.asarray(py)), errors="coerce").to_numpy(float)},
                       index=pd.Index([str(v).strip() for v in pos_ids]))
    pos = pos[~pos.index.duplicated(keep="first")]
    xy = pos.reindex(pd.Index([str(v).strip() for v in ids]))
    ok = (xy["x"].notna() & xy["y"].notna()).to_numpy()
    if X.shape[0] and ok.mean() < 0.5:
        raise ReadError(f"only {int(ok.sum()):,} of the {X.shape[0]:,} {what} of the counts have a position in "
                        f"{files}; are both files from the same run?")
    rows = np.flatnonzero(ok)
    keep_ids = [ids[i] for i in rows.tolist()]
    return X[rows] if len(rows) < X.shape[0] else X, keep_ids, xy["x"].to_numpy(float)[rows], \
        xy["y"].to_numpy(float)[rows], int(X.shape[0] - len(rows))


def _section(platform: str, X, ids, genes, x, y, *, microns_per_unit=1.0, grid=None, size_um=None, n_read=0,
             sources=(), notes=(), unit=None, max_units=None) -> Section:
    X = sparse.csr_matrix(X, dtype=np.int64)
    X.eliminate_zeros()
    X.sort_indices()
    if max_units is not None and X.shape[0] > max_units:
        raise ReadError(f"{X.shape[0]:,} {(unit or PLATFORMS[platform]['unit'])}s: more than the {max_units:,} a "
                        f"section may have here")
    return Section(platform=platform, unit=unit or PLATFORMS[platform]["unit"], X=X, barcodes=make_unique(list(ids)),
                   genes=make_unique(list(genes)), x=np.asarray(x, float), y=np.asarray(y, float),
                   microns_per_unit=float(microns_per_unit), grid=grid, size_um=size_um, n_read=int(n_read or X.shape[0]),
                   sources=[Path(p) for p in sources], notes=[n for n in notes if n])


# ============================================================================
# FINDING THE DATA
# ============================================================================

def _square_dirs(folder: Path) -> list[Path]:
    for base in (folder, folder / "binned_outputs", folder / "outs" / "binned_outputs"):
        try:
            found = [d for d in base.iterdir() if d.is_dir() and SQUARE_RE.match(d.name)
                     and (d / "filtered_feature_bc_matrix.h5").is_file()]
        except OSError:
            continue
        if found:
            return sorted(found)
    return []


def _visium_dir(folder: Path) -> Path | None:
    """The Space Ranger outs/ folder of a standard Visium run (or the folder itself), holding
    filtered_feature_bc_matrix.h5 and spatial/ with a tissue positions file."""
    for d in (folder, folder / "outs"):
        if (d / "filtered_feature_bc_matrix.h5").is_file() and _first(
                d / "spatial", ("tissue_positions.csv", "tissue_positions_list.csv", "tissue_positions.parquet")):
            return d
    return None


def _xenium_files(folder: Path) -> dict | None:
    counts = folder / "cell_feature_matrix.h5"
    cells = _first(folder, ("cells.parquet", "cells.csv.gz", "cells.csv"))
    if counts.is_file() and cells is not None:
        files = {"counts": counts, "positions": cells}
        if (folder / "experiment.xenium").is_file():
            files["manifest"] = folder / "experiment.xenium"
        return files
    return None


def _merscope_files(folder: Path) -> dict | None:
    counts = _first(folder, ("cell_by_gene.csv", "cell_by_gene.csv.gz"))
    meta = _first(folder, ("cell_metadata.csv", "cell_metadata.csv.gz"))
    return {"counts": counts, "positions": meta} if counts and meta else None


def _cosmx_files(folder: Path) -> dict | None:
    counts = _glob_one(folder, ("*_exprMat_file.csv", "*_exprMat_file.csv.gz", "*exprMat*.csv", "*exprMat*.csv.gz"))
    meta = _glob_one(folder, ("*_metadata_file.csv", "*_metadata_file.csv.gz", "*metadata_file*.csv",
                              "*metadata_file*.csv.gz"))
    return {"counts": counts, "positions": meta} if counts and meta else None


def _stereo_file(path: Path) -> Path | None:
    """The Stereo-seq matrix of a folder, or the file itself: a GEF of square bins first (the tissue one before the
    raw one), then a cell-bin GEF, then a GEM table; in the folder or in SAW's outs/feature_expression/."""
    if path.is_file():
        return path if path.name.lower().endswith((".gef", ".gem", ".gem.gz")) else None
    if not path.is_dir():
        return None
    files = sorted(p for p in path.iterdir() if p.is_file())
    names = [(p, p.name.lower()) for p in files]
    for test in (lambda n: n.endswith(".tissue.gef"),
                 lambda n: n.endswith(".gef") and not n.endswith((".cellbin.gef", ".raw.gef")),
                 lambda n: n.endswith(".raw.gef"),
                 lambda n: n.endswith(".cellbin.gef"),
                 lambda n: n.endswith((".gem", ".gem.gz"))):
        found = [p for p, n in names if test(n)]
        if found:
            return found[0]
    for sub in ("outs/feature_expression", "feature_expression"):
        if (path / sub).is_dir():
            return _stereo_file(path / sub)
    return None


def _table_files(folder: Path) -> dict | None:
    mex = {"matrix": _first(folder, ("matrix.mtx",), (".gz", "")),
           "barcodes": _first(folder, ("barcodes.tsv",), (".gz", "")),
           "features": _first(folder, ("features.tsv", "genes.tsv"), (".gz", ""))}
    coords = _first(folder, COORD_FILES, (".csv", ".csv.gz", ".tsv", ".tsv.gz"))
    if coords is None:
        return None
    if all(mex.values()):
        return {**mex, "positions": coords}
    counts = _first(folder, COUNT_FILES, (".csv", ".csv.gz", ".tsv", ".tsv.gz"))
    return {"counts": counts, "positions": coords} if counts else None


def detect(path) -> str | None:
    """The platform whose output `path` (a folder or a file) holds, or None."""
    path = Path(path)
    if path.is_file():
        name = path.name.lower()
        if name.endswith(".h5ad"):
            return "h5ad"
        if name.endswith((".gef", ".gem", ".gem.gz")):
            return "stereo_seq"
        return None
    if not path.is_dir():
        return None
    if _square_dirs(path):
        return "visium_hd"
    if _xenium_files(path):
        return "xenium"
    if _merscope_files(path):
        return "merscope"
    if _cosmx_files(path):
        return "cosmx"
    if _visium_dir(path):
        return "visium"
    if _stereo_file(path):
        return "stereo_seq"
    if _table_files(path):
        return "table"
    h5ad = sorted(path.glob("*.h5ad"))
    if len(h5ad) == 1:
        return "h5ad"
    return None


def candidates(folder) -> list[tuple[str, Path]]:
    """What a folder holds, for the sample detection of the web application: [(platform, path)], path being the
    folder, or a file of it when the folder holds several (each .h5ad file is a sample)."""
    folder = Path(folder)
    platform = detect(folder)
    if platform and platform != "h5ad":
        return [(platform, folder)]
    return [("h5ad", p) for p in sorted(folder.glob("*.h5ad")) if p.is_file()]


def locate(path, platform: str | None = None, bin_um: float | None = None) -> Located:
    """The files of the data at `path` (a folder or a file) for `platform` (detected when None). ReadError when the
    files the platform needs are not there, saying which."""
    path = Path(path)
    platform = platform or detect(path)
    if platform is None:
        raise ReadError(f"no data of a known instrument in {path} (Visium HD, Visium, Xenium, MERSCOPE, CosMx, "
                        f"Stereo-seq, an .h5ad file, or counts and coordinates tables)")
    if platform not in PLATFORMS:
        raise ReadError(f"unknown platform {platform!r}; known: {', '.join(PLATFORMS)}")
    want = {
        "visium_hd": "binned_outputs/square_XXXum/filtered_feature_bc_matrix.h5",
        "visium": "filtered_feature_bc_matrix.h5 and spatial/tissue_positions.csv (in outs/)",
        "xenium": "cell_feature_matrix.h5 and cells.parquet (or cells.csv.gz)",
        "merscope": "cell_by_gene.csv and cell_metadata.csv",
        "cosmx": "*_exprMat_file.csv and *_metadata_file.csv",
        "stereo_seq": "a .gef or .gem file",
        "h5ad": "an .h5ad file",
        "table": "counts (matrix.mtx + barcodes.tsv + features.tsv, or counts.csv) and coordinates.csv",
    }[platform]
    files = None
    if platform == "visium_hd":
        dirs = _square_dirs(path) if path.is_dir() else []
        if not dirs and SQUARE_RE.match(path.name) and (path / "filtered_feature_bc_matrix.h5").is_file():
            dirs = [path]
        files = {d.name: d / "filtered_feature_bc_matrix.h5" for d in dirs} or None
    elif platform == "visium":
        d = _visium_dir(path) if path.is_dir() else None
        if d is not None:
            spatial = d / "spatial"
            files = {"counts": d / "filtered_feature_bc_matrix.h5",
                     "positions": _first(spatial, ("tissue_positions.parquet", "tissue_positions.csv",
                                                   "tissue_positions_list.csv"))}
    elif platform == "xenium":
        files = _xenium_files(path) if path.is_dir() else None
    elif platform == "merscope":
        files = _merscope_files(path) if path.is_dir() else None
    elif platform == "cosmx":
        files = _cosmx_files(path) if path.is_dir() else None
    elif platform == "stereo_seq":
        f = _stereo_file(path)
        files = {"counts": f} if f else None
    elif platform == "h5ad":
        if path.is_file() and path.name.lower().endswith(".h5ad"):
            files = {"counts": path}
        elif path.is_dir():
            found = sorted(path.glob("*.h5ad"))
            files = {"counts": found[0]} if len(found) == 1 else None
    elif platform == "table":
        files = _table_files(path) if path.is_dir() else None
    if not files:
        raise ReadError(f"{PLATFORMS[platform]['label']}: no {want} in {path}")
    return Located(platform, path, files, bin_um)


# ============================================================================
# READERS
# ============================================================================

def read_10x_h5(path: Path, max_units: int | None = None) -> tuple[sparse.csr_matrix, list[str], list[str]]:
    """(units x genes counts, barcodes, gene names) of a 10x feature-barcode matrix HDF5 (Space Ranger, Xenium): the
    "Gene Expression" features only."""
    try:
        with h5py.File(path, "r") as f:
            m = f["matrix"]
            n_features, n_units = (int(v) for v in m["shape"][()][:2])
            if max_units is not None and n_units > max_units:
                raise ReadError(f"{path} holds {n_units:,} units; at most {max_units:,} are read here")
            barcodes = decode(m["barcodes"][()])
            features = m["features"]
            names = decode(features["name"][()])
            kinds = decode(features["feature_type"][()]) if "feature_type" in features else None
            data, indices, indptr = m["data"][()], m["indices"][()], m["indptr"][()]
    except ReadError:
        raise
    except (OSError, KeyError, ValueError, IndexError, TypeError) as exc:
        raise ReadError(f"{path} is not a readable 10x feature-barcode matrix ({exc})") from exc
    X = sparse.csr_matrix((_integer_counts(data, str(path)), indices, indptr), shape=(n_units, n_features))
    if kinds is not None and any(k != GENE_EXPRESSION for k in kinds):
        keep = np.array([k == GENE_EXPRESSION for k in kinds])
        X = X[:, keep]
        names = [n for n, k in zip(names, kinds) if k == GENE_EXPRESSION]
    return X.tocsr(), barcodes, names


def _read_positions_table(path: Path, columns=None) -> pd.DataFrame:
    try:
        if path.name.lower().endswith(".parquet"):
            return pd.read_parquet(path, columns=columns)
        sep = "\t" if ".tsv" in path.name.lower() else ","
        return pd.read_csv(path, sep=sep, usecols=columns, low_memory=False)
    except (OSError, ValueError, KeyError, ImportError) as exc:
        raise ReadError(f"{path} cannot be read as a table ({exc})") from exc


def read_xenium(loc: Located, max_units=None) -> Section:
    X, barcodes, genes = read_10x_h5(loc.files["counts"], max_units)
    cells = _read_positions_table(loc.files["positions"])
    id_col = _column(cells, ("cell_id",), str(loc.files["positions"]))
    xc = _column(cells, ("x_centroid",), str(loc.files["positions"]))
    yc = _column(cells, ("y_centroid",), str(loc.files["positions"]))
    X, ids, x, y, missing = _attach(X, barcodes, decode(cells[id_col].tolist()), cells[xc], cells[yc], "cells",
                                    loc.files["positions"].name)
    notes = []
    if missing:
        notes.append(f"{missing:,} cells of the matrix have no centroid in {loc.files['positions'].name} and are left "
                     f"out")
    manifest = loc.files.get("manifest")
    if manifest is not None:
        try:
            info = json.loads(manifest.read_text(encoding="utf-8"))
            panel = info.get("panel_name") or info.get("panel_design_id")
            if panel:
                notes.append(f"Xenium panel: {panel}")
        except (OSError, ValueError):
            pass
    notes.append("Xenium positions are cell centroids in micrometres; the morphology images are not shown")
    return _section("xenium", X, ids, genes, x, y, n_read=len(barcodes), sources=loc.files.values(), notes=notes,
                    max_units=max_units)


def _wide_counts(path: Path, *, id_from, drop, what: str, max_units=None, sep=","):
    """A table with one row per unit and one column per gene (and id columns), read in blocks: (X, ids, genes).
    id_from(chunk) -> (ids of the rows, mask of the rows to keep); drop(column name, position) -> True for a column
    that is not a gene."""
    blocks, ids, genes, cols, n_rows = [], [], None, None, 0
    try:
        reader = pd.read_csv(path, sep=sep, chunksize=CSV_CHUNK, low_memory=False)
        for chunk in reader:
            if genes is None:
                cols = [c for i, c in enumerate(chunk.columns) if not drop(str(c), i)]
                genes = [str(c) for c in cols]
            row_ids, keep = id_from(chunk)
            n_rows += int(keep.sum())
            if max_units is not None and n_rows > max_units:
                raise ReadError(f"{path} holds more than {max_units:,} {what}; at most that many are read here")
            values = chunk.loc[keep, cols].to_numpy()
            blocks.append(sparse.csr_matrix(_integer_counts(values, str(path))))
            ids.extend(str(v) for v, k in zip(row_ids, keep) if k)
    except ReadError:
        raise
    except (OSError, ValueError, KeyError, pd.errors.ParserError) as exc:
        raise ReadError(f"{path} cannot be read as a table of counts ({exc})") from exc
    if genes is None:
        raise ReadError(f"{path} is empty")
    X = sparse.vstack(blocks, format="csr") if blocks else sparse.csr_matrix((0, len(genes)), dtype=np.int64)
    return X, ids, genes


def read_merscope(loc: Located, max_units=None) -> Section:
    counts = loc.files["counts"]

    def ids_of(chunk):
        col = chunk.columns[0]
        return [str(v) for v in chunk[col].tolist()], np.ones(len(chunk), dtype=bool)

    X, ids, genes = _wide_counts(counts, id_from=ids_of, what="cells", max_units=max_units,
                                 drop=lambda c, i: i == 0 or bool(MERSCOPE_CONTROL_RE.match(c)))
    meta = _read_positions_table(loc.files["positions"])
    id_col = meta.columns[0]
    xc = _column(meta, ("center_x",), str(loc.files["positions"]))
    yc = _column(meta, ("center_y",), str(loc.files["positions"]))
    n_blank = sum(1 for c in _header(counts) if MERSCOPE_CONTROL_RE.match(c))
    X, ids2, x, y, missing = _attach(X, ids, meta[id_col].astype(str).tolist(), meta[xc], meta[yc], "cells",
                                     loc.files["positions"].name)
    notes = [f"{n_blank} Blank-* control columns left out" if n_blank else None,
             f"{missing:,} cells of {counts.name} have no position in {loc.files['positions'].name} and are left out"
             if missing else None]
    return _section("merscope", X, ids2, genes, x, y, n_read=len(ids), sources=loc.files.values(), notes=notes,
                    max_units=max_units)


def _cosmx_ids(chunk: pd.DataFrame, what: str):
    """Ids of the cells of a CosMx table ("cell" when present, else <fov>_<cell_ID>) and the rows that are cells
    (cell_ID 0 is the background of a field of view)."""
    lower = {str(c).lower(): c for c in chunk.columns}
    cid = lower.get("cell_id")
    fov = lower.get("fov")
    if "cell" in lower:
        ids = [str(v) for v in chunk[lower["cell"]].tolist()]
    elif cid is not None and fov is not None:
        ids = [f"{f}_{c}" for f, c in zip(chunk[fov].tolist(), chunk[cid].tolist())]
    else:
        raise ReadError(f"{what}: no cell column and no fov and cell_ID columns")
    keep = np.ones(len(chunk), dtype=bool)
    if cid is not None:
        keep = pd.to_numeric(chunk[cid], errors="coerce").fillna(0).to_numpy() != 0
    return ids, keep


def read_cosmx(loc: Located, microns_per_unit=None, max_units=None) -> Section:
    counts, meta_path = loc.files["counts"], loc.files["positions"]
    id_cols = {"fov", "cell_id", "cell"}
    X, ids, genes = _wide_counts(counts, id_from=lambda c: _cosmx_ids(c, counts.name), what="cells",
                                 max_units=max_units,
                                 drop=lambda c, i: c.lower() in id_cols or bool(COSMX_CONTROL_RE.match(c)))
    meta = _read_positions_table(meta_path)
    meta_ids, keep = _cosmx_ids(meta, meta_path.name)
    meta = meta[keep]
    meta_ids = [i for i, k in zip(meta_ids, keep) if k]
    mpp = COSMX_UM_PER_PX
    xc = _column(meta, ("CenterX_global_px",), meta_path.name, required=False)
    yc = _column(meta, ("CenterY_global_px",), meta_path.name, required=False)
    notes = []
    if xc is None or yc is None:
        xc = _column(meta, ("x_slide_mm",), meta_path.name)
        yc = _column(meta, ("y_slide_mm",), meta_path.name)
        px = pd.to_numeric(meta[xc], errors="coerce") * 1000.0
        py = pd.to_numeric(meta[yc], errors="coerce") * 1000.0
        mpp = 1.0
    else:
        px, py = meta[xc], meta[yc]
    n_controls = sum(1 for c in _header(counts) if COSMX_CONTROL_RE.match(c))
    X, ids2, x, y, missing = _attach(X, ids, meta_ids, px, py, "cells", meta_path.name)
    if n_controls:
        notes.append(f"{n_controls} negative-probe and control columns left out")
    if missing:
        notes.append(f"{missing:,} cells of {counts.name} have no position in {meta_path.name} and are left out")
    notes.append(f"CosMx global positions in pixels of {mpp:g} um" if mpp != 1.0 else "CosMx slide positions in mm")
    return _section("cosmx", X, ids2, genes, x, y, microns_per_unit=microns_per_unit or mpp, n_read=len(ids),
                    sources=loc.files.values(), notes=notes, max_units=max_units)


# ---- Stereo-seq -----------------------------------------------------------------------------------------------------

def _gene_names(gene_table, ids_field="geneID", name_fields=("geneName", "gene")) -> list[str]:
    """Gene names of a GEF gene dataset: geneName when it is filled in, else the gene id."""
    fields = gene_table.dtype.names or ()
    names = None
    for f in name_fields:
        if f in fields:
            names = decode(gene_table[f])
            break
    ids = decode(gene_table[ids_field]) if ids_field in fields else None
    if names is None:
        if ids is None:
            raise ReadError("the gene dataset has no geneName, gene or geneID field")
        return ids
    if ids is not None:
        names = [n if n.strip() else i for n, i in zip(names, ids)]
    return names


def _rows_of_genes(gene_table, n_rows: int) -> np.ndarray:
    """The gene index of every row of a GEF expression dataset (its rows are grouped by gene: offset and count)."""
    offsets = np.asarray(gene_table["offset"], dtype=np.int64)
    counts = np.asarray(gene_table["count"], dtype=np.int64)
    out = np.empty(n_rows, dtype=np.int64)
    if np.array_equal(offsets, np.concatenate([[0], np.cumsum(counts)[:-1]])) and counts.sum() == n_rows:
        out[:] = np.repeat(np.arange(len(counts)), counts)
        return out
    out[:] = -1
    for g, (o, c) in enumerate(zip(offsets.tolist(), counts.tolist())):
        out[o:o + c] = g
    if (out < 0).any():
        raise ReadError("the gene offsets of the GEF file do not cover its expression rows")
    return out


def _bin_dnb(gene_idx, xs, ys, cnt, n_genes, bin_dnb: int, pitch_um: float, names, sources, notes, max_units,
             already_binned_by: int = 1):
    """Square bins of bin_dnb DNBs from per-DNB (or finer-bin) records: the counts of each bin by gene, bins keyed by
    their grid position, positions the bin centres in micrometres."""
    bx = np.floor_divide(np.asarray(xs, dtype=np.int64), bin_dnb)
    by = np.floor_divide(np.asarray(ys, dtype=np.int64), bin_dnb)
    if not len(bx):
        raise ReadError("the Stereo-seq matrix holds no count")
    x0, y0 = int(bx.min()), int(by.min())
    width = int(bx.max()) - x0 + 1
    key = (by - y0) * width + (bx - x0)
    uniq, unit = np.unique(key, return_inverse=True)
    if max_units is not None and len(uniq) > max_units:
        raise ReadError(f"{len(uniq):,} bins of {bin_dnb * pitch_um:g} um: more than {max_units:,}; choose a larger "
                        f"bin size")
    X = sparse.csr_matrix((np.asarray(cnt, dtype=np.int64), (unit, np.asarray(gene_idx, dtype=np.int64))),
                          shape=(len(uniq), n_genes))
    X.sum_duplicates()
    row, col = uniq // width + y0, uniq % width + x0
    x = (col * bin_dnb + bin_dnb / 2.0) * pitch_um
    y = (row * bin_dnb + bin_dnb / 2.0) * pitch_um
    ids = [f"bin{bin_dnb}_{c}_{r}" for r, c in zip(row.tolist(), col.tolist())]
    return _section("stereo_seq", X, ids, names, x, y, grid=(row, col), size_um=bin_dnb * pitch_um, sources=sources,
                    notes=notes, max_units=max_units)


def read_stereo_gef(loc: Located, microns_per_unit=None, max_units=None) -> Section:
    path = loc.files["counts"]
    try:
        with h5py.File(path, "r") as f:
            if "cellBin" in f:
                return _read_cellbin_gef(f, loc, microns_per_unit, max_units)
            if "geneExp" not in f:
                raise ReadError(f"{path} has neither geneExp (square bins) nor cellBin (cells)")
            resolution = f.attrs.get("resolution")
            g = f["geneExp"]
            levels = sorted(int(k[3:]) for k in g.keys() if re.match(r"^bin\d+$", k))
            if not levels:
                raise ReadError(f"{path}: geneExp has no binN group")
            first = g[f"bin{levels[0]}"]["expression"]
            if resolution is None:
                resolution = first.attrs.get("resolution", STEREO_PITCH_NM)
            pitch_um = microns_per_unit or float(np.asarray(resolution).ravel()[0]) / 1000.0
            bin_um = loc.bin_um or 25.0
            want = max(1, int(round(bin_um / pitch_um)))
            # the wanted level itself, else the coarsest level whose bins tile it (bin1 tiles every size)
            tiling = [L for L in levels if want % L == 0]
            level = want if want in levels else (max(tiling) if tiling else None)
            if level is None:
                raise ReadError(f"{path}: no level of geneExp ({', '.join(f'bin{L}' for L in levels)}) tiles bins of "
                                f"{want} DNBs ({bin_um:g} um); choose a bin size that is a multiple of one of them")
            grp = g[f"bin{level}"]
            genes = grp["gene"][()]
            expr = grp["expression"][()]
            scale = 1
            if level > 1:
                # x, y of a coarser level are either DNB coordinates or bin indices: compare its extent with bin1's
                xmax = int(grp["expression"].attrs.get("maxX", expr["x"].max(initial=0)))
                if "bin1" in g:
                    full = int(g["bin1"]["expression"].attrs.get("maxX", 0))
                    scale = level if full and xmax * level <= full + level and xmax < full / 2 else 1
                elif len(expr) and (np.asarray(expr["x"]) % level != 0).any():
                    scale = level
    except ReadError:
        raise
    except (OSError, KeyError, ValueError, TypeError) as exc:
        raise ReadError(f"{path} is not a readable Stereo-seq GEF file ({exc})") from exc
    names = _gene_names(genes)
    gene_idx = _rows_of_genes(genes, len(expr))
    xs = np.asarray(expr["x"], dtype=np.int64) * scale
    ys = np.asarray(expr["y"], dtype=np.int64) * scale
    notes = [f"Stereo-seq square bins of {want} DNBs ({want * pitch_um:g} um) from geneExp/bin{level}",
             f"DNB pitch {pitch_um * 1000:g} nm"]
    return _bin_dnb(gene_idx, xs, ys, expr["count"], len(names), want, pitch_um, names, [path], notes, max_units)


def _read_cellbin_gef(f, loc: Located, microns_per_unit, max_units) -> Section:
    path = loc.files["counts"]
    cb = f["cellBin"]
    cells = cb["cell"][()]
    cexp = cb["cellExp"][()]
    genes = cb["gene"][()]
    resolution = f.attrs.get("resolution", STEREO_PITCH_NM)
    pitch_um = microns_per_unit or float(np.asarray(resolution).ravel()[0]) / 1000.0
    n = len(cells)
    if max_units is not None and n > max_units:
        raise ReadError(f"{path} holds {n:,} cells; at most {max_units:,} are read here")
    count_field = "geneCount" if "geneCount" in cells.dtype.names else "count"
    per_cell = np.asarray(cells[count_field], dtype=np.int64)
    offsets = np.asarray(cells["offset"], dtype=np.int64)
    if np.array_equal(offsets, np.concatenate([[0], np.cumsum(per_cell)[:-1]])) and per_cell.sum() == len(cexp):
        rows = np.repeat(np.arange(n), per_cell)
    else:
        rows = np.full(len(cexp), -1, dtype=np.int64)
        for i, (o, c) in enumerate(zip(offsets.tolist(), per_cell.tolist())):
            rows[o:o + c] = i
        if (rows < 0).any():
            raise ReadError(f"{path}: the cell offsets do not cover cellBin/cellExp")
    gene_field = "geneID" if "geneID" in cexp.dtype.names else cexp.dtype.names[0]
    names = _gene_names(genes)
    X = sparse.csr_matrix((np.asarray(cexp["count"], dtype=np.int64), (rows, np.asarray(cexp[gene_field], np.int64))),
                          shape=(n, len(names)))
    ids = [str(v) for v in (cells["id"] if "id" in cells.dtype.names else np.arange(n)).tolist()]
    x = np.asarray(cells["x"], dtype=float)
    y = np.asarray(cells["y"], dtype=float)
    notes = ["Stereo-seq cell bins (cellBin): cell centres of mass", f"DNB pitch {pitch_um * 1000:g} nm"]
    return _section("stereo_seq", X, ids, names, x, y, microns_per_unit=pitch_um, unit="cell", sources=[path],
                    notes=notes, max_units=max_units)


def read_stereo_gem(loc: Located, microns_per_unit=None, max_units=None) -> Section:
    path = loc.files["counts"]
    pitch_um = microns_per_unit or STEREO_PITCH_NM / 1000.0
    try:
        df = pd.read_csv(path, sep="\t", comment="#", low_memory=False)
    except (OSError, ValueError, pd.errors.ParserError) as exc:
        raise ReadError(f"{path} cannot be read as a GEM table ({exc})") from exc
    gcol = _column(df, ("geneName", "geneID", "gene"), path.name)
    if gcol == "geneName" and "geneID" in df.columns:
        names = df["geneName"].astype(str)
        empty = names.str.strip().isin(["", "nan", "None"])
        if empty.any():
            names = names.where(~empty, df["geneID"].astype(str))
    else:
        names = df[gcol].astype(str)
    ccol = _column(df, ("MIDCount", "MIDCounts", "UMICount", "UMICounts", "MIDcount"), path.name)
    xs = pd.to_numeric(df[_column(df, ("x",), path.name)], errors="coerce").to_numpy()
    ys = pd.to_numeric(df[_column(df, ("y",), path.name)], errors="coerce").to_numpy()
    counts = _integer_counts(pd.to_numeric(df[ccol], errors="coerce").fillna(-1).to_numpy(), f"{path.name}: {ccol}")
    gene_codes, gene_names = pd.factorize(names, sort=False)
    gene_names = [str(g) for g in gene_names]
    cell_col = _column(df, ("CellID", "cell_id", "cellID"), path.name, required=False)
    if cell_col is not None:
        cells = pd.to_numeric(df[cell_col], errors="coerce").fillna(0).astype(np.int64).to_numpy()
        keep = cells > 0
        cell_codes, cell_ids = pd.factorize(cells[keep], sort=True)
        if max_units is not None and len(cell_ids) > max_units:
            raise ReadError(f"{path} holds {len(cell_ids):,} cells; at most {max_units:,} are read here")
        X = sparse.csr_matrix((counts[keep], (cell_codes, gene_codes[keep])), shape=(len(cell_ids), len(gene_names)))
        X.sum_duplicates()
        weight = np.bincount(cell_codes, weights=counts[keep], minlength=len(cell_ids))
        weight = np.where(weight > 0, weight, 1.0)
        x = np.bincount(cell_codes, weights=xs[keep] * counts[keep], minlength=len(cell_ids)) / weight
        y = np.bincount(cell_codes, weights=ys[keep] * counts[keep], minlength=len(cell_ids)) / weight
        notes = ["Stereo-seq cell bins (GEM CellID): positions are the count-weighted centres of each cell",
                 f"DNB pitch {pitch_um * 1000:g} nm (assumed)" if microns_per_unit is None else None]
        return _section("stereo_seq", X, [str(c) for c in cell_ids], gene_names, x, y, microns_per_unit=pitch_um,
                        unit="cell", sources=[path], notes=notes, max_units=max_units)
    bin_um = loc.bin_um or 25.0
    want = max(1, int(round(bin_um / pitch_um)))
    notes = [f"Stereo-seq square bins of {want} DNBs ({want * pitch_um:g} um) from the GEM table",
             f"DNB pitch {pitch_um * 1000:g} nm (assumed: the GEM file does not record it)"
             if microns_per_unit is None else None]
    return _bin_dnb(gene_codes, xs, ys, counts, len(gene_names), want, pitch_um, gene_names, [path], notes, max_units)


# ---- AnnData ----------------------------------------------------------------------------------------------------------

def _h5ad_matrix(node) -> sparse.csr_matrix:
    if isinstance(node, h5py.Dataset):
        return sparse.csr_matrix(node[()])
    enc = node.attrs.get("encoding-type", node.attrs.get("h5sparse_format", ""))
    enc = enc.decode() if isinstance(enc, bytes) else str(enc)
    shape = node.attrs.get("shape", node.attrs.get("h5sparse_shape"))
    shape = tuple(int(v) for v in shape)
    data, indices, indptr = node["data"][()], node["indices"][()], node["indptr"][()]
    if enc in ("csr_matrix", "csr"):
        return sparse.csr_matrix((data, indices, indptr), shape=shape)
    if enc in ("csc_matrix", "csc"):
        return sparse.csc_matrix((data, indices, indptr), shape=shape).tocsr()
    raise ReadError(f"unknown sparse encoding {enc!r}")


def _h5ad_values(node) -> list:
    """A column (or the index) of an AnnData dataframe as text: a dataset (string-array), a categorical
    (categories and codes) or, from anndata 0.11 on, a nullable array (values and mask; a masked value is "")."""
    if isinstance(node, np.ndarray):
        return decode(node)
    if isinstance(node, h5py.Group):
        if "categories" in node and "codes" in node:
            cats = decode(_h5ad_values(node["categories"]))
            codes = node["codes"][()]
            return [cats[c] if c >= 0 else "" for c in codes.tolist()]
        if "values" in node:
            values = decode(node["values"][()])
            if "mask" in node:
                mask = np.asarray(node["mask"][()], dtype=bool)
                values = ["" if m else v for v, m in zip(values, mask.tolist())]
            return values
        raise ReadError(f"{node.name}: an encoding this reader does not know "
                        f"({node.attrs.get('encoding-type', 'none')!r})")
    return decode(node[()])


def _h5ad_frame(f, key: str) -> tuple[list[str], dict]:
    """(index, {column: group or dataset}) of obs or var (or raw/var) of an AnnData file."""
    node = f[key]
    if isinstance(node, h5py.Dataset):                  # anndata < 0.7: a compound dataset with an "index" field
        arr = node[()]
        names = arr.dtype.names or ()
        index = decode(arr["index"]) if "index" in names else [str(i) for i in range(len(arr))]
        return index, {n: arr[n] for n in names if n != "index"}
    index_key = node.attrs.get("_index", "_index")
    index_key = index_key.decode() if isinstance(index_key, bytes) else str(index_key)
    index = _h5ad_values(node[index_key]) if index_key in node else []
    return index, {k: node[k] for k in node.keys() if k != index_key}


def read_h5ad(loc: Located, microns_per_unit=None, max_units=None) -> Section:
    path = loc.files["counts"]
    notes = []
    try:
        with h5py.File(path, "r") as f:
            obs_index, _ = _h5ad_frame(f, "obs")
            if max_units is not None and len(obs_index) > max_units:
                raise ReadError(f"{path} holds {len(obs_index):,} units; at most {max_units:,} are read here")
            X, var_key, source = None, "var", None
            for key in ("layers/counts", "layers/raw_counts", "layers/count", "raw/X", "X"):
                if key not in f:
                    continue
                M = _h5ad_matrix(f[key])
                try:
                    M.data = _integer_counts(M.data, key)
                except ReadError:
                    continue
                X, source = M, key
                var_key = "raw/var" if key == "raw/X" else "var"
                break
            if X is None:
                raise ReadError(f"{path}: no raw counts (layers['counts'], raw.X, or an X of whole numbers); the "
                                f"analysis normalizes the counts itself")
            var_index, var_cols = _h5ad_frame(f, var_key)
            genes = var_index
            if genes and sum(bool(ENSEMBL_RE.match(g)) for g in genes[:200]) > min(100, len(genes) // 2):
                for c in SYMBOL_COLUMNS:
                    if c in var_cols:
                        symbols = _h5ad_values(var_cols[c])
                        if sum(bool(s.strip()) for s in symbols) > len(symbols) // 2:
                            genes = [s if s.strip() else g for s, g in zip(symbols, genes)]
                            notes.append(f"gene symbols from var['{c}'] (the index holds Ensembl ids)")
                            break
            if "obsm" not in f or "spatial" not in f["obsm"]:
                raise ReadError(f"{path}: no obsm['spatial'] (the positions of the units)")
            sp_node = f["obsm"]["spatial"]
            if isinstance(sp_node, h5py.Group):           # a data frame
                _, cols = _h5ad_frame(f, "obsm/spatial")
                arrs = [np.asarray(v[()] if hasattr(v, "shape") else v, float) for v in list(cols.values())[:2]]
                xy = np.column_stack(arrs)
            else:
                xy = np.asarray(sp_node[()], dtype=float)
            mpp, size = microns_per_unit, None
            if mpp is None and "uns" in f and "spatial" in f["uns"]:
                for lib in f["uns"]["spatial"].values():
                    sf = lib.get("scalefactors") if isinstance(lib, h5py.Group) else None
                    if sf is None:
                        continue
                    if "microns_per_pixel" in sf:
                        mpp = float(np.asarray(sf["microns_per_pixel"][()]).ravel()[0])
                    elif "spot_diameter_fullres" in sf:
                        mpp = VISIUM_SPOT_UM / float(np.asarray(sf["spot_diameter_fullres"][()]).ravel()[0])
                        size = VISIUM_SPOT_UM
                    if mpp:
                        notes.append("micrometres per pixel from uns['spatial'] scale factors")
                        break
    except ReadError:
        raise
    except (OSError, KeyError, ValueError, TypeError, IndexError) as exc:
        raise ReadError(f"{path} is not a readable AnnData file ({exc})") from exc
    if X.shape[0] != len(obs_index) or xy.shape[0] != X.shape[0] or xy.ndim != 2 or xy.shape[1] < 2:
        raise ReadError(f"{path}: the counts, obs and obsm['spatial'] do not have one row per unit")
    if mpp is None:
        mpp = 1.0
        notes.append("positions taken as micrometres (set the sample's micrometres per pixel if they are pixels)")
    ok = np.isfinite(xy[:, 0]) & np.isfinite(xy[:, 1])
    rows = np.flatnonzero(ok)
    notes.append(f"counts from {source}")
    if len(rows) < X.shape[0]:
        notes.append(f"{X.shape[0] - len(rows):,} units without a position are left out")
    return _section("h5ad", X[rows], [obs_index[i] for i in rows.tolist()], genes, xy[rows, 0], xy[rows, 1],
                    microns_per_unit=mpp, size_um=size, n_read=X.shape[0], sources=[path], notes=notes,
                    max_units=max_units)


# ---- plain tables -------------------------------------------------------------------------------------------------------

def _read_lines(path: Path) -> list[list[str]]:
    with _open_text(path) as fh:
        return [line.rstrip("\r\n").split("\t") for line in fh if line.strip()]


def read_table(loc: Located, microns_per_unit=None, max_units=None) -> Section:
    files = loc.files
    notes = []
    if "matrix" in files:
        try:
            M = sparse.coo_matrix(sio.mmread(str(files["matrix"])))   # .mtx or .mtx.gz
        except (OSError, ValueError) as exc:
            raise ReadError(f"{files['matrix']} is not a readable Matrix Market file ({exc})") from exc
        barcodes = [r[0] for r in _read_lines(files["barcodes"])]
        feats = _read_lines(files["features"])
        names = [r[1] if len(r) > 1 else r[0] for r in feats]
        kinds = [r[2] if len(r) > 2 else GENE_EXPRESSION for r in feats]
        if M.shape == (len(names), len(barcodes)):
            M = M.T                                      # 10x MEX: genes x barcodes
        elif M.shape != (len(barcodes), len(names)):
            raise ReadError(f"{files['matrix'].name} is {M.shape[0]} x {M.shape[1]}, but there are "
                            f"{len(barcodes)} barcodes and {len(names)} features")
        X = sparse.csr_matrix(M)
        X.data = _integer_counts(X.data, files["matrix"].name)
        if any(k != GENE_EXPRESSION for k in kinds):
            keep = np.array([k == GENE_EXPRESSION for k in kinds])
            X, names = X[:, keep], [n for n, k in zip(names, kinds) if k == GENE_EXPRESSION]
        ids, genes = barcodes, names
        counts_name = files["matrix"].parent.name + "/matrix.mtx"
    else:
        counts = files["counts"]
        sep = "\t" if ".tsv" in counts.name.lower() else ","

        def ids_of(chunk):
            return [str(v) for v in chunk[chunk.columns[0]].tolist()], np.ones(len(chunk), dtype=bool)

        X, ids, genes = _wide_counts(counts, id_from=ids_of, drop=lambda c, i: i == 0, what="units",
                                     max_units=max_units, sep=sep)
        counts_name = counts.name
    coords = _read_positions_table(files["positions"])
    lower = {str(c).lower() for c in coords.columns}
    id_col = next((c for c in coords.columns if str(c).lower() in ID_COLUMNS), coords.columns[0])
    xc = _column(coords, X_COLUMNS, files["positions"].name)
    yc = _column(coords, Y_COLUMNS, files["positions"].name)
    if "pxl_col_in_fullres" in lower and microns_per_unit is None:
        notes.append("positions are image pixels: set the sample's micrometres per pixel")
    X, ids2, x, y, missing = _attach(X, ids, coords[id_col].astype(str).tolist(), coords[xc], coords[yc], "units",
                                     files["positions"].name)
    if missing:
        notes.append(f"{missing:,} units of {counts_name} have no position and are left out")
    if microns_per_unit is None:
        notes.append("positions taken as micrometres (set the sample's micrometres per pixel if they are not)")
    return _section("table", X, ids2, genes, x, y, microns_per_unit=microns_per_unit or 1.0, n_read=len(ids),
                    sources=files.values(), notes=notes, max_units=max_units)


READERS = {"xenium": read_xenium, "merscope": read_merscope, "cosmx": read_cosmx, "h5ad": read_h5ad,
           "table": read_table}


def read(loc: Located, microns_per_unit: float | None = None, max_units: int | None = None) -> Section:
    """The section at `loc` (not for the Space Ranger platforms: bone_analysis.read_visium_hd and
    webapp.server.RawSection read those). microns_per_unit: the sample's own micrometres per unit of the positions,
    replacing what the platform or the file says; max_units: ReadError beyond that many units."""
    if loc.platform in TEN_X:
        raise ReadError(f"{loc.platform} is read by the Space Ranger readers")
    if loc.platform == "stereo_seq":
        name = loc.files["counts"].name.lower()
        fn = read_stereo_gef if name.endswith(".gef") else read_stereo_gem
        return fn(loc, microns_per_unit=microns_per_unit, max_units=max_units)
    if loc.platform == "xenium":
        sec = read_xenium(loc, max_units=max_units)
        if microns_per_unit:
            sec.microns_per_unit = float(microns_per_unit)
        return sec
    if loc.platform == "merscope":
        sec = read_merscope(loc, max_units=max_units)
        if microns_per_unit:
            sec.microns_per_unit = float(microns_per_unit)
        return sec
    return READERS[loc.platform](loc, microns_per_unit=microns_per_unit, max_units=max_units)


# ============================================================================
# DESCRIBING A SECTION CHEAPLY (the data check)
# ============================================================================

def inspect(loc: Located) -> dict:
    """What can be said of a section without reading its counts: {"unit", "n_units" (None when it takes reading),
    "genes" (names, controls left out; None when unknown), "microns_per_unit" (None: unknown without reading)}."""
    unit = PLATFORMS[loc.platform]["unit"]
    out = {"unit": unit, "n_units": None, "genes": None, "microns_per_unit": None}
    p = loc.platform
    try:
        if p == "xenium":
            with h5py.File(loc.files["counts"], "r") as f:
                m = f["matrix"]
                out["n_units"] = int(m["shape"][()][1])
                names = decode(m["features"]["name"][()])
                kinds = decode(m["features"]["feature_type"][()]) if "feature_type" in m["features"] else None
            out["genes"] = [n for i, n in enumerate(names) if kinds is None or kinds[i] == GENE_EXPRESSION]
            out["microns_per_unit"] = 1.0
        elif p == "merscope":
            head = _header(loc.files["counts"])
            out["genes"] = [c for c in head[1:] if not MERSCOPE_CONTROL_RE.match(c)]
            lines = _count_lines(loc.files["positions"])
            out["n_units"] = None if lines is None else max(0, lines - 1)
            out["microns_per_unit"] = 1.0
        elif p == "cosmx":
            head = _header(loc.files["counts"])
            out["genes"] = [c for c in head if c.lower() not in ("fov", "cell_id", "cell")
                            and not COSMX_CONTROL_RE.match(c)]
            meta_head = _header(loc.files["positions"])
            out["microns_per_unit"] = COSMX_UM_PER_PX if "CenterX_global_px" in meta_head else 1.0
        elif p == "stereo_seq":
            path = loc.files["counts"]
            if path.name.lower().endswith(".gef"):
                with h5py.File(path, "r") as f:
                    res = f.attrs.get("resolution")
                    if "cellBin" in f:
                        out.update(unit="cell", n_units=int(f["cellBin"]["cell"].shape[0]),
                                   genes=_gene_names(f["cellBin"]["gene"][()]))
                    else:
                        levels = sorted(k for k in f["geneExp"].keys() if re.match(r"^bin\d+$", k))
                        out["genes"] = _gene_names(f["geneExp"][levels[0]]["gene"][()])
                        if res is None:
                            res = f["geneExp"][levels[0]]["expression"].attrs.get("resolution")
                    out["microns_per_unit"] = float(np.asarray(res if res is not None else STEREO_PITCH_NM)
                                                    .ravel()[0]) / 1000.0
            else:
                head = _header(path, "\t", "#")
                if any(c in head for c in ("CellID", "cell_id", "cellID")):
                    out["unit"] = "cell"
        elif p == "h5ad":
            with h5py.File(loc.files["counts"], "r") as f:
                obs, _ = _h5ad_frame(f, "obs")
                var, _ = _h5ad_frame(f, "var")
                out["n_units"], out["genes"] = len(obs), var
        elif p == "table":
            files = loc.files
            if "features" in files:
                out["genes"] = [r[1] if len(r) > 1 else r[0] for r in _read_lines(files["features"])
                                if len(r) < 3 or r[2] == GENE_EXPRESSION]
                lines = _count_lines(files["barcodes"])
                out["n_units"] = lines
            else:
                head = _header(files["counts"])
                out["genes"] = head[1:]
    except (OSError, KeyError, ValueError, IndexError, TypeError) as exc:
        raise ReadError(f"{loc.main} cannot be read ({exc})") from exc
    return out


def unit_word(unit: str, n: int | None = 2) -> str:
    return unit if n == 1 else f"{unit}s"
