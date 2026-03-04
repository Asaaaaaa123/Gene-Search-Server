/**
 * Parse CSV/TXT gene file. Supports:
 * - Header row: Gene_ID, Name, Description or Gene_ID, Name, Expression_Level, etc.
 * - Plain list of gene symbols (one per line)
 */
function parseGeneFile(content) {
  if (typeof content !== 'string') return [];
  const lines = content.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  const first = lines[0];
  const sep = first.includes('\t') ? '\t' : ',';
  const rawHeaders = first.split(sep).map(h => h.trim().replace(/^\uFEFF/, ''));
  const headers = rawHeaders.some(h => /gene|name|id|symbol/i.test(h))
    ? rawHeaders
    : null;

  const rows = [];
  const start = headers ? 1 : 0;
  for (let i = start; i < lines.length; i++) {
    const parts = lines[i].split(sep).map(p => p.trim());
    if (headers && headers.length >= 1) {
      const row = {};
      const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, '_');
      headers.forEach((h, j) => { row[norm(h)] = parts[j] || ''; });
      const id = row.gene_id || row.geneid || row.symbol || row.name || (parts[0] && String(parts[0]).trim()) || '';
      if (id) rows.push({ ...row, id, symbol: id, name: row.name || row.description || id });
    } else if (headers === null) {
      const id = (parts[0] && String(parts[0]).trim()) || '';
      if (id) rows.push({ id, symbol: id, name: parts[1] || id });
    } else {
      const id = parts[0];
      if (id) rows.push({ id, symbol: id, name: parts[1] || id });
    }
  }
  return rows;
}

/**
 * Build gene network for an organ: nodes (genes) and edges (interactions).
 * Uses mock data when external APIs are not configured; can integrate STRING-DB / BioGRID later.
 */
function buildGeneNetwork(geneList, organ) {
  const genes = [...new Set(geneList.map(g => String(g).trim()).filter(Boolean))];
  if (genes.length === 0) return { nodes: [], edges: [], tableRows: [] };

  const nodes = genes.map((id, i) => ({
    id,
    label: id,
    data: { id, label: id }
  }));

  // Mock edges: pair up genes with random-ish scores (deterministic per organ + gene pair)
  const edges = [];
  const tableRows = [];
  const hash = (a, b) => (a + b).split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  for (let i = 0; i < genes.length; i++) {
    for (let j = i + 1; j < genes.length; j++) {
      const a = genes[i];
      const b = genes[j];
      const seed = hash(organ + a + b) % 1000;
      const score = 0.3 + (seed / 1000) * 0.7;
      const types = ['co-expression', 'physical binding', 'pathway', 'genetic interaction'];
      const type = types[seed % types.length];
      edges.push({
        id: `e_${a}_${b}`,
        source: a,
        target: b,
        score,
        type,
        data: { source: a, target: b, score, type }
      });
      tableRows.push({
        geneA: a,
        geneB: b,
        interactionType: type,
        score: Math.round(score * 100) / 100,
        organ
      });
    }
  }

  return { nodes, edges, tableRows };
}

module.exports = { parseGeneFile, buildGeneNetwork };
