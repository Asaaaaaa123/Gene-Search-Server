/**
 * Gene Network API - Express server
 * Routes: POST /api/upload, POST /api/analyze/:organ, GET /api/sessions/:sessionId
 */

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const { parseGeneFile, buildGeneNetwork } = require('./services/geneService');

const app = express();
const PORT = process.env.PORT || 3001;

const uploadStore = new Map();

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = ['.csv', '.txt'];
    if (allowed.includes(ext) || file.mimetype === 'text/csv' || file.mimetype === 'text/plain') {
      cb(null, true);
    } else {
      cb(new Error('Only CSV or TXT files are allowed'));
    }
  },
});

app.use(cors({ origin: true }));
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'gene-network-api' });
});

app.post('/api/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    let content = req.file.buffer.toString('utf-8');
    if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
    const genes = parseGeneFile(content);
    if (!genes || genes.length === 0) {
      return res.status(400).json({ error: 'No valid genes found in file' });
    }
    const sessionId = `s_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    uploadStore.set(sessionId, { genes, createdAt: Date.now() });
    const maxAge = 60 * 60 * 1000;
    for (const [id, data] of uploadStore.entries()) {
      if (Date.now() - data.createdAt > maxAge) uploadStore.delete(id);
    }
    res.json({ sessionId, genes, count: genes.length });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message || 'Upload failed' });
  }
});

app.get('/api/sessions/:sessionId', (req, res) => {
  const data = uploadStore.get(req.params.sessionId);
  if (!data) return res.status(404).json({ error: 'Session not found or expired' });
  res.json({ sessionId: req.params.sessionId, genes: data.genes, count: data.genes.length });
});

app.post('/api/analyze/:organ', express.json(), (req, res) => {
  try {
    const organ = (req.params.organ || '').trim();
    if (!organ) return res.status(400).json({ error: 'Organ is required' });

    let genes = req.body?.genes;
    const sessionId = req.body?.sessionId;
    if ((!genes || genes.length === 0) && sessionId) {
      const data = uploadStore.get(sessionId);
      if (!data) return res.status(404).json({ error: 'Session not found or expired' });
      genes = data.genes.map(g => g.id || g.symbol || g.Gene_ID || g.name).filter(Boolean);
    }
    if (!genes || genes.length === 0) {
      return res.status(400).json({ error: 'No genes provided. Upload a file first or send genes in the request body.' });
    }
    const geneList = Array.isArray(genes) ? genes.map(String) : [String(genes)];

    const { nodes, edges, tableRows } = buildGeneNetwork(geneList, organ);
    res.json({ organ, nodes, edges, tableRows });
  } catch (err) {
    console.error('Analyze error:', err);
    res.status(500).json({ error: err.message || 'Analysis failed' });
  }
});

app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'File too large (max 5MB)' });
  }
  res.status(500).json({ error: err.message || 'Server error' });
});

app.listen(PORT, () => {
  console.log(`Gene Network API running on port ${PORT}`);
});
