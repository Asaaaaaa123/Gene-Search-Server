# Gene Network API

Express backend for the Gene Network feature. Handles file upload and organ-based gene interaction analysis.

## Routes

- `POST /api/upload` — Upload a CSV/TXT gene file (multipart, field `file`). Returns `{ sessionId, genes, count }`.
- `GET /api/sessions/:sessionId` — Get stored genes for a session.
- `POST /api/analyze/:organ` — Analyze genes for an organ. Body: `{ sessionId }` or `{ genes: string[] }`. Returns `{ organ, nodes, edges, tableRows }`.

## Run

```bash
cd gene-network-api
npm install
npm start
```

Runs on port 3001 by default. Set `PORT` to override.

## Frontend

Set `NEXT_PUBLIC_GENE_NETWORK_API_URL=http://localhost:3001` in `genegen/.env.local` so the app talks to this API.

## Sample file

Use `sample_genes.csv` in this folder to test upload and analysis.
