import type { ToolId } from './types';

export type ToolHelp = {
  title: string;
  summary: string;
  steps: string[];
  reading: string[];
  tips?: string[];
};

/** How each tool works and how to read it — shown in the help drawer and on the guide page. */
export const TOOL_HELP: Record<Exclude<ToolId, 'help'>, ToolHelp> = {
  data: {
    title: 'Dataset',
    summary: 'Load the expression matrix every IVCCA analysis starts from.',
    steps: [
      'Drop a CSV, TSV or Excel file on the upload area, or click it to browse.',
      'Rows are samples and columns are genes; the first column holds the sample IDs.',
      'Optional: add a gene filter (upload a .txt list or paste symbols) to analyse only those genes.',
      'Click “Load dataset” — or “Use example dataset” (7 samples × 236 endothelial genes) to try the tools.',
    ],
    reading: [
      'The tiles show samples, genes, missing values and whether a filter was applied.',
      'The preview pages through the genes 20 columns at a time.',
    ],
    tips: [
      'Correlations are computed between genes (columns) across samples (rows).',
      'With fewer than ~10 samples, coefficients are unstable and pile up near ±1 — prefer sorted/clustered views to absolute cut-offs.',
      '“Replace dataset” keeps the current session until the new file loads successfully.',
    ],
  },
  correlation: {
    title: 'Correlation matrix',
    summary: 'Correlate every gene with every other gene — the gene × gene matrix all other tools use.',
    steps: [
      'Choose a method: Pearson (linear), Spearman (rank-based, robust to outliers) or Kendall τ (rank concordance, good for few samples).',
      'Click “Compute correlation matrix”.',
      'To switch method later, pick another one and click “Recompute”. Results are cleared but tool settings are kept, and pathway matrices are re-extracted automatically.',
    ],
    reading: [
      'Mean and median r summarise all off-diagonal gene pairs; min and max are the most negative and most positive pairs.',
      'Inside a pathway matrix, the summary describes that sub-matrix.',
    ],
  },
  heatmap: {
    title: 'Heatmap',
    summary: 'The gene × gene correlation matrix as a square heatmap, with sorting, clustering and an inspector.',
    steps: [
      'Order — Original: file order. Sorted: descending mean |r| (the IVCCA “sorted heatmap”). Clustered: leaf order of Ward linkage on 1 − |r|.',
      'Values — r (signed) or |r| (strength only). Switching to Sorted/Clustered selects |r| until you choose yourself.',
      'Show the lower triangle or the full matrix; pick a palette; “Auto-contrast” stretches colours over the 2nd–98th percentile.',
      '“Genes shown” keeps the first N genes of the current order; “Hide |r| below” blanks weak cells.',
      '“Find gene” draws a crosshair on its row and column; “Side by side” compares the original order with the sorted or clustered one.',
    ],
    reading: [
      'Red is positive and blue is negative correlation; with |r|, darker means stronger.',
      'In Sorted order, the most connected genes collect in the top-left corner.',
      'In Clustered order, square blocks along the diagonal are co-expression modules.',
    ],
    tips: [
      'Drag to zoom, double-click to reset, click a cell to inspect that gene pair.',
      'The inspector lists every gene ranked by mean |r|, and each gene’s strongest positive and negative partners.',
      '“Save gene + top 25 partners as set” sends a neighbourhood to the gene set library.',
      'Export each figure as PNG (3×) or SVG; the Data menu exports the displayed matrix and the gene ranking as CSV.',
    ],
  },
  distribution: {
    title: 'Distribution & pairs',
    summary: 'How correlations are distributed, how many pairs pass each cut-off, and which pairs are strongest.',
    steps: [
      'Switch between r and |r|, adjust the number of bins, or use a log count axis to see the tails.',
      'Filter the strongest-pairs table by gene, by direction (positive / negative) and by length (100–1,000 pairs).',
    ],
    reading: [
      'Vertical lines mark the mean and median.',
      '“Pairs above threshold” shows how many pairs pass |r| ≥ 0.3 … 0.95 — useful for choosing a network threshold.',
    ],
    tips: ['Click a pair to open it in the heatmap inspector.', 'Every table exports to CSV.'],
  },
  dendrogram: {
    title: 'Dendrogram',
    summary: 'Hierarchical clustering of genes into a tree you can cut into modules.',
    steps: [
      'Click “Build dendrogram”, then choose a linkage: Ward (compact clusters), Average, Complete or Single.',
      'Move “Clusters (k)” to cut the tree; the dashed line marks the cut height.',
      'Choose “Fit to view” for an overview or “All labels” to read every gene name.',
    ],
    reading: [
      'Branch length is the linkage distance; genes joined low in the tree are closely correlated.',
      'The eight largest clusters are coloured; smaller ones are grey.',
    ],
    tips: ['Save one or all clusters as gene sets.', 'Export the tree as SVG/PNG and cluster membership as CSV.'],
  },
  'optimal-k': {
    title: 'Optimal clusters',
    summary: 'Find a good number of clusters (k) before running PCA, t-SNE or the dendrogram.',
    steps: [
      'Set the largest k to test and click “Evaluate k”.',
      'Use the “Apply a cluster count” buttons to send k to PCA, t-SNE or the dendrogram.',
    ],
    reading: [
      'Elbow curve: log of within-cluster spread; the elbow marks diminishing returns.',
      'Silhouette: how well separated the clusters are — higher is better. The silhouette optimum is usually the safest choice.',
    ],
  },
  pca: {
    title: 'PCA',
    summary: 'Genes as points in principal-component space, positioned by their correlation profiles.',
    steps: [
      'Choose 2D or 3D and optionally a number of k-means clusters (a suggested k appears after Optimal clusters).',
      'Click “Run PCA”. A badge appears when settings change, as a reminder to run again.',
      '“Find gene” rings and labels one gene.',
    ],
    reading: [
      'Genes that correlate with the same partners sit close together.',
      'Scree plot: bars are the variance each component explains; the line is the cumulative total.',
      'With more than three clusters, marker shapes are added so clusters stay distinguishable.',
    ],
    tips: [
      'Click legend entries to hide or isolate clusters.',
      'Save clusters as gene sets; export coordinates or memberships as CSV.',
    ],
  },
  tsne: {
    title: 't-SNE',
    summary: 'A non-linear 2D/3D map of genes that keeps close neighbours together.',
    steps: [
      'Choose 2D or 3D, a perplexity and optionally a number of clusters, then click “Run t-SNE”.',
      'Perplexity is roughly how many neighbours each gene considers; it is capped automatically for small matrices.',
    ],
    reading: [
      'Trust local neighbourhoods; distances between far-apart groups are not meaningful.',
    ],
    tips: ['Runs in seconds for hundreds of genes; thousands take longer.'],
  },
  'gene-sets': {
    title: 'Gene set library',
    summary: 'Pathways and gene lists used by the gene-set tools — stored in this browser.',
    steps: [
      'Upload one or more .txt files (one gene symbol per line) or paste a list.',
      'Clusters from PCA, t-SNE, the dendrogram, the heatmap and the network can also be saved here.',
      '“Open as matrix” turns a set into its own pathway matrix for every tool.',
    ],
    reading: ['The coverage bar shows how many of the set’s genes are in the current dataset.'],
    tips: ['Sets survive new sessions in this browser; download them to keep a copy.'],
  },
  pathway: {
    title: 'Single pathway',
    summary: 'Cut a gene list out of the full correlation matrix and analyse it on its own.',
    steps: [
      'Pick a set, or click “Paste” / “Upload” in the picker to add a list.',
      'Check the preview: genes found, coverage, missing genes and the N × N matrix.',
      'Click “Open N × N matrix in all tools” — the pathway matrix becomes the active scope.',
    ],
    reading: [
      'Genes are ranked by mean |r| to the other pathway genes (connectivity within the pathway).',
      'Switch the matrix between list order and ranked order.',
    ],
    tips: ['Genes are matched to the original dataset case-insensitively; duplicates are ignored.'],
  },
  'gene-genes': {
    title: 'Gene → genes',
    summary: 'One gene’s correlation with every other gene in the original dataset.',
    steps: [
      'Pick a gene. Optionally restrict the comparison to a gene set, or show only positive or negative partners.',
      'Build a matrix of the gene plus its top N partners to explore that neighbourhood.',
    ],
    reading: [
      'Bars show the strongest partners (red positive, blue negative); the histogram shows how the gene correlates with everything.',
    ],
  },
  'gene-pathways': {
    title: 'Gene → pathways',
    summary: 'How strongly one gene is coupled to each of several pathways.',
    steps: [
      'Pick a gene and one or more pathways.',
      'Click a pathway in the table to see the gene’s r with each of its genes.',
      'Open the pathway as a matrix — with or without the gene added.',
    ],
    reading: [
      'Mean |r| measures coupling strength; mean r shows its direction.',
      'If the gene belongs to a pathway, it is excluded from that pathway’s average.',
    ],
  },
  ceci: {
    title: 'Multi-pathway CECI',
    summary: 'Rank pathways by how completely and coherently they are represented in the correlation structure.',
    steps: [
      'Select pathways and a minimum number of genes found; pathways with fewer are skipped.',
      'Optionally use PCI-B (scores from the sorted matrix) instead of PCI-A.',
      'Click “Compute CECI”.',
    ],
    reading: [
      'CECI = PAI × PCI × 100: coverage of the pathway times its internal correlation.',
      'The z-score uses the IVCCA reference distribution; z ≥ 1.96 is highlighted.',
    ],
  },
  compare: {
    title: 'Pathway ↔ pathway',
    summary: 'Compare two gene groups: overlap, similarity, linking genes — and open them as matrices.',
    steps: [
      'Pick pathway A and pathway B; results appear immediately.',
      'Switch the Venn diagram between listed genes and genes found in the dataset.',
      'Open A ∪ B, A ∩ B, A or B as a matrix to run every tool on it.',
    ],
    reading: [
      'The verdict says whether the sets are disjoint, partially overlapping, one inside the other, or identical.',
      'Mean |r| between A and B is compared with the mean within each set; a ratio near 1 means they co-vary as one group.',
      'Cosine similarity compares the two pathways’ mean-|r| profiles (IVCCA definition).',
      'In the cross-correlation heatmap, genes are sorted by similarity to the other pathway, so linking genes sit top-left.',
    ],
  },
  network: {
    title: 'Correlation network',
    summary: 'Genes as nodes, linked when their correlation passes a threshold.',
    steps: [
      'Use the whole dataset or one gene set. The threshold starts on Auto (about three links per gene); drag to set your own.',
      'Choose direction (positive / negative / both), 2D or 3D, and colour by module or by degree.',
      '2D: drag nodes, scroll to zoom, click a gene to highlight its neighbourhood. 3D: click a gene and the camera flies to its own network; “Show whole network” flies back.',
    ],
    reading: [
      'Dot size: how many genes it is correlated with (dot area grows with the count).',
      'Line width: correlation strength |r|. Red is positive, blue negative.',
      'Modules are connected components; the hub table ranks genes by degree, then strength (sum of |r|).',
    ],
    tips: [
      'Above 6,000 links (2D) or 20,000 (3D) only the first are drawn — raise the threshold for a readable network.',
      'Export the 2D image (PNG 3×), the edge list and the node table; save module 1 as a gene set.',
    ],
  },
};

export const QUICK_START: Array<{ tool: ToolId; title: string; text: string }> = [
  { tool: 'data', title: 'Load data', text: 'Samples in rows, genes in columns — or use the example dataset.' },
  { tool: 'correlation', title: 'Correlate', text: 'Pick Pearson, Spearman or Kendall and compute the gene × gene matrix.' },
  { tool: 'heatmap', title: 'Explore', text: 'Sorted and clustered heatmaps, distributions and the strongest pairs.' },
  { tool: 'optimal-k', title: 'Find structure', text: 'Choose k, then PCA, t-SNE and the dendrogram.' },
  { tool: 'pathway', title: 'Focus on pathways', text: 'Cut gene lists into their own matrices; compare genes and pathways.' },
  { tool: 'network', title: 'See the network', text: 'Hubs, modules and the links between them.' },
];

export const SCOPE_HELP = {
  title: 'Pathway matrices (analysis scopes)',
  points: [
    'A pathway matrix holds the rows and columns of your gene list, cut from the full correlation matrix — the values are identical.',
    'The “Analysing” list at the top of the sidebar switches between the full dataset and every pathway matrix.',
    'Heatmap, distribution, dendrogram, optimal clusters, PCA, t-SNE and network run on the active matrix; each matrix keeps its own results.',
    'Gene-set tools (single pathway, gene → genes, gene → pathways, CECI, pathway ↔ pathway) always read the full dataset.',
    'A purple banner shows when a pathway matrix is active; “Back to full dataset” returns.',
  ],
};

export const GLOSSARY: Array<{ term: string; definition: string }> = [
  { term: 'r (correlation coefficient)', definition: 'From −1 to 1: how two genes move together across samples. Positive: up together; negative: one up as the other goes down.' },
  { term: '|r|', definition: 'Correlation strength regardless of direction.' },
  { term: 'Mean |r|', definition: 'A gene’s average |r| with all other genes — its connectivity. Used to sort the heatmap and rank genes.' },
  { term: 'Pearson', definition: 'Linear correlation of the raw values; sensitive to outliers.' },
  { term: 'Spearman', definition: 'Pearson correlation of ranks; captures monotonic trends and resists outliers.' },
  { term: 'Kendall τ', definition: 'Rank concordance between gene pairs; conservative and well-behaved with few samples.' },
  { term: 'Ward linkage', definition: 'Hierarchical clustering that merges the clusters adding the least within-cluster variance.' },
  { term: 'Silhouette', definition: 'How much closer genes are to their own cluster than to the next one (−1 to 1; higher is better).' },
  { term: 'Inertia', definition: 'Within-cluster sum of squared distances in k-means; always falls as k grows.' },
  { term: 'Principal component', definition: 'A direction of greatest variation among gene correlation profiles; PC1 explains the most.' },
  { term: 'Perplexity', definition: 't-SNE setting — roughly the number of neighbours each point considers.' },
  { term: 'Degree', definition: 'In the network, the number of genes a gene is linked to above the threshold.' },
  { term: 'Module', definition: 'A connected component of the network: genes linked to each other directly or through other genes.' },
  { term: 'Hub', definition: 'A highly connected gene (high degree).' },
  { term: 'PAI', definition: 'Pathway Activation Index: the fraction of a pathway’s genes found in the dataset.' },
  { term: 'PCI-A / PCI-B', definition: 'Pathway Correlation Index: mean |r| among pathway genes (A), or their scores from the sorted matrix (B).' },
  { term: 'CECI', definition: 'Correlation–Expression Composite Index = PAI × PCI × 100.' },
  { term: 'z-score (CECI)', definition: '(CECI − 7.908) / 2.0605, the IVCCA reference; z ≥ 1.96 stands out.' },
  { term: 'Cosine similarity', definition: 'Similarity of two pathways’ mean-|r| profiles (1 = identical shape).' },
  { term: 'Jaccard index', definition: 'Shared genes divided by all genes in either set.' },
  { term: 'Pathway matrix', definition: 'The rows and columns of a gene list cut from the full correlation matrix.' },
];

export const FAQ: Array<{ q: string; a: string }> = [
  {
    q: '“The analysis server no longer has this session”',
    a: 'The backend restarted and lost its in-memory analyses. Click “Restore session” (available while the page still holds your file) or load the dataset again. Gene sets are not affected.',
  },
  {
    q: '“Cannot reach the analysis server”',
    a: 'The Python backend is not running. Start it from the backend folder: python -m uvicorn server:app --port 8000.',
  },
  {
    q: 'The heatmap shows only some of my genes',
    a: 'Large matrices start with the first 600 genes of the current order. Drag “Genes shown” to the right to display all of them.',
  },
  {
    q: 'Almost every correlation is close to ±1',
    a: 'This happens with very few samples. Use the Sorted or Clustered heatmap with Auto-contrast, and rank-based thresholds rather than absolute ones.',
  },
  {
    q: 'The network is a tangle (or empty)',
    a: 'Raise the threshold for fewer links or lower it for more; “Auto” targets about three links per gene. Restricting to a gene set also helps.',
  },
  {
    q: 'Does refreshing the page lose my work?',
    a: 'No — the session and pathway matrices reattach to the backend after a refresh (as long as it kept running). Tool results are recomputed on demand.',
  },
  {
    q: 'Where are my gene sets stored?',
    a: 'In this browser. They survive new sessions but not clearing site data or switching browsers — download any set you want to keep.',
  },
  {
    q: 'How do I get figures for a paper?',
    a: 'Every chart has an Export menu: PNG at 3× resolution or SVG vector. Tables export to CSV.',
  },
];

export const SHORTCUTS: Array<{ keys: string; action: string }> = [
  { keys: '?', action: 'Open help for the current tool' },
  { keys: 'Esc', action: 'Close help, menus and the activity log' },
  { keys: 'Drag', action: 'Zoom into a 2D chart (rotate in 3D)' },
  { keys: 'Double-click', action: 'Reset a 2D chart’s zoom' },
  { keys: 'Click a cell / dot', action: 'Inspect a gene pair (heatmap) or focus a gene (network)' },
];
