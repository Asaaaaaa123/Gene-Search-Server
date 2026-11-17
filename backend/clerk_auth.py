"""Verify Clerk session JWTs (Bearer tokens from the Next.js app)."""

import os
from typing import Dict, List, Optional

import jwt
from fastapi import HTTPException, status
from jwt import PyJWKClient, ExpiredSignatureError, InvalidTokenError

# The website's Clerk application (Clerk Dashboard → API keys → Frontend API URL); its keys are in
# genegen/coolify-deploy.env. Its session tokens are always accepted, so the backend needs no CLERK_ISSUER variable.
# CLERK_ISSUER names another application whose tokens are accepted too (for example the one used before).
DEFAULT_CLERK_ISSUER = "https://tender-snipe-6719.clerk.accounts.dev"

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
