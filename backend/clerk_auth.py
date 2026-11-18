"""Verify Clerk session JWTs (Bearer tokens from the Next.js app)."""

import json
import os
import urllib.parse
import urllib.request
from typing import Dict, List, Optional

import jwt
from fastapi import HTTPException, status
from jwt import PyJWKClient, ExpiredSignatureError, InvalidTokenError

# The website's Clerk application (Clerk Dashboard → API keys → Frontend API URL); its keys are in
# genegen/coolify-deploy.env. Its session tokens are always accepted, so the backend needs no CLERK_ISSUER variable.
# CLERK_ISSUER names another application whose tokens are accepted too (for example the one used before).
DEFAULT_CLERK_ISSUER = "https://tender-snipe-6719.clerk.accounts.dev"
# Its publishable key (public; the same as in genegen/coolify-deploy.env), for pages that sign in by themselves (Popcorn).
DEFAULT_CLERK_PUBLISHABLE_KEY = "pk_test_dGVuZGVyLXNuaXBlLTY3MTkuY2xlcmsuYWNjb3VudHMuZGV2JA"
# Its secret key (as in genegen/coolify-deploy.env), for ending sessions (Popcorn signing out); CLERK_SECRET_KEY overrides it.
DEFAULT_CLERK_SECRET_KEY = "sk_test_VyxCIgrD2sC0zxJIDnN70iqZSnk1ZVBLesrr1qKl0C"
CLERK_API = "https://api.clerk.com/v1"

_jwks_clients: Dict[str, PyJWKClient] = {}


def clerk_issuer() -> str:
    """CLERK_ISSUER if set, else the website's Clerk application."""
    return os.getenv("CLERK_ISSUER", "").strip().rstrip("/") or DEFAULT_CLERK_ISSUER


def clerk_issuers() -> List[str]:
    """Every issuer whose session tokens are accepted."""
    issuers = [clerk_issuer()]
    if DEFAULT_CLERK_ISSUER not in issuers:
        issuers.append(DEFAULT_CLERK_ISSUER)
    return issuers


def _jwks_url_for(issuer: str) -> str:
    """CLERK_JWKS_URL for the CLERK_ISSUER application if set, else {issuer}/.well-known/jwks.json (Clerk default)."""
    explicit = os.getenv("CLERK_JWKS_URL", "").strip()
    if explicit and issuer == clerk_issuer():
        return explicit
    return f"{issuer}/.well-known/jwks.json"


def clerk_jwks_url() -> str:
    return _jwks_url_for(clerk_issuer())


def _get_jwks_client(url: str) -> PyJWKClient:
    client = _jwks_clients.get(url)
    if client is None:
        client = _jwks_clients[url] = PyJWKClient(url, cache_keys=True)
    return client


def clerk_auth_configured() -> bool:
    return bool(clerk_issuer())


def verify_clerk_bearer_token(token: str) -> str:
    """
    Validate JWT and return Clerk user id (`sub`).

    The token's issuer must be one of clerk_issuers(); its signature is checked with that issuer's keys (JWKS).
    """
    try:
        claimed = jwt.decode(token, options={"verify_signature": False})
    except InvalidTokenError as e:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=f"Invalid session: {e}")
    issuer = str(claimed.get("iss") or "").rstrip("/")
    if issuer not in clerk_issuers():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid session: issued by {issuer or 'an unknown issuer'}, not this site's Clerk application",
        )
    try:
        signing_key = _get_jwks_client(_jwks_url_for(issuer)).get_signing_key_from_jwt(token)
        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            issuer=issuer,
            options={"verify_aud": False},
            leeway=60,
        )
    except ExpiredSignatureError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired")
    except InvalidTokenError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid session: {e}",
        )
    sub = payload.get("sub")
    if not sub:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session")
    return str(sub)


def clerk_secret_key() -> str:
    return os.getenv("CLERK_SECRET_KEY", "").strip() or DEFAULT_CLERK_SECRET_KEY


def _clerk_api(method: str, path: str, query: Optional[dict] = None):
    url = f"{CLERK_API}{path}" + (f"?{urllib.parse.urlencode(query)}" if query else "")
    req = urllib.request.Request(url, method=method, data=b"" if method == "POST" else None, headers={
        "Authorization": f"Bearer {clerk_secret_key()}", "Accept": "application/json", "User-Agent": "gene-search-server"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        body = resp.read()
    return json.loads(body) if body else None


def end_user_sessions(user_id: str) -> int:
    """Revokes every active Clerk session of `user_id` (Backend API) and returns how many: the user is signed out in
    every browser."""
    sessions = _clerk_api("GET", "/sessions", {"user_id": user_id, "status": "active", "limit": 100}) or []
    if isinstance(sessions, dict):  # paginated answers: {"data": [...], "total_count": n}
        sessions = sessions.get("data") or []
    for session in sessions:
        _clerk_api("POST", f"/sessions/{urllib.parse.quote(session['id'])}/revoke")
    return len(sessions)
