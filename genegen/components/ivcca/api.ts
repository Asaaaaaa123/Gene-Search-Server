import { API_BASE_URL } from '@/lib/api-base';
import type {
  ClusterAssignments,
  CorrelationMethod,
  CorrelationStats,
  DataPreview,
  GeneSet,
} from './types';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
  get isSessionMissing() {
    return this.status === 404 && /analyzer not found/i.test(this.message);
  }
}

/** Strip the repeated "Error …: Error …:" prefixes the backend nests into details. */
function cleanDetail(detail: string): string {
  let msg = detail.trim();
  for (let i = 0; i < 3; i += 1) {
    const next = msg.replace(/^(Error[^:]{0,40}:\s*)(?=Error)/i, '');
    if (next === msg) break;
    msg = next;
  }
  return msg;
}

async function post<T>(path: string, form: FormData): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { method: 'POST', body: form });
  } catch {
    throw new ApiError(
      'Cannot reach the analysis server. Check that the backend is running (cd backend && python -m uvicorn server:app --port 8000).',
      0,
    );
  }

  const text = await response.text();
  if (!response.ok) {
    let message = text || `Request failed (${response.status})`;
    try {
      const parsed = JSON.parse(text);
      if (parsed?.detail) {
        message = Array.isArray(parsed.detail)
          ? parsed.detail.map((d: { msg?: string }) => d.msg ?? String(d)).join('; ')
          : String(parsed.detail);
      }
    } catch {
      /* plain-text error body */
    }
    throw new ApiError(cleanDetail(message), response.status);
  }

  const payload = JSON.parse(text);
  if (payload && payload.status === 'error') {
    throw new ApiError(cleanDetail(payload.message ?? 'Request failed'), 400);
  }
  return payload as T;
}

function form(fields: Record<string, string | Blob | Array<string | Blob> | undefined | null>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) value.forEach((v) => fd.append(key, v));
    else fd.append(key, value);
  }
  return fd;
}

/** The pathway endpoints take gene lists as uploaded .txt files. */
export function geneSetFile(set: Pick<GeneSet, 'name' | 'genes'>): File {
  const safe = set.name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'gene-set';
  return new File([set.genes.join('\n')], `${safe}.txt`, { type: 'text/plain' });
}

export type LoadDataResponse = {
  analyzer_id: string;
  n_samples: number;
  n_genes: number;
  preview?: DataPreview;
  message: string;
};

export type MatrixResponse = {
  genes: string[];
  n: number;
  matrix: string;
  sorted_order: number[];
  sorted_scores: number[];
  cluster_order: number[] | null;
};

export type SubsetResponse = {
  analyzer_id: string;
  parent_id: string;
  n_genes: number;
  matched_genes: string[];
  missing_genes: string[];
  matrix_size: [number, number];
  statistics: CorrelationStats;
};

export type LinkageResponse = {
  method: string;
  genes: string[];
  linkage: number[][];
  leaves: number[];
};

export type OptimalClustersResponse = {
  optimal_k_elbow: number;
  optimal_k_silhouette: number;
  inertias: number[];
  silhouette_scores: number[];
  k_range: number[];
};

export type PcaResponse = {
  scores: number[][];
  explained_variance: number[];
  cumulative_variance: number[];
  n_components: number;
  cluster_assignments?: ClusterAssignments;
};

export type TsneResponse = {
  scores: number[][];
  n_components: number;
  cluster_assignments?: ClusterAssignments;
};

export type SinglePathwayResponse = {
  pathway_size: number;
  sorted_genes: string[];
  sorted_scores: number[];
  mean_correlation: number;
};

export type GeneToGenesResponse = {
  single_gene: string;
  target_genes: string[];
  correlations: number[];
  avg_abs_correlation: number;
  n_targets: number;
};

export type GeneToPathwaysResponse = {
  single_gene: string;
  n_pathways: number;
  pathways: Array<{
    pathway_file: string;
    pathway_size: number;
    genes_found: number;
    avg_correlation: number;
    avg_abs_correlation: number;
  }>;
};

export type MultiPathwayRow = {
  pathway_file: string;
  total_genes_in_pathway: number;
  genes_found_in_set: number;
  pai: number;
  pci_a: number;
  pci_b: number | null;
  ceci: number | null;
  z_score: number | null;
};

export type MultiPathwayResponse = { n_pathways: number; pathways: MultiPathwayRow[] };

export type ComparePathwaysResponse = {
  cosine_similarity: number;
  pathway1_size: number;
  pathway2_size: number;
  intersection_size: number;
};

export const ivccaApi = {
  loadData: (file: File, filter?: File | null) =>
    post<LoadDataResponse>('/api/ivcca/load-data', form({ file, filter_genes: filter ?? undefined })),

  correlation: (id: string, method: CorrelationMethod) =>
    post<{ matrix_size: [number, number]; statistics: CorrelationStats }>(
      '/api/ivcca/calculate-correlation',
      form({ analyzer_id: id, method }),
    ),

  matrix: (id: string) => post<MatrixResponse>('/api/ivcca/matrix', form({ analyzer_id: id })),

  /** Extract a gene list's rows/columns from the correlation matrix into a new analyzer. */
  subset: (id: string, genes: string[]) =>
    post<SubsetResponse>('/api/ivcca/subset', form({ analyzer_id: id, genes: genes.join('\n') })),

  linkage: (id: string, method: string) =>
    post<LinkageResponse>('/api/ivcca/linkage', form({ analyzer_id: id, method })),

  optimalClusters: (id: string, maxK: number) =>
    post<OptimalClustersResponse>(
      '/api/ivcca/optimal-clusters',
      form({ analyzer_id: id, max_k: String(maxK) }),
    ),

  pca: (id: string, dims: 2 | 3, clusters: number | null) =>
    post<PcaResponse>(
      '/api/ivcca/pca',
      form({
        analyzer_id: id,
        n_components: String(dims),
        n_clusters: clusters && clusters > 1 ? String(clusters) : undefined,
      }),
    ),

  tsne: (id: string, dims: 2 | 3, perplexity: number, clusters: number | null) =>
    post<TsneResponse>(
      '/api/ivcca/tsne',
      form({
        analyzer_id: id,
        n_components: String(dims),
        perplexity: String(perplexity),
        n_clusters: clusters && clusters > 1 ? String(clusters) : undefined,
      }),
    ),

  singlePathway: (id: string, set: GeneSet) =>
    post<SinglePathwayResponse>(
      '/api/ivcca/single-pathway',
      form({ analyzer_id: id, pathway_file: geneSetFile(set) }),
    ),

  geneToGenes: (id: string, gene: string, targets: GeneSet) =>
    post<GeneToGenesResponse>(
      '/api/ivcca/gene-to-genes',
      form({ analyzer_id: id, single_gene: gene, target_genes_file: geneSetFile(targets) }),
    ),

  geneToPathways: (id: string, gene: string, sets: GeneSet[]) =>
    post<GeneToPathwaysResponse>(
      '/api/ivcca/gene-to-pathways',
      form({ analyzer_id: id, single_gene: gene, pathway_files: sets.map(geneSetFile) }),
    ),

  multiPathway: (id: string, sets: GeneSet[], minGenes: number, useSorted: boolean) =>
    post<MultiPathwayResponse>(
      '/api/ivcca/multi-pathway',
      form({
        analyzer_id: id,
        pathway_files: sets.map(geneSetFile),
        min_genes_threshold: String(minGenes),
        sorted_matrix: useSorted ? 'true' : 'false',
      }),
    ),

  comparePathways: (id: string, a: GeneSet, b: GeneSet) =>
    post<ComparePathwaysResponse>(
      '/api/ivcca/compare-pathways',
      form({ analyzer_id: id, pathway1_file: geneSetFile(a), pathway2_file: geneSetFile(b) }),
    ),
};
