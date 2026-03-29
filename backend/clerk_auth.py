"""Verify Clerk session JWTs (Bearer tokens from the Next.js app)."""

import os
from typing import Optional

import jwt
from fastapi import HTTPException, status
from jwt import PyJWKClient, ExpiredSignatureError, InvalidTokenError

_jwks_client: Optional[PyJWKClient] = None
_cached_jwks_url: Optional[str] = None


def clerk_issuer() -> str:
    return os.getenv("CLERK_ISSUER", "").strip().rstrip("/")


def clerk_jwks_url() -> str:
    """Explicit CLERK_JWKS_URL, else {CLERK_ISSUER}/.well-known/jwks.json (Clerk default)."""
    explicit = os.getenv("CLERK_JWKS_URL", "").strip()
    if explicit:
        return explicit
    iss = clerk_issuer()
    if iss:
        return f"{iss}/.well-known/jwks.json"
    return ""


def _get_jwks_client() -> Optional[PyJWKClient]:
    global _jwks_client, _cached_jwks_url
    url = clerk_jwks_url()
    if not url:
        return None
    if _jwks_client is None or _cached_jwks_url != url:
        _jwks_client = PyJWKClient(url, cache_keys=True)
        _cached_jwks_url = url
    return _jwks_client


def clerk_auth_configured() -> bool:
    return bool(clerk_issuer() and clerk_jwks_url())


def verify_clerk_bearer_token(token: str) -> str:
    """
    Validate JWT and return Clerk user id (`sub`).

    In backend/.env set at least:
      CLERK_ISSUER=https://<your-instance>.clerk.accounts.dev
    (JWKS URL defaults to {ISSUER}/.well-known/jwks.json unless CLERK_JWKS_URL is set.)

    Find the issuer in Clerk Dashboard → Configure → API keys → "Frontend API URL" / JWT issuer.
    """
    issuer = clerk_issuer()
    jwks = clerk_jwks_url()
    client = _get_jwks_client()
    if not issuer or not client:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Clerk auth is not configured on the Python API. "
                "Add CLERK_ISSUER to backend/.env (e.g. https://YOUR_APP.clerk.accounts.dev). "
                "Optional: CLERK_JWKS_URL if not using the default /.well-known/jwks.json path. "
                "Restart the backend after saving."
            ),
        )
    try:
        signing_key = client.get_signing_key_from_jwt(token)
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
