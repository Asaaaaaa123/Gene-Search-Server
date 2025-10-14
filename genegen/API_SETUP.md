# API Connection Setup Guide

## Overview
This application requires a backend API server to function properly. The frontend communicates with the backend through HTTP requests.

## Quick Setup

### 1. Backend Server
Ensure your backend server is running and accessible. The default configuration expects the backend at `http://localhost:8000`.

### 2. Environment Configuration
Create a `.env.local` file in the root directory with the following content:

```bash
# For local development
NEXT_PUBLIC_API_URL=http://localhost:8000

# For cloud deployment (update with your actual URL)
# NEXT_PUBLIC_API_URL=https://your-cloud-api-url.com
```

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
| `NEXT_PUBLIC_API_URL` | Backend API base URL | `http://localhost:8000` | Yes |

## Development vs Production

### Development
```bash
NEXT_PUBLIC_API_URL=http://localhost:8000
```

### Production/Cloud
```bash
NEXT_PUBLIC_API_URL=https://your-production-api.com
```

## Backend Requirements

- **Framework**: FastAPI (Python)
- **Port**: 8000 (default)
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
