# thematicGO; BerezinLab @2025
from __future__ import annotations

from pathlib import Path
from typing import Dict, Iterable, List, Optional

import urllib.request

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns

try:
    from gprofiler import GProfiler
except ImportError as e:
    raise ImportError(
        "Could not import GProfiler.\n\n"
        "Install the official g:Profiler client:\n"
        "  pip install gprofiler-official\n\n"
        "If you previously installed the wrong package 'gprofiler', remove it:\n"
        "  pip uninstall gprofiler\n"
    ) from e

GENE_FILES: List[str] = [
    "DRG_oxa_271_genes_FC1.5.txt",
]

# DRG_oxa_271_genes_FC1.5.txt
# Bone_marrow_3691_genes_FC_1,5 genes.txt

OUT_DIR = Path("go_theme_outputs")
CORR_DIR = Path("theme_correlations")
SUBTERM_DIR = OUT_DIR / "subterm_barplots"

OUT_DIR.mkdir(parents=True, exist_ok=True)
CORR_DIR.mkdir(parents=True, exist_ok=True)
SUBTERM_DIR.mkdir(parents=True, exist_ok=True)

ORGANISM = "mmusculus"
# ORGANISM = "hsapiens"

PVAL_COL_PREFERRED = "p_value_adjusted"
P_THRESH = 0.01

GO_ASPECT = "BP"   # "BP", "MF", "CC", or "ALL"

from typing import Dict, List

THEMES: Dict[str, Dict[str, object]] = {

    "Stress & cytokine response": {
        "enabled": True,
        "keywords": [
            "stress", "interferon", "cytokine", "inflammatory", "defense"
        ],
    },

    "Inflammation & immune signaling": {
        "enabled": True,
        "keywords": [
            "inflammation", "inflammatory", "tnf", "il-1", "il-6", "nf-kb", "toll-like",
            "interleukin", "chemokine", "ccl", "cxcl", "immune response",
            "inflammasome", "pattern recognition", "pathogen response"
        ],
    },

    "Oxidative stress & redox regulation": {
        "enabled": True,
        "keywords": [
            "oxidative", "redox", "reactive oxygen", "ros", "nitrosative", "nrf2",
            "antioxidant", "glutathione", "superoxide", "peroxidase", "peroxiredoxin",
            "sod", "catalase", "thioredoxin", "oxidoreductase",
            "hydrogen peroxide", "peroxide", "nitric oxide", "peroxynitrite",
            "nadph oxidase", "mitochondrial ros", "electron transport chain",
            "mitochondrial dysfunction", "oxidative damage", "protein oxidation",
            "lipid peroxidation", "dna oxidation", "redox imbalance"
        ],
    },

    "Extracellular matrix & adhesion": {
        "enabled": True,
        "keywords": [
            "extracellular", "matrix", "adhesion", "integrin", "collagen",
            "remodeling", "fibronectin", "laminin", "basement membrane",
            "mmp", "matrix metalloproteinase", "tenascin", "focal adhesion",
            "ecm", "tissue remodeling", "stromal", "scaffold", "matrisome",
            "cell junction", "cell adhesion", "cell-matrix", "desmosome"
        ],
    },

    "Metabolic re-wiring": {
        "enabled": True,
        "keywords": [
            "metabolic", "oxidoreductase", "catabolic", "fatty",
            "one-carbon", "biosynthetic"
        ],
    },

    "Hematopoietic & immune commitment": {
        "enabled": True,
        "keywords": [
            "hematopoiet", "myeloid", "lymphoid", "leukocyte", "granulocyte",
            "erythro", "megakary", "erythropoiet", "myelopoiet", "thrombopoiet",
            "lymphocyte", "monocyte", "neutrophil", "eosinophil", "basophil",
            "platelet", "erythrocyte", "anemia", "cytopenia", "pancytopenia",
            "thrombocytopenia", "leukopenia", "neutropenia", "immune cell",
            "blood cell", "hematologic", "hematopoiesis", "stem cell", "hsc"
        ],
    },

    "Cell-cycle & Apoptosis": {
        "enabled": True,
        "keywords": [
            "cell cycle", "mitotic", "chromosome", "checkpoint",
            "dna replication", "nuclear division", "apoptosis",
            "programmed cell death", "caspase"
        ],
    },

    "Neuronal Excitability & Synapse": {
        "enabled": False,
        "keywords": [
            "axon", "dendrite", "synapse", "neurotransmitter", "vesicle",
            "action potential", "ion channel", "potassium", "sodium", "calcium",
            "glutamate", "gaba", "synaptic", "neurogenesis", "axonogenesis"
        ],
    },


    "Neurotrophic Signaling & Growth Factors": {
        "enabled": True,   # ← disables the theme globally
        "keywords": [
            "neurotrophin", "ngf", "bdnf", "ntf", "trk", "trka", "trkb", "gdnf",
            "growth factor", "igf", "egf", "fgf", "receptor tyrosine kinase"
        ],
    },

    "Immune-Neuronal Crosstalk": {
        "enabled": True,
        "keywords": [
            "microglia", "macrophage", "satellite glia", "neuroimmune",
            "neuroinflammation", "cd11b", "cd68", "csf1", "tslp",
            "complement", "ccr", "cxcr"
        ],
    },

    "Pain & Nociception": {
        "enabled": True,
        "keywords": [
            "pain", "nociception", "nociceptor", "hyperalgesia", "allodynia",
            "trpv1", "trpa1", "scn9a", "piezo", "itch",
            "sensory perception", "neuropeptide"
        ],
    },

    "Oxidative Phosphorylation & Mitochondria": {
        "enabled": True,
        "keywords": [
            "mitochondrial", "oxidative phosphorylation",
            "electron transport chain", "atp synthase",
            "complex i", "respiratory chain", "mitophagy"
        ],
    },

    "Autophagy & Proteostasis": {
        "enabled": True,
        "keywords": [
            "autophagy", "lysosome", "proteasome",
            "ubiquitin", "protein folding", "chaperone"
        ],
    },

    "Myelination & Schwann Cell Biology": {
        "enabled": False,
        "keywords": [
            "myelin", "schwann cell", "mbp", "mpz", "prx", "pmp22",
            "node of ranvier", "myelination", "myelin sheath",
            "axon ensheathment", "remyelination", "demyelination",
            "schwann cell differentiation", "schwann cell proliferation",
            "schwann cell migration", "axon guidance", "nerve regeneration"
        ],
    },

    "Fibrosis": {
        "enabled": False,
        "keywords": [
            "fibrosis", "fibrotic", "extracellular matrix",
            "matrix organization", "matrix remodeling",
            "collagen", "fibronectin", "laminin",
            "myofibroblast", "tissue remodeling",
            "tgf beta", "smad signaling", "emt", "endmt"
        ],
    },

    "Adipose Tissue Development": {
        "enabled": False,
        "keywords": [
            "adipose tissue", "adipogenesis", "adipocyte",
            "lipid storage", "lipogenesis",
            "ppar gamma", "c/ebp", "thermogenesis"
        ],
    },

    "Allergy": {
        "enabled": False,
        "keywords": [
            "allergy", "allergic", "hypersensitivity",
            "ige", "mast cell", "histamine",
            "th2", "il-4", "il-5", "il-13"
        ],
    },
"Bone remodeling & osteogenesis": {
    "enabled": False,
    "keywords": [
        # Core bone formation / development
        "osteogenesis", "bone formation", "bone development",
        "skeletal development", "ossification",
        "mineralization", "bone mineralization",

        # Osteoblast lineage
        "osteoblast", "osteoblast differentiation", "osteoblast proliferation",
        "osteoid", "bone matrix formation",
        "alkaline phosphatase", "runx2", "osterix", "sp7", "collagen type i",

        # Osteoclast lineage
        "osteoclast", "osteoclast differentiation", "osteoclastogenesis",
        "bone resorption", "tartrate-resistant acid phosphatase", "trap",
        "cathepsin k",

        # Bone remodeling / turnover
        "bone remodeling", "bone turnover", "skeletal homeostasis",

        # Key signaling pathways
        "rank", "rankl", "opg",
        "wnt signaling", "beta-catenin",
        "bmp", "tgf beta", "smad signaling",

        # Bone–marrow niche
        "endosteal niche", "bone marrow niche",
        "osteolineage cell", "hematopoietic niche",
        "mesenchymal stem cell", "stromal cell",

        # Bone matrix & markers
        "bone matrix", "hydroxyapatite",
        "osteocalcin", "osteopontin", "sclerostin",

        # Pathology (optional but informative)
        "osteoporosis", "osteopenia", "bone loss"
    ],
},
    "Cardiac & Muscle Function": {
        "enabled": False,
        "keywords": [
            "heart", "cardiac", "cardiomyocyte",
            "contraction", "sarcomere",
            "troponin", "myosin", "arrhythmia",
            "heart failure", "cardiomyopathy"
        ],
    },
}


gp = GProfiler(return_dataframe=True)

def load_genes(path: str | Path) -> List[str]:
    """Load gene symbols from a text file (one per line)."""
    path = Path(path)
    genes = [line.strip() for line in path.read_text().splitlines() if line.strip()]
    print(f"Loaded {path.name}: {len(genes)} genes")
    return genes

def _pick_pval_column(df: pd.DataFrame) -> str:
    """Pick adjusted p-value column if present; otherwise fall back to raw p-value."""
    if PVAL_COL_PREFERRED in df.columns:
        return PVAL_COL_PREFERRED
    if "p_value" in df.columns:
        return "p_value"
    raise KeyError(
        "No p-value column found in g:Profiler results. "
        "Expected 'p_value' and/or 'p_value_adjusted'."
    )

def filter_go_aspect(enr_df: pd.DataFrame, go_aspect: str) -> pd.DataFrame:
    go_aspect = go_aspect.upper().strip()
    if go_aspect in ("ALL", ""):
        return enr_df

    source_map = {"BP": "GO:BP", "MF": "GO:MF", "CC": "GO:CC"}
    if go_aspect not in source_map:
        raise ValueError("go_aspect must be one of: 'BP', 'MF', 'CC', 'ALL'")

    return enr_df[enr_df["source"] == source_map[go_aspect]].copy()

def enrich(genes: Iterable[str], p_thresh: float = P_THRESH) -> pd.DataFrame:
    """Run g:Profiler enrichment and compute a Score = -log10(p).

    Uses adjusted p-values if available; otherwise uses raw p-values.
    """
    df = gp.profile(organism=ORGANISM, query=list(genes))
    if df is None or df.empty:
        return pd.DataFrame()

    pcol = _pick_pval_column(df)
    df = df.sort_values(pcol).copy()
    df = df[df[pcol] < p_thresh].copy()
    df["Score"] = -np.log10(df[pcol].astype(float))
    df["p_col_used"] = pcol
    print(f"Significant terms ({pcol} < {p_thresh}): {len(df)}")
    return df


def assign_themes(go_term: str) -> list[str]:
    matched = []
    term = go_term.lower()

    for theme, cfg in THEMES.items():
        for kw in cfg["keywords"]:
            if kw in term:
                matched.append(theme)
                break

    return matched

def is_theme_enabled(theme: str) -> bool:

    return THEMES.get(theme, {}).get("enabled", True)



def aggregate_themes(enr_df: pd.DataFrame) -> pd.DataFrame:
    """
    Aggregate enrichment results by Theme.
    Includes ALL predefined themes, even if they have zero significant terms.
    """
    # Initialize all themes with zeros
    out = pd.DataFrame(
        {
            "Theme": list(THEMES.keys()),
            "Score": 0.0,
            "Terms": 0,
        }
    ).set_index("Theme")

    if enr_df.empty:
        return out

    df = enr_df.copy()
#    df["Themes"] = df["name"].apply(assign_themes)
#    df = df[df["Themes"].map(len) > 0]
#    df = df.explode("Themes").rename(columns={"Themes": "Theme"})

    df = enr_df.copy()
    df = df.dropna(subset=["Theme"])


    agg = (
        df.groupby("Theme", sort=False)
        .agg(
            Score=("Score", "sum"),
            Terms=("Theme", "count"),
        )
    )

    # Update initialized table
    out.update(agg)

    # Sort by score (optional)
    out = out.sort_values("Score", ascending=False)

    return out


def save_theme_table(themed: pd.DataFrame, prefix: str) -> Path:
    """Save theme summary table as TSV."""
    out = OUT_DIR / f"{prefix}_themes.tsv"
    themed.to_csv(out, sep="\t")
    return out

def plot_theme_bar(themed: pd.DataFrame, title: str, outfile: Path) -> None:
    """Publication-style horizontal bar plot for theme scores."""
    if themed.empty:
        return

    sns.set_context("paper", font_scale=1.0)
    plt.rcParams.update(
        {
            "pdf.fonttype": 42,
            "ps.fonttype": 42,
            "font.size": 10,
            "axes.titlesize": 11,
            "axes.labelsize": 10,
        }
    )

    fig, ax = plt.subplots(figsize=(7.5, 4.2))
    ax.barh(themed.index[::-1], themed["Score"][::-1])
    ax.set_xlabel(r"Cumulative $-\log_{10}(p)$")
    ax.set_title(title, loc="left", weight="bold")
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    fig.tight_layout()
    fig.savefig(outfile, dpi=600)
    plt.close(fig)

def plot_theme_bubble(
    themed: pd.DataFrame,
    title: str,
    outfile: Path,
):
    """
    Bubble plot of thematic enrichment.
    X-axis: cumulative theme score
    Bubble size: number of GO terms
    """

    fig, ax = plt.subplots(figsize=(8, max(3, 0.5 * len(themed))), constrained_layout=True)

    y = np.arange(len(themed))

    sizes = themed["Terms"].values
    scores = themed["Score"].values

    # Scale bubble sizes for visibility
    size_scaled = 80 + 40 * sizes
    # Horizontal guidelines for each theme
    for yi in y:
        ax.axhline(
            y=yi,
            color="lightgray",
            linestyle=":",
            linewidth=0.8,
            zorder=0
        )
    ax.scatter(
        scores,
        y,
        s=size_scaled,
        color="#55A868",
        alpha=0.75,
        edgecolor="green",
        linewidth=0.5,
    )
    #color = "#1f77b4"  # classic matplotlib blue
    #color = "#2E86AB"  # muted scientific blue
    #color = "#5DA5DA"  # lighter blue
    #color = "#C44E52"  # muted red
    #color = "#55A868"  # green

    ax.set_yticks(y)
    ax.set_yticklabels(themed.index)
    ax.set_xlabel(r"Cumulative enrichment score (∑ −log$_{10}$(p))")
    ax.set_title(title, loc="left", weight="bold")

    ax.invert_yaxis()  # highest score on top
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)

    # Bubble size legend
    for n in sorted(set(sizes)):
        ax.scatter([], [],
                   s=80 + 40 * n,
                   label=f"{n} terms",
                   color="#55A868",
                   alpha=0.75,
                   edgecolor="green")

    ax.legend(
        title="Number of GO terms",
        frameon=False,
        loc="lower right",
        bbox_to_anchor=(0.98, 0.2)

    )

    plt.savefig(outfile, dpi=600)
    plt.close()

    print(f"Theme bubble plot saved → {outfile}")


def plot_subterms_bar(enr_df: pd.DataFrame, theme_name: str, prefix: str) -> Optional[Path]:
    """Save a per-theme bar plot of subterms ranked by Score."""
  #  sub = enr_df.copy()
   # sub["Themes"] = sub["name"].apply(assign_themes)
 #   sub = sub[sub["Themes"].apply(lambda x: theme_name in x)]
#  sub = sub.explode("Themes")
 #   sub = sub[sub["Themes"] == theme_name]
  #  sub = sub.sort_values("Score", ascending=True)

    sub = enr_df[enr_df["Theme"] == theme_name].sort_values("Score", ascending=True)

    if sub.empty:
        return None

    sns.set_context("paper", font_scale=0.9)
    plt.rcParams.update({"pdf.fonttype": 42, "ps.fonttype": 42, "font.size": 9})

    height = max(2.2, 0.28 * len(sub))
    fig, ax = plt.subplots(figsize=(7.5, height))
    ax.barh(sub["name"], sub["Score"])
    ax.set_xlabel(r"$-\log_{10}(p)$")
    ax.set_title(f"{theme_name}: enriched terms", loc="left", weight="bold")
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    fig.tight_layout()

    theme_safe = theme_name.replace(" ", "_").replace("&", "and").replace("/", "_")
    out = SUBTERM_DIR / f"{prefix}_{theme_safe}_subterms.png"
    fig.savefig(out, dpi=600)
    plt.close(fig)
    return out

def run_one_gene_file(path: str | Path) -> None:
    path = Path(path)
    prefix = path.stem.replace(" ", "_")

    # --------------------------------------------------
    # Load genes and perform enrichment
    # --------------------------------------------------
    genes = load_genes(path)
    enr = enrich(genes, p_thresh=P_THRESH)
    enr = filter_go_aspect(enr, GO_ASPECT)

    if enr.empty:
        print(f"No significant enrichment for {path.name}.")
        return

    # --------------------------------------------------
    # Assign themes (authoritative assignment)
    # --------------------------------------------------
    enr["Themes"] = enr["name"].apply(assign_themes)
    enr = enr.explode("Themes").rename(columns={"Themes": "Theme"})

    # Keep full theme annotation per GO term (for transparency)
    enr["All_Themes"] = enr.groupby(enr.index)["Theme"].transform(
        lambda x: "; ".join(sorted({t for t in x if isinstance(t, str)}))
    )

    # --------------------------------------------------
    # Restrict to GO terms for gene intersection expansion
    # --------------------------------------------------
    enr_go = enr[enr["native"].astype(str).str.startswith("GO:")].copy()

    overlap = None  # default if network cannot be built

    if enr_go.empty:
        print(
            "No GO terms found (native does not start with 'GO:'); "
            "skipping GO→gene intersection and network construction."
        )
    else:
        # --------------------------------------------------
        # Export supplementary GO table WITH gene intersections
        # --------------------------------------------------
        sup_path = export_supplementary_go_table_with_intersections(
            enr_df=enr_go,
            gene_file=path,
            prefix=f"{prefix}_{GO_ASPECT}",
            out_dir=OUT_DIR,
            categories=ncbi_categories_for_aspect(GO_ASPECT),
        )

        sup = pd.read_csv(sup_path, sep="\t")

        # --------------------------------------------------
        # Build theme–theme overlap matrix
        # --------------------------------------------------
        theme_to_genes = build_theme_gene_sets(sup)
        overlap = compute_theme_overlap(theme_to_genes)

        overlap_tsv = CORR_DIR / f"{prefix}_{GO_ASPECT}_theme_overlap.tsv"
        overlap.to_csv(overlap_tsv, sep="\t")
        print(f"Theme overlap matrix saved → {overlap_tsv}")

    # --------------------------------------------------
    # Aggregate themes ONCE (authoritative theme scores)
    # --------------------------------------------------
    themed = aggregate_themes(enr)
    themed["Enabled"] = themed.index.map(is_theme_enabled)
    tsv_path = save_theme_table(themed, prefix)
    print(f"Theme table saved → {tsv_path}")

    themed_nonzero = themed[
        (themed["Score"] > 0)
        & themed["Enabled"]
        ]

    # --------------------------------------------------
    # Plot theme summary bar  and bubble plot
    # --------------------------------------------------
    plot_theme_bar(
        themed_nonzero,
        title=f"Thematic processes ({path.name})",
        outfile=OUT_DIR / f"{prefix}_themes_bar.png",
    )
    plot_theme_bubble(
        themed_nonzero,
        title=f"Thematic processes ({path.name})",
        outfile=OUT_DIR / f"{prefix}_themes_bubble.png",
    )

    # --------------------------------------------------
    # Plot theme–theme overlap network (if available)
    # --------------------------------------------------
    if overlap is not None:
        plot_theme_overlap_network(
            overlap_df=overlap,
            theme_scores=themed["Score"],
            out_file=CORR_DIR / f"{prefix}_{GO_ASPECT}_theme_overlap_network.png",
        )

    # --------------------------------------------------
    # Plot subterm barplots per theme
    # --------------------------------------------------
    for theme in themed_nonzero.index:
        plot_subterms_bar(enr, theme, prefix)



def main() -> None:
    for f in GENE_FILES:
        run_one_gene_file(f)

from pathlib import Path
import gzip
import urllib.request
import pandas as pd

NCBI_GENE2GO_URL = "https://ftp.ncbi.nlm.nih.gov/gene/DATA/gene2go.gz"
NCBI_GENE_INFO_URL = "https://ftp.ncbi.nlm.nih.gov/gene/DATA/gene_info.gz"
MOUSE_TAXID = 10090
# HUMAN_TAXID = 9606

def _download_if_missing(url: str, out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    if out_path.exists() and out_path.stat().st_size > 0:
        return
    print(f"Downloading → {out_path.name}")
    urllib.request.urlretrieve(url, out_path)

def _load_mouse_entrez_to_symbol(gene_info_gz: Path, taxid: int = MOUSE_TAXID) -> dict[int, str]:
    """
    Load mapping: Entrez GeneID -> Symbol (mouse only) from NCBI gene_info.gz
    """
    mapping: dict[int, str] = {}
    with gzip.open(gene_info_gz, "rt", encoding="utf-8", errors="replace") as f:
        for line in f:
            if line.startswith("#"):
                continue
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 3:
                continue
            if int(parts[0]) != taxid:
                continue
            gene_id = int(parts[1])
            symbol = parts[2]
            mapping[gene_id] = symbol
    return mapping

def ncbi_categories_for_aspect(go_aspect: str) -> set[str] | None:
    go_aspect = go_aspect.upper().strip()
    if go_aspect in ("ALL", ""):
        return None
    return {"BP": {"Process"}, "MF": {"Function"}, "CC": {"Component"}}[go_aspect]

def _build_goid_to_all_genes(
    gene2go_gz: Path,
    entrez_to_symbol: dict[int, str],
    taxid: int = MOUSE_TAXID,
    categories: set[str] | None = None,
) -> dict[str, set[str]]:
    """
    Build mapping: GO_ID -> set(Symbols) for all genes annotated to that GO term
    using NCBI gene2go.gz (filtered to the specified taxid and optional categories).

    Caches the final mapping to disk to avoid rebuilding on every run.
    """
    import gzip
    import pickle

    # Cache file name depends on taxid + categories to avoid mixing caches
    cat_tag = "ALL" if categories is None else "_".join(sorted(categories))
    cache_file = Path("ncbi_cache") / f"go_to_genes_tax{taxid}_{cat_tag}.pkl"
    cache_file.parent.mkdir(parents=True, exist_ok=True)

    if cache_file.exists() and cache_file.stat().st_size > 0:
        print(f"Loading cached GO→gene mapping → {cache_file}")
        with open(cache_file, "rb") as f:
            return pickle.load(f)

    go_to_genes: dict[str, set[str]] = {}

    with gzip.open(gene2go_gz, "rt", encoding="utf-8", errors="replace") as f:
        header = f.readline().rstrip("\n").split("\t")

        # Normalize header names (NCBI uses '#tax_id')
        header_norm = [h.lstrip("#") for h in header]
        col = {name: i for i, name in enumerate(header_norm)}

        required = ["tax_id", "GeneID", "GO_ID", "Category"]
        missing = [c for c in required if c not in col]
        if missing:
            raise KeyError(
                f"gene2go header missing columns: {missing}. Found (normalized): {header_norm}"
            )

        for line in f:
            parts = line.rstrip("\n").split("\t")
            if len(parts) <= max(col.values()):
                continue

            if int(parts[col["tax_id"]]) != taxid:
                continue

            cat = parts[col["Category"]]
            if categories is not None and cat not in categories:
                continue

            entrez = int(parts[col["GeneID"]])
            symbol = entrez_to_symbol.get(entrez)
            if not symbol:
                continue

            go_id = parts[col["GO_ID"]]
            go_to_genes.setdefault(go_id, set()).add(symbol)

    # Cache once, after fully built
    with open(cache_file, "wb") as f:
        pickle.dump(go_to_genes, f)

    print(f"Cached GO→gene mapping → {cache_file}")
    return go_to_genes

def export_supplementary_go_table_with_intersections(
    enr_df: pd.DataFrame,
    gene_file: str | Path,
    prefix: str,
    out_dir: str | Path,
    cache_dir: str | Path = "ncbi_cache",
    categories: set[str] | None = None,   # e.g., {"Process"} to restrict to BP
) -> Path | None:
    """
    Export a GO-term supplementary table including:
      - full gene set size from NCBI annotation
      - intersection gene list with your input genes (case-insensitive intersection)

    Requires 'native' column in enr_df (GO IDs).
    """
    if enr_df is None or enr_df.empty:
        print("Enrichment dataframe is empty; skipping supplementary export.")
        return None

    if "native" not in enr_df.columns:
        raise KeyError(
            "enr_df must include a 'native' column containing GO IDs (e.g., GO:0006954)."
        )

    gene_file = Path(gene_file)

    # Read input genes (case-insensitive)
    in_genes_raw = [g.strip() for g in gene_file.read_text().splitlines() if g.strip()]
    in_genes_upper = {g.upper() for g in in_genes_raw}

    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    cache_dir = Path(cache_dir)
    gene2go_gz = cache_dir / "gene2go.gz"
    gene_info_gz = cache_dir / "gene_info.gz"

    # Download annotation files once (cached)
    _download_if_missing(NCBI_GENE2GO_URL, gene2go_gz)
    _download_if_missing(NCBI_GENE_INFO_URL, gene_info_gz)

    # Build annotation maps
    print("Loading mouse GeneID→Symbol mapping...")
    entrez_to_symbol = _load_mouse_entrez_to_symbol(gene_info_gz, taxid=MOUSE_TAXID)

    print("Building GO_ID→all genes mapping (mouse)...")
    go_to_all_genes = _build_goid_to_all_genes(
        gene2go_gz,
        entrez_to_symbol,
        taxid=MOUSE_TAXID,
        categories=categories,
    )

    # Make sure Theme exists
    if "Theme" not in enr_df.columns:
        enr_df = enr_df.copy()
        enr_df["Themes"] = enr_df["name"].apply(assign_themes)
        enr_df = enr_df.explode("Themes").rename(columns={"Themes": "Theme"})

        if enr_df.empty:
            print("No enriched terms matched any theme keywords; skipping themed supplementary export.")
            return None

    # Choose p-value column used
    pcol = _pick_pval_column(enr_df)

    rows = []
    for _, r in enr_df.iterrows():
        go_id = r["native"]
        all_genes = go_to_all_genes.get(go_id, set())

        if not all_genes:
            inter = []
        else:
            # Case-insensitive intersection, but keep canonical symbols from NCBI
            all_upper_to_canonical: dict[str, str] = {}
            for g in all_genes:
                gu = g.upper()
                # keep the first seen canonical symbol (stable enough for output)
                if gu not in all_upper_to_canonical:
                    all_upper_to_canonical[gu] = g

            inter_upper = sorted(set(all_upper_to_canonical.keys()).intersection(in_genes_upper))
            inter = [all_upper_to_canonical[u] for u in inter_upper]

        rows.append({
            "GO_ID": go_id,
            "GO_term": r["name"],
            "source": r.get("source", np.nan),

            "Theme": r.get("Theme", None),
            "p_value_used": r[pcol],
            "Score": r["Score"],

            # Sizes
            "term_size_gProfiler": r.get("term_size", np.nan),
            "Term_size_annotation": len(all_genes),

            # Intersection
            "Intersection_size": len(inter),
            "Intersection_genes": ",".join(inter),
        })

    sup = pd.DataFrame(rows).sort_values(["Theme", "Score"], ascending=[True, False])

    out_path = out_dir / f"{prefix}_GO_terms_with_intersection_genes.tsv"
    sup.to_csv(out_path, sep="\t", index=False)

    print(f"Supplementary table saved → {out_path}")
    #return out_path

    sup = pd.DataFrame(rows).sort_values(["Theme", "Score"], ascending=[True, False])

    out_tsv = out_dir / f"{prefix}_GO_terms_with_intersection_genes.tsv"
    out_csv = out_dir / f"{prefix}_GO_terms_with_intersection_genes.csv"
    out_xlsx = out_dir / f"{prefix}_GO_terms_with_intersection_genes.xlsx"

    print("Saved files:")
    print(out_tsv.resolve())
    print(out_csv.resolve())
    print(out_xlsx.resolve())

    sup.to_csv(out_tsv, sep="\t", index=False)
    sup.to_csv(out_csv, index=False)

    # Excel export requires: pip install openpyxl
    sup.to_excel(out_xlsx, index=False)

    print(f"Supplementary tables saved → {out_tsv} | {out_csv} | {out_xlsx}")
    return out_tsv
def build_theme_gene_sets(enr_df: pd.DataFrame) -> dict[str, set[str]]:
    """
    Build mapping: Theme -> set of genes contributing to that theme.
    Uses gene-level intersections from the supplementary GO table.
    """
    theme_to_genes: dict[str, set[str]] = {}

    for _, r in enr_df.iterrows():
        theme = r.get("Theme")
        genes = r.get("Intersection_genes")

        # Skip rows without valid theme or gene list
        if not isinstance(theme, str):
            continue
        if not isinstance(genes, str):
            continue

        gene_set = {g.strip() for g in genes.split(",") if g.strip()}
        if not gene_set:
            continue

        theme_to_genes.setdefault(theme, set()).update(gene_set)

    return theme_to_genes

def compute_theme_overlap(theme_to_genes: dict[str, set[str]]) -> pd.DataFrame:
    """
    Compute theme–theme overlap (shared gene counts).
    """
    themes = list(theme_to_genes.keys())
    mat = pd.DataFrame(0, index=themes, columns=themes, dtype=int)

    for t1 in themes:
        for t2 in themes:
            mat.loc[t1, t2] = len(theme_to_genes[t1].intersection(theme_to_genes[t2]))

    return mat
def compute_theme_jaccard(theme_to_genes: dict[str, set[str]]) -> pd.DataFrame:
    themes = list(theme_to_genes.keys())
    mat = pd.DataFrame(0.0, index=themes, columns=themes)

    for t1 in themes:
        for t2 in themes:
            inter = theme_to_genes[t1] & theme_to_genes[t2]
            union = theme_to_genes[t1] | theme_to_genes[t2]
            mat.loc[t1, t2] = len(inter) / len(union) if union else 0.0

    return mat
import networkx as nx

import networkx as nx
import numpy as np

def plot_theme_overlap_network(
    overlap_df: pd.DataFrame,
    theme_scores: pd.Series,
    out_file: Path,
):
    """
    Plot a theme–theme overlap network.
    Nodes = themes (size ∝ cumulative theme score)
    Edges = shared genes (color ∝ number of shared genes)
    """

    G = nx.Graph()

    # --------------------------------------------------
    # Add all themes as nodes
    # --------------------------------------------------
    for theme in overlap_df.index:
        if not is_theme_enabled(theme):
            continue
        G.add_node(theme, score=theme_scores.get(theme, 0.0))


    # --------------------------------------------------
    # Add edges (shared genes)
    # --------------------------------------------------
    for i, t1 in enumerate(overlap_df.index):
        for t2 in overlap_df.columns[i + 1:]:
            shared = overlap_df.loc[t1, t2]

            if (
                    shared > 0
                    and is_theme_enabled(t1)
                    and is_theme_enabled(t2)
            ):
                G.add_edge(t1, t2, weight=shared)

    # --------------------------------------------------
    # Layout (true circular)
    # --------------------------------------------------
    pos = nx.circular_layout(G, scale=1.3)

    # --------------------------------------------------
    # Node sizes
    # --------------------------------------------------
    scores = np.array([G.nodes[n]["score"] for n in G.nodes()])
    if scores.max() > 0:
        sizes = 300 + 1200 * (scores / scores.max())
    else:
        sizes = np.full(len(scores), 300)

    # --------------------------------------------------
    # Prepare edge colors
    # --------------------------------------------------
    edges = list(G.edges(data=True))
    weights = [d["weight"] for _, _, d in edges]
    # Normalize weights for edge thickness
    w_min, w_max = min(weights), max(weights)
    MIN_EDGE_WIDTH = 1
    MAX_EDGE_WIDTH = 10
    if w_min == w_max:
        widths = [2.0 for _ in weights]
    else:
        widths = [
            MIN_EDGE_WIDTH
            + (w - w_min) / (w_max - w_min) * (MAX_EDGE_WIDTH - MIN_EDGE_WIDTH)
            for w in weights
        ]

    import matplotlib.cm as cm
    import matplotlib.colors as mcolors

    if weights:
        norm = mcolors.Normalize(vmin=min(weights), vmax=max(weights))
        from matplotlib import colormaps
        cmap = colormaps["jet"]
        edge_colors = [cmap(norm(w)) for w in weights]
    else:
        norm = None
        edge_colors = "gray"

    # --------------------------------------------------
    # Plot
    # --------------------------------------------------
    fig, ax = plt.subplots(figsize=(8, 8))

    nx.draw_networkx_nodes(
        G, pos,ax = ax,
        node_size=sizes,
        node_color="#4C72B0",
        alpha=0.9
    )

    if edges:
        nx.draw_networkx_edges(
            G,
            pos,
            ax=ax,
            edgelist=[(u, v) for u, v, _ in edges],
            edge_color=edge_colors,
            width=widths,
            alpha=0.75
        )

    labels = {k: wrap_label(k) for k in G.nodes()}
    # Push labels slightly outward from the nodes
    label_pos = {
        k: (v[0] * 1.08, v[1] * 1.08)
        for k, v in pos.items()
    }

    nx.draw_networkx_labels(
        G,
        label_pos,
        labels=labels,
        ax=ax,
        font_size=9,
        horizontalalignment="center",
        verticalalignment="center",
        clip_on=False
    )

    if weights:
        sm = cm.ScalarMappable(norm=norm, cmap=cmap)
        sm.set_array([])
        cbar = fig.colorbar(sm, ax=ax, shrink=0.6)
        cbar.set_label("Number of shared genes", rotation=90)

    plt.title("Theme–Theme Gene Overlap Network", loc="left", weight="bold")
    plt.axis("off")
    plt.tight_layout()
    plt.savefig(out_file, dpi=600)
    plt.close()

    print(f"Theme overlap network saved → {out_file}")

def wrap_label(label: str) -> str:
    if " & " in label:
        return label.replace(" & ", "\n& ")
    return label

if __name__ == "__main__":
    main()