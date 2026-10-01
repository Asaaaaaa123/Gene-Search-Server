import type { MatrixData } from './types';

export type Edge = { s: number; t: number; r: number };

export type Graph = {
  /** gene indices of nodes with at least one edge (or all, when isolates are kept) */
  nodes: number[];
  edges: Edge[];
  degree: Map<number, number>;
  strength: Map<number, number>;
  /** gene index → component id (1 = largest) */
  component: Map<number, number>;
  componentSizes: number[];
  truncated: boolean;
};

export function buildGraph(
  m: MatrixData,
  scope: number[],
  threshold: number,
  sign: 'both' | 'positive' | 'negative',
  keepIsolates: boolean,
  maxEdges: number,
): Graph {
  const edges: Edge[] = [];
  let truncated = false;
  outer: for (let a = 0; a < scope.length; a += 1) {
    const i = scope[a];
    for (let b = a + 1; b < scope.length; b += 1) {
      const j = scope[b];
      const r = m.values[i * m.n + j];
      const pass = sign === 'both' ? Math.abs(r) >= threshold : sign === 'positive' ? r >= threshold : r <= -threshold;
      if (!pass) continue;
      if (edges.length >= maxEdges) {
        truncated = true;
        break outer;
      }
      edges.push({ s: i, t: j, r });
    }
  }

  const degree = new Map<number, number>();
  const strength = new Map<number, number>();
  for (const e of edges) {
    degree.set(e.s, (degree.get(e.s) ?? 0) + 1);
    degree.set(e.t, (degree.get(e.t) ?? 0) + 1);
    strength.set(e.s, (strength.get(e.s) ?? 0) + Math.abs(e.r));
    strength.set(e.t, (strength.get(e.t) ?? 0) + Math.abs(e.r));
  }
  const nodes = keepIsolates ? [...scope] : scope.filter((g) => degree.has(g));

  // Connected components (union-find), numbered by size.
  const parent = new Map<number, number>(nodes.map((g) => [g, g]));
  const find = (x: number): number => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cur = x;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  for (const e of edges) {
    const a = find(e.s);
    const b = find(e.t);
    if (a !== b) parent.set(a, b);
  }
  const groups = new Map<number, number[]>();
  for (const g of nodes) {
    const root = find(g);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(g);
  }
  const ordered = [...groups.values()].sort((x, y) => y.length - x.length);
  const component = new Map<number, number>();
  ordered.forEach((members, idx) => members.forEach((g) => component.set(g, idx + 1)));

  return { nodes, edges, degree, strength, component, componentSizes: ordered.map((g) => g.length), truncated };
}

/**
 * Visual encodings shared by the 2D view, the 3D view and the legend:
 *  - node size ↔ degree (how many genes a gene is correlated with). The square root makes
 *    dot *area* proportional to degree, so a gene with 4× the partners looks 4× as big.
 *  - edge width ↔ |r|, stretched over the |r| range actually drawn, so differences stay
 *    visible even when every edge is above a high threshold.
 */
export function networkEncoding(graph: Graph) {
  let dMin = Infinity;
  let dMax = -Infinity;
  for (const g of graph.nodes) {
    const d = graph.degree.get(g) ?? 0;
    if (d < dMin) dMin = d;
    if (d > dMax) dMax = d;
  }
  if (!Number.isFinite(dMin)) [dMin, dMax] = [0, 1];
  let rMin = Infinity;
  let rMax = -Infinity;
  for (const e of graph.edges) {
    const a = Math.abs(e.r);
    if (a < rMin) rMin = a;
    if (a > rMax) rMax = a;
  }
  if (!Number.isFinite(rMin)) [rMin, rMax] = [0, 1];
  const unit = (v: number, lo: number, hi: number) => (hi > lo ? Math.min(1, Math.max(0, (v - lo) / (hi - lo))) : 0.5);
  return {
    degreeRange: [dMin, dMax] as const,
    rRange: [rMin, rMax] as const,
    /** 0…1 size position for a degree value */
    sizeT: (degree: number) => Math.sqrt(unit(degree, dMin, dMax)),
    /** 0…1 width position for an |r| value */
    widthT: (absR: number) => unit(absR, rMin, rMax),
  };
}

export type NetworkEncoding = ReturnType<typeof networkEncoding>;

/** Pixel scales for each renderer. */
export const NODE_PX = { '2d': [9, 52], '3d': [4, 22] } as const;
export const EDGE_PX = { '2d': [0.6, 6], '3d': [1, 8] } as const;

export const lerp = ([lo, hi]: readonly [number, number], t: number) => lo + (hi - lo) * t;

/* ------------------------------------------------------------------ */
/* 3D camera animation                                                 */
/* ------------------------------------------------------------------ */

export type Vec3 = { x: number; y: number; z: number };
export type Camera = { eye: Vec3; center: Vec3; up: Vec3 };

/** Plotly's default 3D view: looking at the scene centre from (1.25, 1.25, 1.25). */
export const DEFAULT_CAMERA: Camera = {
  eye: { x: 1.25, y: 1.25, z: 1.25 },
  center: { x: 0, y: 0, z: 0 },
  up: { x: 0, y: 0, z: 1 },
};
export const WHOLE_VIEW_DISTANCE = Math.hypot(1.25, 1.25, 1.25);

const vsub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const vadd = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const vscale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const vlen = (a: Vec3) => Math.hypot(a.x, a.y, a.z);
const vlerp = (a: Vec3, b: Vec3, t: number): Vec3 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
const vnorm = (a: Vec3): Vec3 => {
  const l = vlen(a);
  return l > 1e-9 ? vscale(a, 1 / l) : { x: 0.577, y: 0.577, z: 0.577 };
};

/**
 * Plotly places the scene box (aspectmode 'cube') at [-0.5, 0.5]³ in camera space,
 * so a data point maps to ((value − axis mid) / axis span) on each axis.
 */
export function toSceneCoords(p: number[], ranges: Array<[number, number]>): Vec3 {
  const n = ranges.map(([lo, hi], k) => (p[k] - (lo + hi) / 2) / (hi - lo || 1));
  return { x: n[0], y: n[1], z: n[2] };
}

/** Camera aimed at `center` from `distance` away, keeping the current viewing direction and up vector. */
export function cameraLookingAt(center: Vec3, distance: number, from: Camera): Camera {
  const dir = vnorm(vsub(from.eye, from.center));
  return { center, eye: vadd(center, vscale(dir, distance)), up: from.up };
}

/**
 * Smooth camera path: the target point moves linearly, the viewing direction turns
 * gradually, and the distance changes geometrically so zooming feels even.
 */
export function interpolateCamera(a: Camera, b: Camera, t: number): Camera {
  const center = vlerp(a.center, b.center, t);
  const da = vsub(a.eye, a.center);
  const db = vsub(b.eye, b.center);
  const la = Math.max(1e-6, vlen(da));
  const lb = Math.max(1e-6, vlen(db));
  const dir = vnorm(vlerp(vscale(da, 1 / la), vscale(db, 1 / lb), t));
  const dist = Math.exp(Math.log(la) + (Math.log(lb) - Math.log(la)) * t);
  return { center, eye: vadd(center, vscale(dir, dist)), up: vnorm(vlerp(a.up, b.up, t)) };
}

export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export function distance3(a: Vec3, b: Vec3) {
  return vlen(vsub(a, b));
}

/**
 * Fruchterman–Reingold force layout in 2 or 3 dimensions. O(n²) per iteration,
 * which is fine for the few hundred nodes a readable correlation network has.
 */
export function forceLayout(nodes: number[], edges: Edge[], dims: 2 | 3, iterations = 180): Map<number, number[]> {
  const n = nodes.length;
  const index = new Map(nodes.map((g, i) => [g, i]));
  const pos = new Float64Array(n * dims);
  let seed = 42;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  for (let i = 0; i < n * dims; i += 1) pos[i] = rand() - 0.5;
  const k = Math.cbrt(1 / Math.max(1, n)) * (dims === 3 ? 1 : 0.9);
  const disp = new Float64Array(n * dims);
  const e = edges
    .map((ed) => [index.get(ed.s), index.get(ed.t), Math.abs(ed.r)] as const)
    .filter((x): x is readonly [number, number, number] => x[0] !== undefined && x[1] !== undefined);
  let temp = 0.1;
  for (let it = 0; it < iterations; it += 1) {
    disp.fill(0);
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        let d2 = 0;
        const delta = [0, 0, 0];
        for (let c = 0; c < dims; c += 1) {
          delta[c] = pos[i * dims + c] - pos[j * dims + c];
          d2 += delta[c] * delta[c];
        }
        const dist = Math.sqrt(d2) || 1e-4;
        const force = (k * k) / dist;
        for (let c = 0; c < dims; c += 1) {
          const f = (delta[c] / dist) * force;
          disp[i * dims + c] += f;
          disp[j * dims + c] -= f;
        }
      }
    }
    for (const [a, b, w] of e) {
      let d2 = 0;
      const delta = [0, 0, 0];
      for (let c = 0; c < dims; c += 1) {
        delta[c] = pos[a * dims + c] - pos[b * dims + c];
        d2 += delta[c] * delta[c];
      }
      const dist = Math.sqrt(d2) || 1e-4;
      const force = ((dist * dist) / k) * w;
      for (let c = 0; c < dims; c += 1) {
        const f = (delta[c] / dist) * force;
        disp[a * dims + c] -= f;
        disp[b * dims + c] += f;
      }
    }
    for (let i = 0; i < n; i += 1) {
      let len = 0;
      for (let c = 0; c < dims; c += 1) len += disp[i * dims + c] ** 2;
      len = Math.sqrt(len) || 1e-4;
      const step = Math.min(len, temp);
      for (let c = 0; c < dims; c += 1) {
        // gentle gravity keeps disconnected components on screen
        pos[i * dims + c] += (disp[i * dims + c] / len) * step - pos[i * dims + c] * 0.01;
      }
    }
    temp *= 0.97;
  }
  const out = new Map<number, number[]>();
  nodes.forEach((g, i) => out.set(g, Array.from(pos.subarray(i * dims, i * dims + dims))));
  return out;
}
