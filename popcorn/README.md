# Popcorn Genetic

The Visium HD bone-lesion analysis of the manuscript (`bone_analysis.py`, `bone_figures.py`), fixed and turned into a
local web application that reads the sections of most spatial transcriptomics instruments: 10x Visium HD and Visium,
10x Xenium, Vizgen MERSCOPE, Bruker CosMx, STOmics Stereo-seq, AnnData (`.h5ad`) files and plain count tables
([Instruments](#instruments)). Choose the sections and gene signatures in the browser, look at the raw data, run the
base analysis in the background with live progress (quality control, normalization, signature scores and positivity
calls, tissue assignment), then make the analyses you want with the tools of the run's **Analysis** tab and browse the
tables and per-bin spatial maps. The command line keeps working as before and still draws the manuscript's figures.

Every change to the original scripts is marked in the code by a `[FIX]` or `[APP]` note.

## Start

**Windows** (PowerShell, in this folder):

```
powershell -ExecutionPolicy Bypass -File .\start.ps1
```

**macOS / Linux**:

```
./start.sh
```

The first start creates `.venv`, installs `requirements.txt` (a few minutes) and opens http://127.0.0.1:8765.
Python 3.10 or newer is needed (3.12 recommended): https://www.python.org/downloads/ or
`winget install Python.Python.3.12`. Arguments are passed on to the server, e.g. `.\start.ps1 --port 9000`.

Without the scripts: `python -m pip install -r requirements.txt`, then `python -m webapp`
(`--port`, `--workspace`, `--no-browser`, `--host`, `--token`). The exact versions the app was tested with are in
`requirements-lock.txt`.

## Use

1. **Projects → New project** (or **Try the demo**, which generates two small synthetic tibiae).
2. **Data**: choose the folder that holds the sections (e.g. `data/`, containing the Space Ranger outputs
   `SR007144_LL-2-1/` and `SR007144_RL-1-5/`, or the output folders of another instrument), **Detect samples**, pick
   the reference (control) section; the data check names each section's instrument and confirms its files, positions,
   images, microns per pixel and which signature genes are in the probe set. When every section comes from one
   instrument, quality-control thresholds suited to it are set. **Tissue and cell types** then detects the tissue
   from the expression data (see [Any tissue](#any-tissue-automatic-tissue-and-cell-type-detection)) and sets the
   signatures to its cell types.
3. **Explore** (or click the count of a section in the Data tab): read the raw data before running anything, with the
   settings as they are (saved or not). A table gives the bins (spots, cells), genes and UMIs of each section, the
   median UMIs, genes and mitochondrial share per bin and the bins that pass quality control, whose thresholds are set
   there; the maps show these per-bin numbers or any gene (on the H&E image of Space Ranger sections), in one, two or
   four linked panels; the gene list of a section is ranked by UMIs and searchable: click a gene to put it on the map,
   or its + to add it in its own color, so that several genes show at once (the map's "+ Add layer" button does the
   same).
4. **Signatures**: the defaults are the manuscript setup. Gene signatures (Table 1) can be edited, added, renamed or
   removed (see [Using it for other gene groups](#using-it-for-other-gene-groups)).
5. **Region of interest** (optional, sections with an H&E image): draw polygons on the H&E image of each section
   (D draw, Enter close, Esc cancel, Backspace remove a corner, Del remove the polygon, Ctrl+Z undo, Ctrl+S save) and
   switch on "Use the drawn region in the analysis".
6. **Run → Start analysis** runs the base run (Leiden domains and the AnnData file can be switched off). The run page
   shows each step, the live log, then the summary, the **Analysis** tab, the tables (sortable, searchable,
   downloadable; **Export** at the top downloads all results or the tables as one zip), a spatial viewer of every bin
   (tissue classes, calls, Leiden domains or any gene; one, two or four linked panels, layers of genes, calls and
   region, H&E underneath when there is one) and the exact configuration used.
7. **Analysis**: **New analysis** offers the tools, each with its own settings: expression of chosen genes by group
   (violin, box, dot plot, heatmap), differential expression between two groups (volcano plot; Wilcoxon or t test,
   Benjamini–Hochberg), composition of sections or groups (bars with Wilson intervals), genes co-expressed with a
   gene, two genes against each other, the score of a gene set, distances from one group to the nearest of another
   against random placement, neighborhood enrichment, spatially variable genes (Moran's I) and a chart from any table
   of the run. A group is any category of the per-bin table (section, condition, cell type, Leiden domain, positivity
   call) or a region drawn on the sections (**Regions**). Every result is a card kept with the run, with its chart
   (PNG, SVG) and table (CSV); **Templates** keeps the settings of a set of cards to make the same charts for another
   run.

Runs, projects and drawn regions are stored in `workspace/` (or `--workspace`, or the `BSS_WORKSPACE` variable).
Each run keeps a frozen copy of its configuration (with the instrument each section was read as), so it can be
reproduced with **Re-run**; its Analysis cards and regions are kept in its folder, templates in `workspace/templates/`.

## Instruments

`spatial_readers.py` reads every instrument into the same thing: the raw counts of every unit and its position in
micrometres. The run, the maps and the tools then work alike on all of them, and one project may mix instruments. A
sample's instrument is found from its files, or named by `"platform"` in its entry of the configuration.

| Instrument | Unit | Files read |
|---|---|---|
| 10x Visium HD (`visium_hd`) | bin of the analysis bin size | `square_XXXum/filtered_feature_bc_matrix.h5`, `spatial/` positions, scale factors and H&E image |
| 10x Visium (`visium`) | spot (55 µm) | `outs/filtered_feature_bc_matrix.h5`, `outs/spatial/tissue_positions.csv` (or `tissue_positions_list.csv`); µm per pixel from the spot diameter |
| 10x Xenium (`xenium`) | cell | `cell_feature_matrix.h5` (Gene Expression features only), `cells.parquet` or `cells.csv.gz` (centroids in µm) |
| Vizgen MERSCOPE (`merscope`) | cell | `cell_by_gene.csv` (Blank-* barcodes left out), `cell_metadata.csv` (centres in µm) |
| Bruker CosMx (`cosmx`) | cell | `*_exprMat_file.csv(.gz)` (negative probes, system controls and background cells left out), `*_metadata_file.csv(.gz)` (global pixels of 0.12028 µm) |
| STOmics Stereo-seq (`stereo_seq`) | bin of the analysis bin size (cell for a cell-bin file) | a `.gef` (square bins, else cell bins) or `.gem(.gz)` file; DNBs 500 nm apart |
| AnnData (`h5ad`) | spot | an `.h5ad` file: raw counts from `layers["counts"]`, `.raw` or `X`; positions from `obsm["spatial"]` |
| Tables (`table`) | spot | a 10x MEX folder (`matrix.mtx`, `barcodes.tsv`, `features.tsv`) or `counts.csv`, with `coordinates.csv` (id, x, y in µm) |

Positions that are not micrometres take the sample's µm / px. The transcript tables and morphology images of the
imaging platforms are not read. Imaging panels hold no mitochondrial genes, so their quality-control preset does not
filter on the mitochondrial share (`pipeline_config.QC_PRESETS`). The Loupe Browser export is for Visium HD sections.
`python -m tools.make_platform_data OUT_DIR` writes the demo sections in every layout, for trying them out.

On a remote server, keep the default `--host 127.0.0.1` and open an SSH tunnel
(`ssh -L 8765:127.0.0.1:8765 user@server`); with `--host 0.0.0.0` a token is required and printed with the URL.

## Using it for other gene groups

The defaults are the manuscript's: mouse bone and marrow signatures (Table 1) and a few steps built around osteoclasts
and osteoblasts in an A549 bone lesion. A run of the application is the base run, which works with any signatures:
quality control, Leiden domains, scores and positivity calls, depth matching, the region of interest, the tissue
assignment (Figure 3), the per-bin table, the summary and the maps (`pipeline_config.app_config` switches the other
steps off). The bone study's questions are tools of the Analysis tab, asked with your own signatures and groups: the
Figure 4h compartments are a differential expression between two groups, the Figure 4i distance is the distance tool,
the positivity and composition panels (Figures 3b, 4g, 6a) are the composition tool, the receptor panel and the
adipocyte genes (Figure 6b, Supplementary Figure S4) are expression by group, Supplementary Figure S5 is a heatmap of
expression by Leiden domain and Supplementary Figure S2 is the spatially variable genes. The command line (below) runs
every step and draws the manuscript's figures, configured by the same `config.json`; the points 2 and 3 below are about
it.

1. **Signatures** tab: delete the signatures you do not need and add your own (scored genes, core genes, competing
   signatures, and the switches *Positivity call* and *Tissue assignment*); replace the tissue classes. Deleting a
   signature removes it from every list; the dialog names the settings that still select it and where to change them.
2. The **configuration check** (top of the project page; it checks your unsaved settings as you edit them, while runs
   use the saved ones) lists every setting of the base run that still names a missing signature. For the command
   line, `python pipeline_config.py --check my_config.json` (or `bone_analysis.py --config`) reports the rest, each
   with the setting to change:
   * errors, the analysis cannot start: *Osteoclast compartments (Figure 4h)* (`compartments`) and *Distance to
     nearest partner (Figure 4i)* (`uncoupling`) need signatures with a positivity call; name yours, or switch the step
     off (`steps.compartments: false`).
   * warnings, the figure or table is skipped: empty signature lists of the Figure 3b composition bars and the
     positivity panels, the Figure 4a–f maps (`figures.*`); Figure 6b genes that are not in the host receptor panel;
     no proximity pairs (`proximity.pairs`); no section whose condition is a tumor condition
     (`compartments.tumor_conditions`); habitat classes of the Figure 4i sensitivity analysis that none of your
     signatures has; the A549 lesion genes still listed in a project without the osteoclast and osteoblast signatures.
3. Steps of the bone/A549 study (command line): host receptor panel (Figure 6b), adipocyte genes (Supplementary Figure
   S4), osteoclast compartments (Figure 4h), distance to the nearest partner (Figure 4i; osteoblast to osteoclast in
   the manuscript) and the three-gene-set sensitivity (off by default; it tests only the osteoclast and osteoblast gene
   sets). The receptor panel and the adipocyte genes take any gene list (Cell Settings tab); with a panel of your own,
   also choose the genes Figure 6b draws (`figures.receptor_genes`). Figure 4h calls its compartments growth plate and
   tumor-associated only for the manuscript's osteoclast bins split by the chondrocyte score; any other split is named
   after the split signature (*high-endothelium* and *low-endothelium*, say). In the sensitivity analyses, the Figure
   4h and 4i parts run only with their steps, and the A549 lesion flag counts the cross-captured human genes Krt7 and
   Krt18: empty that list (`sensitivity_analyses.lesion.genes: []`) in other studies, where they are ordinary
   epithelial genes (the run log says how many bins were flagged).
4. Gene names must match the probe set exactly. The defaults are mouse symbols (`Lyz2`, `Ptprc`); human data needs
   human symbols (`LYZ`, `PTPRC`), also in the ubiquitous transcripts of the Leiden screen (Cell Settings tab). The data
   check lists the missing genes of every signature, the receptor panel, the adipocyte genes, the ubiquitous
   transcripts and (with the sensitivity analyses on) the A549 lesion genes; a run warns when none of the ubiquitous
   transcripts is in the data. A positivity panel leaves out, and names in its caption, a signature with fewer than two
   of its genes in the data (it cannot be scored). Mitochondrial genes are those whose name starts with `mt-` in any
   case, so `MT-` works too. File names (e.g. `osteoclast_compartment_DE.csv`) stay those of the manuscript;
   figure titles and captions use your signature labels.

## Viewing results in Loupe Browser

**Export → Loupe Browser** (at the top of a finished run) downloads `<run>_loupe.zip`: the run's per-bin calls as
category files for 10x Genomics Loupe Browser, one CSV per section and bin size, and a README.txt that says which file
goes with which `.cloupe` file.

* `<section>_008um_categories.csv` is for the section's own Loupe file, `outs/cloupe_008um.cloupe`, which Space Ranger
  writes for every Visium HD run (at 8 µm only). Each 8 µm bin carries the calls of the 16 µm bin that holds it (row
  and column divided by 2, checked against the bin centres of the tissue positions files; on the manuscript data every
  8 µm centre lies inside its 16 µm bin), whatever its own depth: on the manuscript data 115,048 of the 223,186
  labelled 8 µm bins of LL-2-1 and 154,257 of the 373,080 of RL-1-5 would fail quality control on their own (257 and
  477 have no UMI). The last column, **8 um QC**, says *pass* or *fail* for each 8 µm bin by the run's quality-control
  thresholds: leave out the *fail* bins before comparing groups in Loupe Browser. The run's own projection onto 8 µm
  bins (step *Project labels onto the QC bin size*) keeps only the bins that pass.
* `<section>_016um_categories.csv` (the run's own bin size) fits a 16 µm `.cloupe` file, which exists only if Space
  Ranger 3.1 or later was run with `--custom-bin-size 16`.

In Loupe Browser 8 or later, open the section's `.cloupe` file, click the upload icon next to "+ Create a new group" in
the Clusters panel (older versions: Categories → action menu → Import Categories) and choose the CSV. Each column
becomes a group: tissue class, assigned signature, Leiden domain ("domain 0", ...), region of interest
(inside/outside) and one positivity call (positive/negative) per signature, plus any other yes/no or text call of the
run; numbers such as UMIs are left out. The columns follow the run's configuration, so a study with other signatures
exports the same way. Every bin of the `.cloupe` file has a label: bins the run did not analyse (removed by quality
control; in an 8 µm file, bins whose 16 µm bin was removed) are "not analyzed".

The files follow 10x Genomics' description of category CSVs, choosing the most compatible option where it is silent:
lower-case `barcode` header first, barcodes exactly as in `filtered_feature_bc_matrix.h5` (with `-1`), a label in every
cell (no empty cells), no commas or quotes inside labels, LF line endings, UTF-8 without BOM. They have not been tried
in Loupe Browser itself (no `.cloupe` file was available), and the menu names above may differ between versions.

## Online

The Geno Intelligence site serves this application at `/popcorn` (button "Popcorn Genetic" on its home page): its API
(`backend/`) mounts it with `create_app(workspace, hosted=Hosted(...))` (`backend/popcorn_mount.py`, which lists the
environment variables), and the Next.js site rewrites `/popcorn` to it. A hosted server is open to everyone, so:

* the data is uploaded instead of chosen on disk: the **Data** tab of a project has an **Upload data** card in place
  of the data root. Choose the output folder of a section (or a folder holding several); the browser uploads only the
  files the analysis reads, in chunks of 16 MB, to the project's upload folder `<workspace>/uploads/<project id>` (its
  data root), then offers the samples it finds there: for Visium HD `square_<size>/filtered_feature_bc_matrix.h5` and
  the positions, scale factors and H&E images of `square_<size>/spatial/`, for the analysis and quality-control bin
  sizes; for Visium the same files of `outs/`; for the other instruments their count and position files (never their
  transcript tables or images; the server refuses any other file, `webapp/server.py` `upload_parts`). A project may upload 3 GB, and the server keeps 4 GB of disk free; **Remove uploaded data** and deleting
  the project delete the files. Large sections may still need more memory than the site's server has (the small demo
  needs about 850 MB, the two SR007144 sections at 16 µm, 150,000 bins, about 3 GB): analyse those here, on your
  own computer. A run the system stops for lack of memory fails with "The analysis ran out of memory";
* data is read only from the uploads, the server's data folders (default `<workspace>/data`) and the synthetic demo;
  the folder browser, the data checks, the explorer and the runs refuse every other path;
* at most two analyses are queued or running at once (HTTP 429 beyond), each is stopped after 30 minutes and uses one
  thread per numerical library, and workers inherit none of the server's environment variables except the system
  ones (`webapp/jobs.py`, `CLEAN_ENV_VARS`);
* everybody signs in with Clerk (`create_app(..., auth=Auth(...))`, `webapp/auth.py`; the page loads Clerk's sign-in,
  `static/js/auth.js`). Everybody signed in sees every project, run and analysis, with the name of whoever made it,
  and can open, check and download it; only its owner changes it (saves, uploads, regions, runs, analyses, deleting:
  HTTP 403 for anybody else, and the pages show another user's work read-only, with **Make a copy of your own**).
  Projects made before sign-in have no owner and stay open to every signed-in user. `POPCORN_AUTH=0` turns sign-in
  off; the application on your own computer (`python -m webapp`) has none. A program that cannot sign in in a browser
  (Perspicax, which runs Popcorn's analyses as one of its tools) sends a key of its own as `X-Popcorn-Key` instead:
  `POPCORN_SERVICE_KEYS="Perspicax:<key>"` (`backend/popcorn_mount.py`, `webapp/auth.py` `ServiceKey`). It acts as the
  user "Perspicax", under the same rules as everybody: it sees everything and changes only what it made.

Analyses run in the API process's queue, so that API must run as a single process (`WORKERS=1`). The front end finds the
`/popcorn` prefix of its API from the address of `static/js/core.js`, and the server writes it into `index.html`.

## Command line

```
python bone_analysis.py --root data --out results/run1        # the manuscript analysis
python bone_figures.py --results results/run1                 # its figures
python pipeline_config.py > my_config.json                    # write the default configuration
python bone_analysis.py --config my_config.json --out results/run2
```

Old flags still work: `--skip-moran`, `--geneset-sensitivity`, `--project-8um`, `--roi-mask SAMPLE=PATH.geojson`.
The outputs and their columns are listed in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), section 3.

## Any tissue: automatic tissue and cell-type detection

The manuscript's signatures are bone cell types. For data of any other tissue the Data tab's **Tissue and cell types**
card (`cell_types.py`, `POST /api/projects/{id}/detect-tissue`) chooses signatures from the data, once the data check
has found the sections:

* **Library**: 75 cell types with canonical markers (PanglaoDB, CellMarker, Tabula Muris / Sapiens, Allen Brain):
  generic ones found in any tissue (endothelium, fibroblasts, pericytes, smooth muscle, macrophages, T, B, plasma,
  NK, dendritic and mast cells, neutrophils, erythroid, adipocytes, proliferating cells, epithelial / carcinoma,
  melanocyte / melanoma, skeletal muscle, peripheral nerve) and those of 18 tissues (brain and spinal cord, heart,
  lung, liver, kidney, intestine and colon, stomach, pancreas, lymph node and spleen, thymus, skin, breast, prostate,
  testis, ovary, skeletal muscle, fat, bone and marrow).
* **Species**: mouse and human gene names are both matched (`Actb` / `ACTB`; `Lyz2|LYZ` where the names differ), and
  the signatures are written with the names the data uses.
* **Cell types**: a cell type is present when its core markers are co-expressed: their mean pairwise correlation
  across bins (spots, cells) is at least 4 standard deviations and 0.03 above that of 40 random gene sets with the
  same detection rates.
* **Tissue**: each tissue scores the mean over its hallmark cell types (its parenchyma: neurons, astrocytes and
  oligodendrocytes for brain, hepatocytes for liver, ...) of present x abundance (the expression rank of the markers).
  Organs win over the tissues that accompany them in most sections (muscle, fat, lymphoid tissue); another tissue that
  scores at least half as much is used too (a bone section with its muscle, a tumor with its lymphoid aggregates).
* **Signatures**: the present cell types that are generic or belong to the tissues found, the tissue's own first. A
  bone dataset keeps the manuscript's signatures. With no tissue recognised, the generic cell types and those with
  strong evidence are used, and the Leiden domains (unsupervised) work as for any data.

A project whose signatures are the defaults (or still those a detection set) takes the detected ones automatically,
with Undo; edited signatures are kept and the detected ones offered. The detection was checked on 10x Visium sections
of mouse brain, mouse kidney, human heart, lymph node, cerebellum, glioblastoma, breast and colorectal cancer, and the
SR007144 tibiae (bone, with their muscle). The marker lists are a starting point: review them in the Cell Settings tab
for your question.

## Files

| Path | What |
|---|---|
| `cell_types.py` | the cell-type library, tissue and cell-type detection, the signatures of a detected tissue |
| `bone_analysis.py` | analysis pipeline (fixed; `[FIX]` / `[APP]` notes mark every change) |
| `bone_figures.py` | figures (fixed) |
| `bone_pending_masks.py` | hand-drawn region of interest (GeoJSON → per-bin mask) |
| `pipeline_config.py` | the configuration: defaults = manuscript setup, validation, parameter help, the base run of the application, QC presets per instrument |
| `spatial_readers.py` | readers of the other instruments' outputs (Visium, Xenium, MERSCOPE, CosMx, Stereo-seq, `.h5ad`, tables) |
| `webapp/` | the web application (FastAPI server, job runner, browser interface; `webapp/analysis.py`: the tools of the Analysis tab) |
| `tools/make_demo_data.py` | synthetic Visium HD data for the demo and the tests |
| `tools/make_platform_data.py` | the demo sections rewritten in the layout of every other instrument |
| `tests/` | `python -m pytest` (the slow end-to-end ones run the whole analysis on tiny data; `-m "not slow"` skips them) |

## Notes

* Reproducibility: runs are single-threaded by default (`deterministic`), so a rerun reproduces every number.
* `harmonypy` and `squidpy` are optional (PCA without Harmony; a built-in Moran's I with the same numbers).
* `pynndescent` must stay below 0.6 with scanpy 1.11 (pinned in `requirements.txt`): newer versions make scanpy's
  neighbour graph fail on data of 4,096 bins or more.
