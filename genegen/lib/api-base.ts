/**
 * FastAPI backend base URL (no trailing slash).
 * Override with NEXT_PUBLIC_API_URL (e.g. in .env.local).
 */
const raw = process.env.NEXT_PUBLIC_API_URL?.trim();
const fallback = 'http://localhost:8000';
const base = raw && raw.length > 0 ? raw : fallback;

export const API_BASE_URL = base.replace(/\/+$/, '');
