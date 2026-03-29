/**
 * Fetch or mock gene-gene interactions for an organ context.
 * Can integrate STRING-DB, NCBI Gene, or BioGRID; falls back to mock data.
 */

const axios = require('axios');

const MOCK_INTERACTIONS = [
  { a: 'BRCA1', b: 'TP53', score: 0.92, type: 'physical' },
  { a: 'BRCA1', b: 'RAD51', score: 0.88, type: 'physical' },
  { a: 'TP53', b: 'MDM2', score: 0.95, type: 'physical' },
  { a: 'TP53', b: 'CDKN1A', score: 0.85, type: 'regulation' },
  { a: 'EGFR', b: 'GRB2', score: 0.9, type: 'physical' },
  { a: 'MYC', b: 'MAX', score: 0.87, type: 'physical' },
  { a: 'BRCA1', b: 'ESR1', score: 0.72, type: 'co-expression' },
  { a: 'TP53', b: 'BRCA1', score: 0.78, type: 'co-expression' },
  { a: 'RAD51', b: 'BRCA2', score: 0.91, type: 'physical' },
  { a: 'CDKN1A', b: 'CDK2', score: 0.82, type: 'physical' },
];

function normalizeGeneId(g) {
  if (!g) return '';
  const s = String(g).trim().toUpperCase();
  return s;
}

function getMockEdges(genes, organ) {
  const symbols = new Set(genes.map((g) => normalizeGeneId(g.gene_id || g.name)));
  const edges = [];
  const seen = new Set();

  MOCK_INTERACTIONS.forEach(({ a, b, score, type }) => {
    const key = [a, b].sort().join('-');
    if (seen.has(key)) return;
    if (symbols.has(a) && symbols.has(b)) {
      seen.add(key);
      edges.push({
        source: a,
        target: b,
        score: Math.min(1, score + (organ ? 0.02 : 0)),
        type: type || 'unknown',
      });
    }
  });

  // Add random mock edges between uploaded genes if we have few
  if (edges.length < 3 && symbols.size >= 2) {
    const arr = [...symbols];
    for (let i = 0; i < Math.min(5, arr.length * 2); i++) {
      const i1 = Math.floor(Math.random() * arr.length);
      let i2 = Math.floor(Math.random() * arr.length);
      if (i1 === i2) i2 = (i2 + 1) % arr.length;
      const a = arr[i1];
      const b = arr[i2];
      const key = [a, b].sort().join('-');
      if (!seen.has(key)) {
        seen.add(key);
        edges.push({
          source: a,
          target: b,
          score: 0.5 + Math.random() * 0.4,
          type: 'predicted',
        });
      }
    }
  }

  return edges;
}

async function fetchStringDbInteractions(identifiers) {
  if (!identifiers || identifiers.length === 0) return null;
  const species = 9606; // human
  const list = identifiers.slice(0, 200).join('%0d');
  try {
    const url = `https://string-db.org/api/json/network?identifiers=${encodeURIComponent(list)}&species=${species}`;
    const res = await axios.get(url, { timeout: 15000 });
    if (Array.isArray(res.data) && res.data.length > 0) {
      return res.data.map((l) => ({
        source: (l.preferredName_A || l.displayName_A || '').toUpperCase(),
        target: (l.preferredName_B || l.displayName_B || '').toUpperCase(),
        score: Number(l.score) || 0,
        type: 'string',
      }));
    }
  } catch (e) {
    console.warn('STRING-DB request failed:', e.message);
  }
  return null;
}

async function getInteractions(genes, organ) {
  const symbols = genes.map((g) => String(g.gene_id || g.name).trim()).filter(Boolean);
  const normalized = symbols.map(normalizeGeneId);

  let edges = await fetchStringDbInteractions(normalized);
  if (!edges || edges.length === 0) {
    edges = getMockEdges(genes, organ);
  } else {
    const byOrgan = getMockEdges(genes, organ);
    const combined = [...edges];
    const keySet = new Set(edges.map((e) => [e.source, e.target].sort().join('-')));
    byOrgan.forEach((e) => {
      const k = [e.source, e.target].sort().join('-');
      if (!keySet.has(k)) {
        keySet.add(k);
        combined.push(e);
      }
    });
    edges = combined;
  }

  const nodeSet = new Set();
  edges.forEach((e) => {
    nodeSet.add(e.source);
    nodeSet.add(e.target);
  });
  const nodes = genes
    .filter((g) => {
      const id = normalizeGeneId(g.gene_id || g.name);
      return nodeSet.has(id) || symbols.includes(g.gene_id) || symbols.includes(g.name);
    })
    .map((g) => ({
      id: normalizeGeneId(g.gene_id || g.name) || g.name,
      name: g.name || g.gene_id,
      description: g.description,
      expression_level: g.expression_level,
    }));

  return {
    nodes: [...new Map(nodes.map((n) => [n.id, n])).values()],
    edges,
    organ: organ || 'general',
  };
}

module.exports = {
  getInteractions,
  getMockEdges,
  normalizeGeneId,
};
