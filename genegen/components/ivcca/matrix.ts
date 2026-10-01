import type { MatrixResponse } from './api';
import type { ClusterAssignments, MatrixData } from './types';

/** Decode the backend's int16 (r × 10000, little-endian) base64 matrix. */
export function decodeMatrix(b64: string, n: number): Float32Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  const view = new DataView(bytes.buffer);
  const out = new Float32Array(n * n);
  for (let i = 0; i < n * n; i += 1) out[i] = view.getInt16(i * 2, true) / 10000;
  return out;
}

/** Plotly category axes collapse duplicate labels, so make every gene label unique. */
function uniqueLabels(genes: string[]): string[] {
  const seen = new Map<string, number>();
  return genes.map((g) => {
    const count = (seen.get(g) ?? 0) + 1;
    seen.set(g, count);
    return count === 1 ? g : `${g} (${count})`;
  });
}

export function buildMatrixData(payload: MatrixResponse): MatrixData {
  const n = payload.n;
  const genes = uniqueLabels(payload.genes);
  const rankOf = new Int32Array(n);
  const scoreOf = new Float32Array(n);
  payload.sorted_order.forEach((geneIdx, rank) => {
    rankOf[geneIdx] = rank;
    scoreOf[geneIdx] = payload.sorted_scores[rank];
  });
  const lookup = new Map<string, number>();
  payload.genes.forEach((g, i) => {
    const key = g.toLowerCase();
    if (!lookup.has(key)) lookup.set(key, i);
  });
  genes.forEach((g, i) => {
    const key = g.toLowerCase();
    if (!lookup.has(key)) lookup.set(key, i);
  });
  return {
    genes,
    n,
    values: decodeMatrix(payload.matrix, n),
    sortedOrder: payload.sorted_order,
    sortedScores: payload.sorted_scores,
    clusterOrder: payload.cluster_order,
    rankOf,
    scoreOf,
    lookup,
  };
}

export function corr(m: MatrixData, i: number, j: number) {
  return m.values[i * m.n + j];
}

export type HeatmapOrder = 'original' | 'sorted' | 'clustered';

export function orderFor(m: MatrixData, order: HeatmapOrder): number[] {
  if (order === 'sorted') return m.sortedOrder;
  if (order === 'clustered' && m.clusterOrder) return m.clusterOrder;
  return Array.from({ length: m.n }, (_, i) => i);
}

export type HeatmapGrid = {
  labels: string[];
  z: (number | null)[][];
  indices: number[];
};

/** Rows/columns follow `indices`; the upper triangle and weak cells are blanked on request. */
export function buildHeatmapGrid(
  m: MatrixData,
  indices: number[],
  opts: { abs: boolean; triangle: 'lower' | 'full'; minAbs: number },
): HeatmapGrid {
  const k = indices.length;
  const z: (number | null)[][] = new Array(k);
  for (let a = 0; a < k; a += 1) {
    const row: (number | null)[] = new Array(k);
    const base = indices[a] * m.n;
    for (let b = 0; b < k; b += 1) {
      if (opts.triangle === 'lower' && b > a) {
        row[b] = null;
        continue;
      }
      const v = m.values[base + indices[b]];
      if (opts.minAbs > 0 && a !== b && Math.abs(v) < opts.minAbs) {
        row[b] = null;
        continue;
      }
      row[b] = opts.abs ? Math.abs(v) : v;
    }
    z[a] = row;
  }
  return { labels: indices.map((i) => m.genes[i]), z, indices };
}

/** Robust colour range from off-diagonal values (2nd–98th percentile). */
export function autoRange(grid: HeatmapGrid, abs: boolean): [number, number] {
  const k = grid.indices.length;
  const sample: number[] = [];
  const step = Math.max(1, Math.floor((k * k) / 40000));
  let counter = 0;
  for (let a = 0; a < k; a += 1) {
    for (let b = 0; b < a; b += 1) {
      counter += 1;
      if (counter % step !== 0) continue;
      const v = grid.z[a][b];
      if (v !== null) sample.push(v);
    }
  }
  if (sample.length < 4) return abs ? [0, 1] : [-1, 1];
  sample.sort((x, y) => x - y);
  const q = (p: number) => sample[Math.min(sample.length - 1, Math.max(0, Math.round(p * (sample.length - 1))))];
  if (abs) {
    const lo = q(0.02);
    const hi = q(0.98);
    return hi - lo < 0.05 ? [Math.max(0, hi - 0.05), Math.min(1, hi + 0.001)] : [lo, hi];
  }
  const bound = Math.max(Math.abs(q(0.02)), Math.abs(q(0.98)), 0.05);
  return [-bound, bound];
}

/** All off-diagonal (upper-triangle) coefficients. */
export function upperTriangle(m: MatrixData): Float32Array {
  const out = new Float32Array((m.n * (m.n - 1)) / 2);
  let p = 0;
  for (let i = 0; i < m.n; i += 1) {
    for (let j = i + 1; j < m.n; j += 1) out[p++] = m.values[i * m.n + j];
  }
  return out;
}

export type DistributionSummary = {
  count: number;
  mean: number;
  median: number;
  std: number;
  min: number;
  max: number;
  q1: number;
  q3: number;
};

export function summarize(values: Float32Array): DistributionSummary {
  const sorted = Float32Array.from(values).sort();
  const count = sorted.length;
  if (count === 0) return { count: 0, mean: 0, median: 0, std: 0, min: 0, max: 0, q1: 0, q3: 0 };
  let sum = 0;
  for (let i = 0; i < count; i += 1) sum += sorted[i];
  const mean = sum / count;
  let sq = 0;
  for (let i = 0; i < count; i += 1) sq += (sorted[i] - mean) ** 2;
  const at = (p: number) => sorted[Math.min(count - 1, Math.floor(p * (count - 1)))];
  return {
    count,
    mean,
    median: at(0.5),
    std: Math.sqrt(sq / count),
    min: sorted[0],
    max: sorted[count - 1],
    q1: at(0.25),
    q3: at(0.75),
  };
}

export function histogram(values: Float32Array, bins: number, lo: number, hi: number) {
  const counts = new Array(bins).fill(0);
  const width = (hi - lo) / bins;
  for (let i = 0; i < values.length; i += 1) {
    let b = Math.floor((values[i] - lo) / width);
    if (b < 0) b = 0;
    if (b >= bins) b = bins - 1;
    counts[b] += 1;
  }
  const centers = counts.map((_, b) => lo + width * (b + 0.5));
  return { counts, centers, width };
}

export type Pair = { a: number; b: number; r: number };

/**
 * Strongest gene pairs. A coarse histogram pass finds the cut-off that yields at
 * least `limit` pairs, so only those are collected and sorted.
 */
export function topPairs(
  m: MatrixData,
  limit: number,
  sign: 'both' | 'positive' | 'negative',
  onlyGene: number | null = null,
): Pair[] {
  const score = (r: number) => (sign === 'both' ? Math.abs(r) : sign === 'positive' ? r : -r);
  const collect = (cut: number) => {
    const out: Pair[] = [];
    const visit = (i: number, j: number) => {
      const r = m.values[i * m.n + j];
      if (score(r) >= cut) out.push({ a: i, b: j, r });
    };
    if (onlyGene !== null) {
      for (let j = 0; j < m.n; j += 1) if (j !== onlyGene) visit(onlyGene, j);
    } else {
      for (let i = 0; i < m.n; i += 1) for (let j = i + 1; j < m.n; j += 1) visit(i, j);
    }
    return out;
  };

  const bins = 1000;
  const counts = new Int32Array(bins + 1);
  const bucket = (s: number) => Math.max(0, Math.min(bins, Math.floor(s * bins)));
  if (onlyGene !== null) {
    for (let j = 0; j < m.n; j += 1) if (j !== onlyGene) counts[bucket(score(m.values[onlyGene * m.n + j]))] += 1;
  } else {
    for (let i = 0; i < m.n; i += 1)
      for (let j = i + 1; j < m.n; j += 1) counts[bucket(score(m.values[i * m.n + j]))] += 1;
  }
  let acc = 0;
  let cutBin = 0;
  for (let b = bins; b >= 0; b -= 1) {
    acc += counts[b];
    if (acc >= limit) {
      cutBin = b;
      break;
    }
  }
  const cut = sign === 'both' ? cutBin / bins : Math.max(cutBin / bins, 1e-9);
  return collect(cut)
    .sort((x, y) => score(y.r) - score(x.r))
    .slice(0, limit);
}

export function thresholdCounts(values: Float32Array, thresholds: number[]) {
  return thresholds.map((t) => {
    let pos = 0;
    let neg = 0;
    for (let i = 0; i < values.length; i += 1) {
      if (values[i] >= t) pos += 1;
      else if (values[i] <= -t) neg += 1;
    }
    return { threshold: t, positive: pos, negative: neg, total: pos + neg };
  });
}

/** Strongest positive and negative partners of one gene. */
export function partners(m: MatrixData, gene: number, count: number) {
  const row: Pair[] = [];
  for (let j = 0; j < m.n; j += 1) if (j !== gene) row.push({ a: gene, b: j, r: m.values[gene * m.n + j] });
  const positive = [...row].sort((x, y) => y.r - x.r).filter((p) => p.r > 0).slice(0, count);
  const negative = [...row].sort((x, y) => x.r - y.r).filter((p) => p.r < 0).slice(0, count);
  return { positive, negative };
}

/** Match a gene list against the dataset (case-insensitive, de-duplicated). */
export function matchGenes(m: MatrixData | null, genes: string[]) {
  if (!m) return { matched: [] as number[], missing: [] as string[] };
  const matched: number[] = [];
  const missing: string[] = [];
  const seen = new Set<number>();
  for (const g of genes) {
    const idx = m.lookup.get(g.trim().toLowerCase());
    if (idx === undefined) missing.push(g);
    else if (!seen.has(idx)) {
      seen.add(idx);
      matched.push(idx);
    }
  }
  return { matched, missing };
}

/**
 * Rank pathway genes by connectivity inside the pathway: Σ|r| to the other members / n,
 * the same score as the backend's single-pathway analysis.
 */
export function pathwayRanking(m: MatrixData, idx: number[]) {
  const n = idx.length;
  const rows = idx.map((i) => {
    let sum = 0;
    for (const j of idx) if (j !== i) sum += Math.abs(m.values[i * m.n + j]);
    return { gene: i, score: n ? sum / n : 0 };
  });
  return rows.sort((a, b) => b.score - a.score);
}

/** Mean r and mean |r| over distinct pairs within one gene group. */
export function withinStats(m: MatrixData, idx: number[]) {
  let sum = 0;
  let sumAbs = 0;
  let count = 0;
  for (let a = 0; a < idx.length; a += 1) {
    for (let b = a + 1; b < idx.length; b += 1) {
      const r = m.values[idx[a] * m.n + idx[b]];
      sum += r;
      sumAbs += Math.abs(r);
      count += 1;
    }
  }
  return { mean: count ? sum / count : NaN, meanAbs: count ? sumAbs / count : NaN, pairs: count };
}

/** Correlation between two gene groups: every (a, b) pair with a ≠ b. */
export function crossStats(m: MatrixData, A: number[], B: number[]) {
  let sum = 0;
  let sumAbs = 0;
  let count = 0;
  const rowScore = new Map<number, number>();
  const colScore = new Map<number, number>();
  for (const a of A) {
    let rowAbs = 0;
    let rowCount = 0;
    for (const b of B) {
      if (a === b) continue;
      const r = m.values[a * m.n + b];
      sum += r;
      sumAbs += Math.abs(r);
      count += 1;
      rowAbs += Math.abs(r);
      rowCount += 1;
      colScore.set(b, (colScore.get(b) ?? 0) + Math.abs(r));
    }
    rowScore.set(a, rowCount ? rowAbs / rowCount : 0);
  }
  for (const b of B) {
    const others = A.filter((a) => a !== b).length;
    colScore.set(b, others ? (colScore.get(b) ?? 0) / others : 0);
  }
  return {
    mean: count ? sum / count : NaN,
    meanAbs: count ? sumAbs / count : NaN,
    pairs: count,
    /** A genes by mean |r| to B */
    aToB: [...rowScore.entries()].map(([gene, score]) => ({ gene, score })).sort((x, y) => y.score - x.score),
    /** B genes by mean |r| to A */
    bToA: [...colScore.entries()].map(([gene, score]) => ({ gene, score })).sort((x, y) => y.score - x.score),
  };
}

/** Rows × columns block of the matrix, for heatmaps of a pathway or of two groups against each other. */
export function blockGrid(m: MatrixData, rows: number[], cols: number[], lowerTriangle = false) {
  const z = rows.map((i, a) =>
    cols.map((j, b) => (lowerTriangle && b > a ? null : m.values[i * m.n + j])),
  );
  return { z, x: cols.map((j) => m.genes[j]), y: rows.map((i) => m.genes[i]) };
}

/** gene symbol → 1-based cluster id */
export function clusterLookup(assignments: ClusterAssignments | undefined | null) {
  const map = new Map<string, number>();
  if (!assignments) return map;
  for (const [cid, genes] of Object.entries(assignments)) {
    for (const g of genes) map.set(g, Number(cid));
  }
  return map;
}

export function parseGeneList(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    const g = raw.trim().replace(/^["']|["']$/g, '');
    if (!g) continue;
    const key = g.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(g);
  }
  return out;
}

export function toCsv(rows: Array<Array<string | number | null | undefined>>): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          if (cell === null || cell === undefined) return '';
          const s = typeof cell === 'number' ? (Number.isFinite(cell) ? String(cell) : '') : String(cell);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(','),
    )
    .join('\n');
}

export function downloadText(content: string, filename: string, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
