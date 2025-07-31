# -----------------------------------------------
# 0 | Imports, constants, output folders
# -----------------------------------------------
import os, numpy as np, pandas as pd, matplotlib.pyplot as plt, seaborn as sns
from gprofiler import GProfiler

gp = GProfiler(return_dataframe=True)

GENE_FILES = ["885 genes.txt"]

#TOP_N_TERMS = 700
THEMES = {
    "Stress & cytokine response": [
        "stress", "interferon", "cytokine", "inflammatory", "defense"
    ],
    "Inflammation & immune signaling": [
        "inflammation", "inflammatory", "tnf", "il-1", "il-6", "nf-kb", "toll-like",
        "interleukin", "chemokine", "ccl", "cxcl", "immune response",
        "inflammasome", "pattern recognition", "pathogen response"
    ],
    "Oxidative stress & redox regulation": [
        "oxidative", "redox", "reactive oxygen", "ros", "nitrosative", "nrf2",
        "antioxidant", "glutathione", "superoxide", "peroxidase", "peroxiredoxin",
        "sod", "catalase", "thioredoxin", "oxidoreductase"
    ],
    "Extracellular matrix & adhesion": [
        "extracellular", "matrix", "adhesion", "integrin", "collagen",
        "remodeling", "fibronectin", "laminin", "basement membrane",
        "mmp", "matrix metalloproteinase", "tenascin", "focal adhesion",
        "ecm", "tissue remodeling", "stromal", "scaffold", "matrisome",
        "cell junction", "cell adhesion", "cell-matrix", "desmosome"
    ],
    "Metabolic re-wiring": [
        "metabolic", "oxidoreductase", "catabolic", "fatty",
        "one-carbon", "biosynthetic"
    ],
    "Hematopoietic & immune commitment": [
        "hematopoiet", "myeloid", "lymphoid", "leukocyte", "granulocyte",
        "erythro", "megakary", "erythropoiet", "myelopoiet", "thrombopoiet",
        "lymphocyte", "monocyte", "neutrophil", "eosinophil", "basophil",
        "platelet", "erythrocyte", "anemia", "cytopenia", "pancytopenia",
        "thrombocytopenia", "leukopenia", "neutropenia", "immune cell",
        "blood cell", "hematologic", "hematopoiesis", "stem cell", "hsc"
    ],
    "Cell-cycle & Apoptosis": [
        "cell cycle", "mitotic", "chromosome", "checkpoint",
        "dna replication", "nuclear division", "apoptosis",
        "programmed cell death", "caspase"
    ],
    "Neuronal Excitability & Synapse": [
        "axon", "dendrite", "synapse", "neurotransmitter", "vesicle",
        "action potential", "ion channel", "potassium", "sodium", "calcium",
        "glutamate", "gaba", "synaptic", "neurogenesis", "axonogenesis"
    ],
    "Neurotrophic Signaling & Growth Factors": [
        "neurotrophin", "ngf", "bdnf", "ntf", "trk", "trka", "trkb", "gdnf",
        "growth factor", "igf", "egf", "fgf", "receptor tyrosine kinase"
    ],
    "Immune-Neuronal Crosstalk": [
        "microglia", "macrophage", "satellite glia", "neuroimmune", "neuroinflammation",
        "cd11b", "cd68", "csf1", "tslp", "complement", "ccr", "cxcr"
    ],
    "Pain & Nociception": [
        "pain", "nociception", "nociceptor", "hyperalgesia", "allodynia",
        "trpv1", "trpa1", "scn9a", "piezo", "itch", "sensory perception", "neuropeptide"
    ],
    "Oxidative Phosphorylation & Mitochondria": [
        "mitochondrial", "oxidative phosphorylation", "electron transport chain",
        "atp synthase", "complex i", "respiratory chain", "mitophagy"
    ],
    "Autophagy & Proteostasis": [
        "autophagy", "lysosome", "proteasome", "ubiquitin", "protein folding", "chaperone"
    ],
    "Myelination & Schwann Cell Biology": [
        "myelin", "schwann cell", "mbp", "mpz", "prx", "pmp22", "node of ranvier"
    ]
}

# Create output directories
os.makedirs("go_theme_outputs", exist_ok=True)
os.makedirs("theme_correlations", exist_ok=True)

# -----------------------------------------------
# 1 | Helper functions (enrichment & theming)
# -----------------------------------------------
def load_genes(txt):
    """Load genes from text file"""
    try:
        with open(txt, 'r', encoding='utf-8') as f:
            genes = [g.strip() for g in f if g.strip()]
        print(f"Loaded {txt} ({len(genes)} genes)")
        return genes
    except FileNotFoundError:
        print(f"Warning: File '{txt}' not found. Please check the file path.")
        return []
    except Exception as e:
        print(f"Error loading file '{txt}': {e}")
        return []

def enrich(genes, p_thresh=1e-2):
    """Perform gene enrichment analysis"""
    if not genes:
        print("No genes to analyze")
        return pd.DataFrame()
    
    try:
        df = gp.profile(organism="mmusculus", query=genes)
        df = df[df["p_value"] < p_thresh].sort_values("p_value").copy()
        df["Score"] = -np.log10(df["p_value"])
        print(f"Significant enriched terms (p < {p_thresh}): {len(df)} rows")
        return df
    except Exception as e:
        print(f"Error in enrichment analysis: {e}")
        return pd.DataFrame()

#Only works when TOP_N_TERMS is active and specified.
#def enrich(genes):
#    df = gp.profile(organism="mmusculus", query=genes)
#   df = df.sort_values("p_value").head(TOP_N_TERMS).copy()
#   df["Score"] = -np.log10(df["p_value"])
#    return df

def assign_theme(name):
    """Assign theme to GO term based on keywords"""
    low = name.lower()
    for th, kws in THEMES.items():
        if any(kw in low for kw in kws):
            return th
    return None

def aggregate(df):
    """Aggregate GO terms by theme"""
    if df.empty:
        return pd.DataFrame()
    
    df["Theme"] = df["name"].apply(assign_theme)
    themed = (df.dropna(subset=["Theme"])
              .groupby("Theme")
              .agg(Score=("Score", "sum"),
                   Terms=("Theme", "count"))
              .sort_values("Score", ascending=False))
    return themed

def plot_subterms_bar(enr_df, theme_name, path_prefix, output_folder):
    """Plot subterms for a specific theme"""
    # Filter GO terms belonging to the current theme
    sub_df = enr_df[enr_df["Theme"] == theme_name].sort_values("Score", ascending=True)

    if sub_df.empty:
        return  # Skip if no terms for this theme

    # Plot
    plt.figure(figsize=(7, max(2, 0.3 * len(sub_df))))
    plt.barh(sub_df["name"], sub_df["Score"], color="mediumseagreen")
    plt.xlabel("-log10(p-value)", size=10)
    plt.title(f"Top GO Terms in Theme: {theme_name}", loc="left", fontsize=11, weight="bold")
    plt.tight_layout()

    # Save
    theme_safe = theme_name.replace(" ", "_").replace("&", "and")
    output_file = os.path.join(output_folder, f"{path_prefix}_{theme_safe}_subterms.png")
    plt.savefig(output_file, dpi=300)
    plt.close()
    print(f"subterm plot saved → {output_file}")

# -----------------------------------------------
# 2 | Main processing loop
# -----------------------------------------------
def process_gene_file(path):
    """Process a single gene file"""
    print(f"\n{'='*50}")
    print(f"Processing: {path}")
    print(f"{'='*50}")
    
    # Load genes
    genes = load_genes(path)
    if not genes:
        return
    
    # Perform enrichment
    enr = enrich(genes)
    if enr.empty:
        print("No significant enrichment results found")
        return
    
    # Assign themes and aggregate
    enr["Theme"] = enr["name"].apply(assign_theme)
    themed = aggregate(enr)
    
    if themed.empty:
        print("No themes found in enrichment results")
        return
    
    # Create file prefix for outputs
    prefix = path.replace(' ', '_').replace('.txt', '')
    
    # Save theme summary table
    # tsv_out = os.path.join("go_theme_outputs", f"{prefix}_themes.tsv")
    tsv_out = os.path.join(f"{prefix}_themes.tsv")
    themed.to_csv(tsv_out, sep='\t')
    print(f"table saved → {tsv_out}")

    # Main theme bar plot
    plt.figure(figsize=(8, 4.5))
    plt.barh(themed.index, themed.Score, color=plt.cm.Set2.colors[:len(themed)])
    plt.gca().invert_yaxis()
    plt.xlabel("Cumulative -log10(p_value)", size=11)
    plt.title(f"Thematic processes ({path})", loc="left", weight="bold")
    plt.tight_layout()
    # png_out = os.path.join("go_theme_outputs", f"{prefix}_themes.png")
    png_out = os.path.join(f"{prefix}_themes.png")
    plt.savefig(png_out, dpi=300)
    plt.show()
    print(f"plot saved → {png_out}")

    # Create subterm plots
    # subterm_folder = os.path.join("go_theme_outputs", "subterm_barplots")
    subterm_folder = os.path.join("subterm_barplots")
    os.makedirs(subterm_folder, exist_ok=True)
    
    # Save subterm plots for each theme
    for theme in themed.index:
        plot_subterms_bar(enr, theme, prefix, subterm_folder)

# -----------------------------------------------
# 3 | Execute main processing
# -----------------------------------------------
if __name__ == "__main__":
    # Process each gene file
    for path in GENE_FILES:
        process_gene_file(path)
    
    print("\nProcessing complete!")