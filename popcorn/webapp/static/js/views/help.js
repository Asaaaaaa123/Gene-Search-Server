// help.js — the Guide: how to use Popcorn and what the analysis terms mean, plus the project documents
// (CHANGES.md, docs/ARCHITECTURE.md, README.md from GET /api/docs/<name>) rendered by markdown.js, which never
// interprets HTML. Topics switch in place; the address bar follows.
import { h, api, mount, icon, card, loading, emptyState, errorPanel, setPathSilently, state } from '../core.js';
import { renderMarkdown } from '../components/markdown.js';

const TOPICS = [
  { id: 'guide', label: 'Guide', icon: 'help' },
  { id: 'changes', label: 'What was fixed', icon: 'check', doc: 'changes' },
  { id: 'architecture', label: 'Architecture', icon: 'layers', doc: 'architecture' },
  { id: 'readme', label: 'README', icon: 'file', doc: 'readme' },
];
const DOC_FILES = { 'readme.md': 'readme', 'changes.md': 'changes', 'architecture.md': 'architecture' };

/** Links between the project documents ("docs/ARCHITECTURE.md", "../README.md#usage") open the matching topic. */
function resolveLink(href) {
  const path = href.split(/[?#]/)[0].replace(/^(\.\.?\/)+/, '').toLowerCase();
  const name = path.split('/').pop();
  if (DOC_FILES[name] && (path === name || path === `docs/${name}`)) return `#/help/${DOC_FILES[name]}`;
  return undefined;
}

// ------------------------------------------------------------------------------------------------ the guide
const link = (href, text) => h('a', { href }, text);
const code = (text) => h('code', null, text);

const workflow = () => [
  {
    title: 'Create a project, or try the demo',
    body: [
      'A project holds one analysis setup: the sections, their quality-control thresholds, the gene signatures and an optional hand-drawn region of interest. Create one on the ', link('#/projects', 'Projects'),
      ' page. The demo offered there generates two small synthetic tibiae (about a minute, once) and a project with fast settings, so the whole workflow can be explored without real data.',
    ],
  },
  {
    title: 'Point it at your data',
    body: [
      'In the ', h('em', null, 'Data'), ' tab, choose the folder that holds the sections and detect the samples: the app finds, up to four levels down, the outputs of 10x Visium HD (',
      code('square_*um/filtered_feature_bc_matrix.h5'), ' in ', code('outs/binned_outputs'), '), 10x Visium (', code('outs/'),
      '), 10x Xenium, Vizgen MERSCOPE, Bruker CosMx, STOmics Stereo-seq (', code('.gef'), ', ', code('.gem'), '), AnnData files (', code('.h5ad'),
      ') and plain count tables, and says which instrument each one comes from (see Instruments below). Each detected section gets an id, a label, a condition (control or tumor, guessed from its folder name) and a color, and a control section becomes the reference section: every fold change and ratio is another section over it. Visium HD sections are analysed at the analysis bin size (16 µm by default), Stereo-seq chips are summed into bins of that size, and spots and cells are analysed as they are. When every section comes from one instrument, the quality-control thresholds are set for it (still changeable in the Explore tab).',
    ],
  },
  {
    title: 'Check the data',
    body: [
      'The ', h('em', null, 'Data check'), ' of the Data tab checks every section without running the analysis: its instrument and files, positions, scale factors and H&E image (Space Ranger outputs), the number of bins, spots or cells, and which genes of each signature are in the probe set (',
      h('em', null, 'Check again'), ' repeats it). The chip at the top right of a project (',
      h('em', null, 'Settings valid'), ', or the number of errors and warnings) opens the check of the settings, with ', h('em', null, 'Check the data again'), '. ',
      h('strong', null, 'Errors'), ' must be fixed before a run can start; ', h('strong', null, 'warnings'), ' point at things worth a look (a missing gene, an unusual parameter). Unsaved changes show a bar at the bottom of the page with ',
      h('em', null, 'Save'), ' and ', h('em', null, 'Discard'), ' (Ctrl+S saves).',
    ],
  },
  {
    title: 'Look at the raw data',
    body: [
      'The ', h('em', null, 'Explore'), ' tab reads every section as its instrument wrote it, with the current settings (saved or not) and before any run: a table of the bins (spots, cells), genes and UMIs of each section, the median UMIs, genes and mitochondrial share per bin, and how many bins pass the quality control, whose thresholds are set right there (', h('em', null, 'Defaults'),
      ' restores those of the instrument); maps of these per-bin numbers or of any gene (several are summed), in one, two or four linked panels, with the H&E image underneath for Space Ranger sections; and the genes of a section ranked by UMIs, where a click on a gene colors the map by it and the + at the end of its row adds it as a layer in its own color, so that several genes show on one map; + Add layer on the map also adds quality control (passes the thresholds or not) as a layer. In the Data tab, the count of a section opens it there.',
    ],
  },
  {
    title: 'Review the gene signatures',
    body: [
      'The ', h('em', null, 'Signatures'), ' tab edits the gene sets of Table 1: scored genes, core genes, competing signatures and excluded genes with their reasons, which signatures get a positivity call and which compete in the tissue assignment. The other settings of the run (normalization, Leiden domains, scoring and the null thresholds) keep the manuscript’s values; a ',
      code('config.json'), ' (Configuration tab of a run) can change them for the command line.',
    ],
  },
  {
    title: 'Optionally draw a region of interest',
    body: [
      'In the ', h('em', null, 'Region of interest'), ' tab, draw polygons (holes allowed) on the H&E image of a Space Ranger section, then turn on ', h('em', null, 'Use the drawn region in the analysis'),
      ' there. The drawn region is intersected with the transcriptional one; sections without a drawing are not restricted further. Sections without an H&E image (Xenium, MERSCOPE, CosMx, Stereo-seq, .h5ad files, tables) are not restricted; draw regions on their cells in a run’s Analysis tab instead (Regions), where every region is a group the tools can compare.',
    ],
  },
  {
    title: 'Run',
    body: [
      'The ', h('em', null, 'Run'), ' tab starts the base run that every dataset needs, with an optional label: loading and quality control, normalization, signature scores and positivity calls (native and depth-matched), the tissue assignment and the per-bin table; Leiden domains and the AnnData file are optional. The questions of a study are asked afterwards, with the tools of the run’s Analysis tab. One run goes at a time; others wait in the queue on the ',
      link('#/runs', 'Runs'), ' page. The Progress tab of a run shows every step, warnings and the live log, and a run can be cancelled at any time.',
    ],
  },
  {
    title: 'Explore the results',
    body: [
      h('em', null, 'Summary'), ': bins per section through quality control and the region of interest, and the key numbers with their confidence intervals. ',
      h('em', null, 'Analysis'), ': the analyses you choose, each a card with its own settings, chart and table, kept with the run. ', h('em', null, 'New analysis'),
      ' offers the tools: expression of chosen genes by group (violin, box, dot plot, heatmap), differential expression between two groups (volcano plot), composition of sections or groups, genes co-expressed with a gene, two genes against each other, the score of your own gene set, distances from one group to the nearest of another against random placement, neighborhood enrichment, spatially variable genes (Moran’s I), and a chart from any table of the run. A group is any category of the per-bin table (section, condition, cell type, Leiden domain, a positivity call) or a region drawn on the sections with ',
      h('em', null, 'Regions'), '. A card’s menu changes its settings, duplicates or renames it and downloads its chart (PNG, SVG) and table (CSV); ', h('em', null, 'Templates'),
      ' keeps the settings of a set of cards to make the same charts for another run. ',
      h('em', null, 'Tables'), ': every CSV output, searchable and sortable, plus the AnnData object for further work in Python. ',
      'The ', h('em', null, 'Export'), ' menu at the top of a run downloads all results or the tables as one zip file, or (Visium HD) ', h('em', null, 'Loupe Browser'),
      ': the per-bin calls as category files for 10x Genomics Loupe Browser — the ', code('_008um'),
      ' file of a section goes into its ', code('outs/cloupe_008um.cloupe'), ', and README.txt in the zip says how to import it. ',
      h('em', null, 'Spatial viewer'), ': every bin (spot, cell) at its position. The bins are gray, or colored by the genes typed in Color by genes, one gene per line (+ Add layer adds a line under the last, to type a gene in and Show it; × removes one). With one line the bins are shaded by its UMIs (up to their 99th percentile, marked ≥ in the legend, so that a few extreme bins do not flatten the map); with two or more lines every gene has its own color, shown next to its line, and a bin detecting several takes the color of its combination of genes: 1 + 2, 1 + 3, 2 + 3 and 1 + 2 + 3 each have one color of their own (the bins, the outline around the bins of the combination that touch, a cluster, and the legend entry) and their own shape (circle, triangle, diamond, star, then cross, hexagon and an upside-down triangle; shown once the map is zoomed in far enough, a plain square before). The colors of the genes and of the combinations are calculated to contrast: each is chosen as far as possible, as the eye sees color (CIELAB), from every other color on the map, the background and the gray bins included, so that no two look alike. Genes joined by + on one line (Ctsk + Acp5) are summed. Or, with Top gene, every bin in the color of its top gene: the gene with the most UMIs in the bin and the 8 bins around it (adding the neighbors makes ties rarer; a tie goes to the gene with the most UMIs in the section). The 18 genes that top the most bins have a color of their own and the others share one (Other genes). Or, with Color by cells (beside Color by genes, on the map of a run), by cell type: the gene signature the analysis assigned each bin to (Signatures, in the colors set there). One cell type per line, picked from the list of the section’s types with their bins (+ Add cell type adds a line); the picked types are drawn in their colors and every other bin in gray (Other cell types), and All cell types colors every type (ambiguous bins in light gray). With two or more cell types picked, their overlap stands out the same way: the bins called positive (positivity calls, native depth) for two or more of them are not drawn in a cell type color but in the color of their combination, each combination apart (1 + 2, 2 + 3, 1 + 2 + 3, ...) with its own color and shape, as for genes (colors calculated to contrast with the picked cell types and with each other), joined into clusters (bins side by side make one shape) with a bright outline around each; every combination is a legend entry with its bins and clusters, hidden or shown like any entry (cell types without a positivity call, such as skeletal_muscle, are not counted). Under Overlap in the legend, Correlated genes… next to a combination finds the genes whose expression follows its bins: every gene of the section is tested, the Pearson correlation r of its expression (log1p of its UMIs per 10,000 UMIs of the bin) with in the overlap (1) or not (0), with a t test and the Benjamini–Hochberg FDR. Genes pass with r of at least 0.1, an FDR of at most 0.05 and detection in at least 3 bins of the overlap: suggested thresholds, each in a box you can change (Find genes asks again; the panel keeps the last ones). The genes are listed by r with the share of the overlap bins and of the other bins detecting them; Show colors the map by one, Show top 3 as gene lines draws the first three together, and Copy list copies the table. Show on a cell line colors the map by the cell types, Show on a gene line by the genes again; the lines not drawn stay, with a note. The legend counts the bins of each type, and a click on a type hides or shows it. With the pointer over a bin, the tooltip shows its labels and numbers (tissue class, assigned signature, Leiden domain, UMIs per bin, ...) and every gene detected in it with its UMIs, most first (the first 150); a click on the bin lists all its genes, with a filter and Copy list. With no gene line, a click on “Every bin (gray)” in the legend hides the gray bins and leaves the layers alone. From one panel up to one per section (at most 6; Panels lists only as many as there are sections): 2 and 3 side by side, 4 in 2 × 2, 5 and 6 in 3 × 2. Each panel pans and zooms on its own; Pan and zoom → Linked moves them together. For panels colored by the same genes, one shared color scale (Color scales → Shared); the H&E image underneath.',
    ],
  },
  {
    title: 'Keep it reproducible',
    body: [
      'Each run freezes its own copy of the configuration (with the instrument each section was read as) and of the drawn regions, so editing the project later never changes a finished run; ', h('em', null, 'Re-run'),
      ' repeats it from that snapshot. Deterministic mode (on by default) runs the numerical libraries single-threaded with fixed seeds, so a rerun reproduces every number. The Summary records the package versions, and the Configuration tab downloads ',
      code('config.json'), ' (which also drives the command-line scripts described in the README) or turns it into a new project.',
    ],
  },
];

// the instruments whose outputs the application reads (spatial_readers.py)
const INSTRUMENTS = [
  ['10x Visium HD', 'Space Ranger’s binned outputs: square_XXXum/filtered_feature_bc_matrix.h5 with spatial/ (positions, scale factors, H&E image). Bins of the analysis bin size.'],
  ['10x Visium', 'Space Ranger’s outs/: filtered_feature_bc_matrix.h5 with spatial/ (tissue_positions.csv or tissue_positions_list.csv). Spots of 55 µm; the micrometres per pixel come from the spot diameter.'],
  ['10x Xenium', 'The output bundle: cell_feature_matrix.h5 (control probes and codewords left out) and cells.parquet (or cells.csv.gz), cell centroids in micrometres. The transcripts and morphology images are not read.'],
  ['Vizgen MERSCOPE', 'A region folder: cell_by_gene.csv (Blank-* barcodes left out) and cell_metadata.csv, cell centres in micrometres.'],
  ['Bruker CosMx', 'The flat files: *_exprMat_file.csv(.gz) and *_metadata_file.csv(.gz); negative probes, system controls and the background row of each field are left out; global pixels of 0.12028 µm.'],
  ['STOmics Stereo-seq', 'A .gef file (square bins, else cell bins) or a .gem table: the DNBs, 500 nm apart, are summed into square bins of the analysis bin size (cells for a cell-bin file).'],
  ['AnnData (.h5ad)', 'Raw counts from layers["counts"], .raw or X (when they are whole numbers), positions from obsm["spatial"] (micrometres unless the sample’s µm / px says otherwise).'],
  ['Tables', 'A folder with counts (a 10x matrix.mtx with barcodes.tsv and features.tsv, or counts.csv: one row per unit) and coordinates.csv (id, x, y in micrometres).'],
];

const instruments = () => [
  h('p', null, 'The Data tab finds these outputs and says which instrument each section comes from; a sample can also name it (', code('"platform"'),
    ' in config.json). Every reader gives the same thing: the raw counts of every unit and its position in micrometres, so the run, the maps and the tools work alike on all of them, and one project may mix instruments. When the positions are not micrometres, set the sample’s µm / px in the Data tab.'),
  h('dl', { class: 'help-glossary' }, INSTRUMENTS.map(([term, text]) => [h('dt', null, term), h('dd', null, text)])),
];

// using the app for tissues and signatures other than the bone lesion of the manuscript
const otherTissues = () => [
  h('p', null, 'The defaults are the manuscript’s: mouse bone and marrow signatures (Table 1) and a few steps built around osteoclasts and osteoblasts in an A549 bone lesion. The rest — quality control, Leiden domains, signature scores and positivity calls, depth matching, the region of interest, the tissue assignment and composition, Moran’s I, the per-bin table, the summary and the maps — works with any gene signatures.'),
  h('ol', null,
    h('li', null, h('strong', null, 'Signatures tab. '), 'Delete the signatures you do not need and add your own: scored genes, core genes (at least scoring.min_core of them must be detected for a positive call), competing signatures, and the switches ', h('em', null, 'Positivity call'), ' and ', h('em', null, 'Tissue assignment'), '. Replace the tissue classes, the host receptor panel and the adipocyte genes, or leave them. After a data check the gene chips show which genes are in the probe set.'),
    h('li', null, h('strong', null, 'Configuration check. '), 'Settings that still name a deleted signature are listed with the field to change. A run of the application is the base run only, so the steps built around the bone study (the Figure 4h compartments, the Figure 4i distance, the receptor panel, the sensitivity analyses and the manuscript figures) never block it: deleting the bone signatures leaves nothing to fix.'),
    h('li', null, h('strong', null, 'The bone study’s questions, with your signatures. '), 'They are tools of the Analysis tab: the Figure 4h compartments are a differential expression between two groups (for example the positive bins of a signature inside and outside a region), the Figure 4i distance is the distance tool, the positivity and composition panels (Figures 3b, 4g, 6a) are the composition tool, the receptor panel and the adipocyte genes (Figure 6b, Supplementary Figure S4) are expression by group of your genes, Supplementary Figure S5 is a heatmap of expression by Leiden domain, and Supplementary Figure S2 is the spatially variable genes. The command line (README) still draws the manuscript’s figures exactly.'),
    h('li', null, h('strong', null, 'Gene names. '), 'They must match the probe set exactly: the defaults are mouse symbols (', code('Lyz2'), ', ', code('Ptprc'), '), so human data needs human symbols (', code('LYZ'), ', ', code('PTPRC'), '), also in the ubiquitous transcripts of the Leiden screen (Signatures tab). Mitochondrial genes are recognised by the prefix ', code('mt-'), ' in any case, so ', code('MT-'), ' works too.'),
    h('li', null, h('strong', null, 'Imaging panels. '), 'Xenium, MERSCOPE and CosMx measure a panel of a few hundred to a few thousand genes: a signature needs its genes in the panel (the data check lists the missing ones), and panels hold no mitochondrial genes, so their quality control does not filter on the mitochondrial share.')),
];

const GLOSSARY = [
  ['Bin', 'Visium HD captures expression on a continuous grid of 2 × 2 µm squares; Space Ranger sums them into square bins of 8 and 16 µm (square_008um/, square_016um/). A bin is the unit of the analysis — a small patch of tissue that usually holds parts of several cells, not a cell. With other instruments the unit is a spot (Visium: 55 µm across, 100 µm apart), a segmented cell (Xenium, MERSCOPE, CosMx) or a square bin of a Stereo-seq chip; the analysis treats every unit alike, and the pages name it.'],
  ['UMI', 'Unique molecular identifier: every captured transcript is counted once, so the UMIs of a bin are the transcripts detected in it, its capture depth. A gene is detected in a bin when it has at least one UMI there.'],
  ['Quality control', 'A bin enters the analysis when it detects more than qc.min_genes genes, has more than qc.min_counts UMIs and has less than qc.max_pct_mt percent of its UMIs on mitochondrial genes (names starting with mt-). The Explore tab shows how many bins pass with the current thresholds before anything runs.'],
  ['Region of interest', 'The bins the section-level numbers are computed on. Its transcriptional part drops bins scoring above the 90th percentile for skeletal muscle, nerve or smooth muscle (tissue around the bone); a region drawn on the H&E image can be intersected with it. Positivity rates, fold changes and distances are computed inside it.'],
  ['Depth matching', 'Sections differ in capture depth (UMIs per bin), and a deeper section detects more of every signature. Depth matching downsamples the raw counts of every bin above the median UMIs per bin of the shallowest section to that median (in every section; bins below it are kept), several times, and reports the mean (± SD) over these replicates, so rates are compared at equal depth.'],
  ['Null threshold', 'For each signature, random gene sets of the same size are scored the same way on a sample of bins. The 95th percentile of those null scores is the threshold: a bin above it scores higher than 95% of random gene sets would.'],
  ['Positivity call', 'A bin is positive for a signature when its score exceeds the null threshold, at least two of the signature’s core genes are detected in it, and no competing signature scores higher. Rates are reported with Wilson 95% confidence intervals.'],
  ['Core genes', 'The lineage-restricted genes of a signature (Table 1). Requiring at least two of them to be detected (the two-gene rule) keeps a single shared or ambient transcript from producing a positive call.'],
  ['Competing signature', 'A signature that shares transcripts with another, for example the erythroid and granulocyte signatures for osteoclasts. A bin where a competitor scores higher is not called positive.'],
  ['Tissue assignment', 'Figure 3: the counts of each bin are pooled with its 8 nearest neighbors and every program signature is scored; the bin takes the highest-scoring signature that clears its null threshold with at least two core genes detected, otherwise it stays unassigned (“ambiguous”). Its tissue class is that signature’s class. Deterministic: no graph, seed or resolution parameter.'],
  ['Observed/null distance ratio', 'Figure 4i: the mean distance from each osteoblast-positive bin to the nearest osteoclast-positive bin inside the region of interest, divided by the same mean when the same numbers of positive bins are placed at random in that region. Below 1 the partners are closer than chance, above 1 farther; sections are compared by the ratio of these ratios, because raw distances depend on how many positive bins there are.'],
  ['Leiden domain', 'An unsupervised cluster of bins: Leiden community detection on a nearest-neighbor graph of the principal components (Harmony-integrated across sections). Domains summarize the tissue (Supplementary Figure S5); scores, calls and tests do not depend on them.'],
  ['Unresolved domain', 'A Leiden domain whose top markers are mostly transcripts abundant in every cell (Actb, Tmsb4x, Eef1a1, …) has no interpretable identity; such domains are merged into “unresolved”. Domains of fewer than 100 bins become “unassigned”. The label is defined without reference to the tumor, but it is not tumor-free: the mouse probes of conserved genes also capture the human A549 tumor RNA (Krt7, Krt18), and Tmsb10 and Itm2b track the lesion, so in the tumor-bearing section the unresolved domain is strongly enriched for it. Its share differs between sections (FigureS5_unresolved_bins.csv gives it per section).'],
];

const SHORTCUTS = [
  ['Rows, cards and menus', 'Click a project card, a run or a gene to open it (or show it on the map). Less frequent actions (Duplicate, Delete, Move up, Remove …) are in the ⋯ menu of the row or page, which appears when the pointer is over the row or the keyboard focus is in it; in a menu, ↑ and ↓ move, Enter picks, Esc closes.'],
  ['Analysis cards', 'New analysis opens a tool’s settings; a card’s ⋯ menu changes them (computed again in the card), duplicates, renames or deletes it, and downloads its chart (PNG, SVG) or table (CSV). A gene in a card’s table opens it on the map of the Spatial viewer.'],
  ['Tables', 'Click a column header to sort (again to reverse); the search box filters every column; Esc clears it.'],
  ['Maps (Spatial viewer, Explore)', 'Drag to pan, scroll or double-click to zoom (Shift + double-click zooms out); with a map focused, the arrow keys pan, + and − zoom and 0 fits the section (every panel’s section while the views are linked). Click a legend entry to hide or show it, Alt + click to show only that entry. In a gene line, ↑ and ↓ pick a suggestion and Enter shows it; an emptied line goes away. Color by genes takes one gene per line: one line shades the bins by its UMIs, two or more give every gene its own color (a bin detecting several takes the color of its combination of genes); Ctsk, Acp5 typed on one line become two lines, Ctsk + Acp5 stays one line (summed). + Add layer adds an empty line and puts the cursor in it.'],
  ['Log', 'The log follows new output until you scroll up; “Jump to latest” returns to the end.'],
];

function guideSection(id, title, ...content) {
  return h('section', { class: 'help-section' }, h('h2', { id: `guide-${id}` }, title), content);
}

function guide() {
  return h('article', { class: 'prose help-guide' },
    h('p', { class: 'help-lead' },
      'Popcorn reads spatial transcriptomics sections from most instruments (10x Visium HD and Visium, 10x Xenium, Vizgen MERSCOPE, Bruker CosMx, STOmics Stereo-seq, AnnData files and plain tables), runs a base analysis on them in the background (quality control, normalization, signature scores and positivity calls, tissue assignment), and then lets you make the analyses you want with the tools of a run’s Analysis tab. Its defaults are those of the manuscript’s Visium HD bone-lesion study.'),
    h('div', { class: 'row help-actions' },
      h('a', { class: 'btn primary', href: '#/projects' }, icon('folder', { size: 16 }), 'Go to projects'),
      h('a', { class: 'btn', href: '#/runs' }, icon('activity', { size: 16 }), 'See runs')),
    guideSection('workflow', 'Workflow',
      h('ol', { class: 'help-steps' }, workflow().map((s) => h('li', null, h('h3', null, s.title), h('p', null, s.body))))),
    guideSection('instruments', 'Instruments', instruments()),
    guideSection('other-tissues', 'Other tissues and gene signatures', otherTissues()),
    guideSection('glossary', 'Glossary',
      h('dl', { class: 'help-glossary' }, GLOSSARY.map(([term, text]) => [h('dt', null, term), h('dd', null, text)]))),
    guideSection('shortcuts', 'Mouse and keyboard',
      h('dl', { class: 'help-glossary' }, SHORTCUTS.map(([term, text]) => [h('dt', null, term), h('dd', null, text)]))),
    guideSection('storage', 'Where things are stored',
      h('p', null, 'Everything lives in the workspace folder (', code('workspace/'), ' next to the application unless it was started with ', code('--workspace'),
        '): ', code('projects/<id>/'), ' holds a project and its drawn regions; ', code('runs/<id>/'), ' holds a run: ', code('run.json'), ' (status and steps), ',
        code('config.json'), ' (the frozen configuration), ', code('rois/'), ', ', code('log.txt'), ', ', code('results/'), ' with the tables and ', code('summary.json'),
        ', ', code('analyses/'), ' with the cards of the Analysis tab and ', code('regions.json'), ' with the regions drawn there; ', code('templates/'),
        ' holds the templates of the Analysis tab. Deleting a project keeps its runs.')));
}

// ------------------------------------------------------------------------------------------------ view
export async function renderHelp(container, { topic }) {
  let destroyed = false;
  let token = 0;
  let ctrl = null;
  let current = TOPICS.some((t) => t.id === topic) ? topic : 'guide';
  if (topic && topic !== current) setPathSilently('/help');
  const docs = new Map();

  const nav = h('nav', { class: 'help-nav', 'aria-label': 'Help topics' });
  const toc = h('div', { class: 'help-toc' });
  const content = h('div', { class: 'help-content', 'aria-live': 'polite' });
  mount(container, h('div', { class: 'page help-page' },
    h('div', { class: 'page-header' }, h('div', { class: 'titles' }, h('h1', null, 'Help'),
      h('div', { class: 'subtitle' }, 'How to use Popcorn, what the analysis terms mean, and the project documents.'))),
    h('div', { class: 'help-layout' }, h('aside', { class: 'help-side' }, card({ flush: true, body: nav }), toc), content)));

  function paintNav() {
    // a document this installation does not have (GET /api/health: docs) is left out
    const docs = state.health && Array.isArray(state.health.docs) ? state.health.docs : null;
    mount(nav, TOPICS.filter((t) => !t.doc || !docs || docs.includes(t.doc)).map((t) => h('a', {
      class: t.id === current ? 'help-nav-item active' : 'help-nav-item', href: `#/help/${t.id}`,
      'aria-current': t.id === current ? 'page' : null,
      onClick: (e) => {
        if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return; // let the browser open a new tab
        e.preventDefault();
        select(t.id);
      },
    }, icon(t.icon, { size: 16 }), h('span', null, t.label))));
  }

  /** "On this page": the sections of the current topic. */
  function paintToc() {
    let heads = [...content.querySelectorAll('h2[id]')];
    if (heads.length < 2) heads = [...content.querySelectorAll('h2[id], h3[id]')];
    if (heads.length < 2) { mount(toc); return; }
    mount(toc, h('div', { class: 'help-toc-title' }, 'On this page'),
      h('ul', null, heads.map((el) => h('li', { class: el.tagName === 'H3' ? 'sub' : null }, h('a', {
        href: `#/help/${current}`,
        onClick: (e) => {
          e.preventDefault();
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        },
      }, el.textContent)))));
  }

  function select(id) {
    if (destroyed || id === current) return;
    setPathSilently(`/help/${id}`);
    show(id);
    window.scrollTo(0, 0);
  }

  async function show(id) {
    current = id;
    paintNav();
    const my = ++token;
    if (ctrl) ctrl.abort();
    ctrl = null;
    const t = TOPICS.find((x) => x.id === id);
    if (!t.doc) {
      mount(content, guide());
      paintToc();
      return;
    }
    let markdown = docs.get(t.doc);
    if (markdown === undefined) {
      mount(content, loading(`Loading ${t.label}…`));
      mount(toc);
      const c = new AbortController();
      ctrl = c;
      try {
        const res = await api(`/api/docs/${t.doc}`, { signal: c.signal });
        markdown = res && typeof res.markdown === 'string' ? res.markdown : '';
        docs.set(t.doc, markdown);
      } catch (err) {
        if (destroyed || my !== token || (err && err.name === 'AbortError')) return;
        mount(content, err.status === 404
          ? card({ body: emptyState({ icon: 'file', title: 'Document not found', text: `The ${t.label} document is not part of this installation.` }) })
          : errorPanel(err, { retry: () => show(id) }));
        return;
      } finally {
        if (ctrl === c) ctrl = null;
      }
      if (destroyed || my !== token) return;
    }
    mount(content, markdown.trim()
      ? h('article', { class: 'prose help-doc' }, renderMarkdown(markdown, { resolveLink, idPrefix: `doc-${t.id}-`, anchorHref: `#/help/${t.id}` }))
      : card({ body: emptyState({ icon: 'file', title: 'Empty document', text: `The ${t.label} document has no content yet.` }) }));
    paintToc();
  }

  // links from one document to another switch the topic in place
  content.addEventListener('click', (e) => {
    const a = e.target instanceof Element ? e.target.closest('a[href^="#/help/"]') : null;
    if (!a || e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    const id = a.getAttribute('href').slice('#/help/'.length);
    if (!TOPICS.some((t) => t.id === id)) return;
    e.preventDefault();
    select(id);
  });

  await show(current);

  return () => {
    destroyed = true;
    if (ctrl) ctrl.abort();
  };
}
