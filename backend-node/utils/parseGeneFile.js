/**
 * Parse uploaded gene file (CSV or TXT).
 * Supports: Gene_ID, Name, Description, Expression_Level
 */

const ALLOWED_MIME = ['text/csv', 'text/plain', 'application/csv', 'text/tab-separated-values'];
const MAX_ROWS = 5000;
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

function parseCSV(content) {
  const lines = content.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length === 0) return { genes: [], headers: [] };

  const rawHeaders = lines[0].split(/[,\t]/).map((h) => h.trim().replace(/^["']|["']$/g, ''));
  const headers = normalizeHeaders(rawHeaders);

  const genes = [];
  for (let i = 1; i < Math.min(lines.length, MAX_ROWS + 1); i++) {
    const values = parseLine(lines[i]);
    const row = {};
    rawHeaders.forEach((h, j) => {
      row[headers[j]] = values[j] !== undefined ? String(values[j]).trim() : '';
    });
    const geneId = row.gene_id || row.Gene_ID || row.geneid || row.id || '';
    const name = row.name || row.Name || row.gene_name || row.Gene_Name || geneId;
    if (geneId || name) {
      genes.push({
        gene_id: geneId || name,
        name: name || geneId,
        description: row.description || row.Description || row.desc || '',
        expression_level: row.expression_level ?? row.Expression_Level ?? row.expression ?? '',
      });
    }
  }

  return { genes, headers };
}

function normalizeHeaders(raw) {
  const map = {
    'gene_id': 'gene_id',
    'gene id': 'gene_id',
    'Gene_ID': 'gene_id',
    'Gene ID': 'gene_id',
    'id': 'gene_id',
    'name': 'name',
    'Name': 'name',
    'gene_name': 'name',
    'Gene_Name': 'name',
    'description': 'description',
    'Description': 'description',
    'desc': 'description',
    'expression_level': 'expression_level',
    'Expression_Level': 'expression_level',
    'expression': 'expression_level',
  };
  return raw.map((h) => map[h?.toLowerCase?.()] || h);
}

function parseLine(line) {
  const out = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"' || c === "'") {
      inQuotes = !inQuotes;
    } else if ((c === ',' || c === '\t') && !inQuotes) {
      out.push(current);
      current = '';
    } else {
      current += c;
    }
  }
  out.push(current);
  return out;
}

function validateFile(mimetype, size) {
  if (size > MAX_FILE_SIZE) {
    return { ok: false, error: `File too large. Max ${MAX_FILE_SIZE / 1024 / 1024}MB.` };
  }
  if (!mimetype || !ALLOWED_MIME.some((m) => mimetype.includes(m) || mimetype === m)) {
    return { ok: false, error: 'Invalid file type. Use CSV or TXT.' };
  }
  return { ok: true };
}

module.exports = {
  parseCSV,
  validateFile,
  MAX_ROWS,
  MAX_FILE_SIZE,
};
