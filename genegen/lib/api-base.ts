/**
 * FastAPI is reached in the browser via same-origin paths `/api/*`.
 * Next.js rewrites (next.config.ts) proxy those to the real backend URL from
 * NEXT_PUBLIC_API_URL at build time — avoids CORS and many "NetworkError" cases.
 *
 * Use API_PUBLIC_BASE_URL for display, opening /docs in a new tab, or direct links.
 */
const raw = process.env.NEXT_PUBLIC_API_URL?.trim();
const fallback = 'http://localhost:8050';
export const API_PUBLIC_BASE_URL = (raw && raw.length > 0 ? raw : fallback).replace(
  /\/+$/,
  '',
);

/** Empty = same-origin; paths must start with `/api/...` (or `/` only for rare cases). */
export const API_BASE_URL = '';
