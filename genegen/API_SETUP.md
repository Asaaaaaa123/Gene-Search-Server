# API Connection Setup Guide

## Overview
This application requires a backend API server to function properly. The frontend communicates with the backend through HTTP requests.

## Quick Setup

### 1. Backend Server
Ensure your backend server is running and accessible. The default configuration expects the backend at `http://localhost:8050`.

### 2. Environment Configuration
Create a `.env.local` file in the root directory with the following content:

```bash
# For local development
NEXT_PUBLIC_API_URL=http://localhost:8050

# Clerk (sign-in / sign-up) — create an application at https://dashboard.clerk.com
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...

# For cloud deployment (update with your actual URL)
# NEXT_PUBLIC_API_URL=https://your-cloud-api-url.com
```

### Backend Clerk JWT (required for protected API routes)

The Next.js app signs users in with Clerk and sends a **session JWT** to FastAPI. The Python server must verify that token using Clerk’s issuer (and JWKS).

In **`backend/.env`** set at least (Clerk Dashboard → **Configure** → **API keys** → **Frontend API URL** / issuer, no trailing slash):

```bash
CLERK_ISSUER=https://YOUR_INSTANCE.clerk.accounts.dev
```

JWKS defaults to `{CLERK_ISSUER}/.well-known/jwks.json`. Only set `CLERK_JWKS_URL` if you use a non-standard JWKS location.

Restart the backend after editing `.env`. On startup you should see `Clerk JWT: configured (...)`; if you see `NOT configured`, uploads will return 503 until `CLERK_ISSUER` is set.

Signed-in browser calls send `Authorization: Bearer <session JWT>` to FastAPI for `POST /api/gene/add`, `POST /api/gene/upload_csv`, and user preferences.

### 3. Verify Backend Endpoints
Your backend should have these endpoints available:
- `GET /api/gene/symbols` - List of available genes
- `GET /api/gene/symbol/search` - Search for gene data
- `GET /api/gene/symbol/showFoldChange` - Generate fold change charts
- `GET /api/gene/symbol/showLSMeanControl` - Generate LSmean control charts
- `GET /api/gene/symbol/showLSMeanTenMgKg` - Generate LSmean 10mg/kg charts

## Troubleshooting

### Connection Issues
1. **Check Backend Status**: Ensure your backend server is running
2. **Verify API URL**: Check the `NEXT_PUBLIC_API_URL` in your `.env.local` file
3. **Firewall Settings**: Ensure no firewall is blocking the connection
4. **Port Availability**: Verify the backend port is not blocked

### Common Error Messages
- **"Failed to fetch"**: Usually indicates network connectivity issues
- **"HTTP error! status: 404"**: Endpoint not found on the backend
- **"Connection timed out"**: Backend server is not responding

### Testing Connection
1. Use the "Test Connection" button in the header
2. Check the API status indicator (green = connected, red = disconnected)
3. Try opening the API docs: `{API_URL}/docs`

## Environment Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `NEXT_PUBLIC_API_URL` | Backend API base URL | `http://localhost:8050` | Yes |

## Development vs Production

### Development
```bash
NEXT_PUBLIC_API_URL=http://localhost:8050
```

### Production/Cloud
```bash
NEXT_PUBLIC_API_URL=https://your-production-api.com
```

## Backend Requirements

- **Framework**: FastAPI (Python)
- **Port**: 8050 (default)
- **CORS**: Must allow requests from your frontend domain
- **Endpoints**: Must implement the required API endpoints listed above

## Example Backend CORS Configuration

```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "https://yourdomain.com"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```
