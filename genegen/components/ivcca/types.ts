export type CorrelationMethod = 'pearson' | 'spearman' | 'kendall';

export type DataPreview = {
  columns: string[];
  rows: Array<Array<string | number | null>>;
};

export type DatasetInfo = {
  fileName: string;
  fileSize: number;
  nSamples: number;
  nGenes: number;
  preview: DataPreview | null;
  missing: number;
  filter: { name: string; requested: number } | null;
  loadedAt: number;
};

export type CorrelationStats = {
  mean: number;
  std: number;
  min: number;
  max: number;
  median: number;
};

export type CorrelationInfo = {
  method: CorrelationMethod;
  size: [number, number];
  stats: CorrelationStats;
  computedAt: number;
};

/** Decoded correlation matrix held client-side for heatmaps, distributions and networks. */
export type MatrixData = {
  genes: string[];
  n: number;
  /** Row-major n × n Pearson/Spearman/Kendall coefficients. */
  values: Float32Array;
  /** Gene indices ordered by mean |r| (descending) — identical to the backend sort. */
  sortedOrder: number[];
  sortedScores: number[];
  /** Leaf order of the ward linkage, or null when the backend skipped it. */
  clusterOrder: number[] | null;
  /** gene index → rank (0-based) in sortedOrder */
  rankOf: Int32Array;
  /** gene index → mean |r| */
  scoreOf: Float32Array;
  /** lower-cased gene symbol → gene index */
  lookup: Map<string, number>;
};

/**
 * What the analysis tools operate on: the full dataset matrix, or a pathway
 * sub-matrix extracted from it (its own backend analyzer, so every tool works on it).
 */
export type AnalysisScope = {
  /** 'root' for the full dataset */
  id: string;
  kind: 'dataset' | 'pathway';
  label: string;
  analyzerId: string;
  nGenes: number;
  /** pathway scopes: the gene list as given, and the symbols that were not in the dataset */
  requested?: string[];
  missing?: string[];
  sourceSetId?: string;
  correlation: CorrelationInfo | null;
  matrix: MatrixData | null;
  matrixStatus: 'idle' | 'loading' | 'ready' | 'error';
  createdAt: number;
};

export type GeneSet = {
  id: string;
  name: string;
  genes: string[];
  source: 'upload' | 'paste' | 'cluster' | 'selection';
  createdAt: number;
};

export type ActivityEntry = {
  id: string;
  key: string;
  label: string;
  status: 'running' | 'done' | 'error';
  startedAt: number;
  endedAt?: number;
  message?: string;
};

export type ToolId =
  | 'data'
  | 'correlation'
  | 'heatmap'
  | 'distribution'
  | 'dendrogram'
  | 'optimal-k'
  | 'pca'
  | 'tsne'
  | 'gene-sets'
  | 'pathway'
  | 'gene-genes'
  | 'gene-pathways'
  | 'ceci'
  | 'compare'
  | 'network';

/** Gene → cluster id (1-based), derived from backend cluster assignments. */
export type ClusterAssignments = Record<string, string[]>;
