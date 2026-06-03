import { API_BASE_URL } from '@/lib/api-base';
import { buildGeneEdges, layoutFromIvccaScores, type GeneParticle } from '@/lib/hero-gene-layout';

export type HeroIvccaCluster = {
  particles: GeneParticle[];
  edges: [number, number][];
  nGenes: number;
  nSamples?: number;
};

type HeroClusterResponse = {
  status: string;
  gene_names?: string[];
  scores?: number[][];
  n_genes?: number;
  n_samples?: number;
  detail?: string;
  message?: string;
};

/**
 * Run the same IVCCA pipeline as the IVCCA tool page:
 * load expression → Pearson correlation → PCA (3 components) on |correlation matrix|.
 */
export async function fetchHeroClusterViaIvcca(): Promise<HeroIvccaCluster> {
  const res = await fetch(`${API_BASE_URL}/api/ivcca/hero-cluster`, {
    method: 'GET',
    signal: AbortSignal.timeout(120000),
  });

  const payload: HeroClusterResponse = await res.json().catch(() => ({}));

  if (!res.ok) {
    const msg =
      payload.detail ||
      payload.message ||
      `IVCCA hero cluster failed (${res.status})`;
    throw new Error(String(msg));
  }

  if (payload.status !== 'success' || !payload.gene_names?.length || !payload.scores?.length) {
    throw new Error(payload.message || 'Invalid IVCCA hero cluster response');
  }

  const particles = layoutFromIvccaScores(payload.gene_names, payload.scores);
  const edges = buildGeneEdges(particles, 3);

  return {
    particles,
    edges,
    nGenes: payload.n_genes ?? particles.length,
    nSamples: payload.n_samples,
  };
}
