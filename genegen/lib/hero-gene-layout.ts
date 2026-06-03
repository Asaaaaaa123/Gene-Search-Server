export type GeneParticle = {
  x: number;
  y: number;
  z: number;
  size: number;
  symbol: string;
};

/** Normalize IVCCA PCA scores to fit the hero canvas. */
export function layoutFromIvccaScores(
  geneNames: string[],
  scores: number[][]
): GeneParticle[] {
  const n = Math.min(geneNames.length, scores.length);
  if (n === 0) return [];

  const coords: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const row = scores[i];
    coords.push([row[0] ?? 0, row[1] ?? 0, row[2] ?? 0]);
  }

  let maxAbs = 0;
  for (const [x, y, z] of coords) {
    maxAbs = Math.max(maxAbs, Math.abs(x), Math.abs(y), Math.abs(z));
  }
  const scale = maxAbs > 0 ? 1.15 / maxAbs : 1;

  return geneNames.slice(0, n).map((symbol, i) => {
    const [x, y, z] = coords[i];
    return {
      symbol,
      x: x * scale,
      y: y * scale,
      z: z * scale,
      size: 0.55 + (symbol.length % 4) * 0.1,
    };
  });
}

/** k-nearest-neighbor edges in 3D PCA space. */
export function buildGeneEdges(particles: GeneParticle[], maxNeighbors: number): [number, number][] {
  const edges: [number, number][] = [];
  const seen = new Set<string>();
  const n = particles.length;

  for (let i = 0; i < n; i++) {
    const a = particles[i];
    const neighbors: { j: number; d2: number }[] = [];

    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const b = particles[j];
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const dz = a.z - b.z;
      neighbors.push({ j, d2: dx * dx + dy * dy + dz * dz });
    }

    neighbors.sort((u, v) => u.d2 - v.d2);
    for (let k = 0; k < Math.min(maxNeighbors, neighbors.length); k++) {
      const j = neighbors[k].j;
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push([i, j]);
    }
  }

  return edges;
}
