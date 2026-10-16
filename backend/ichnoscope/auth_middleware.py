"""Supabase JWT verification middleware for Server B dashboard API."""

import os
import hmac
import logging
from typing import Optional

import jwt  # PyJWT
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

logger = logging.getLogger(__name__)

security = HTTPBearer(auto_error=False)


def get_supabase_jwt_secret() -> str:
    """Get Supabase JWT secret from environment."""
    secret = os.environ.get("SUPABASE_JWT_SECRET", "")
    if not secret:
        logger.warning("SUPABASE_JWT_SECRET not configured — auth is disabled")
    return secret


def decode_supabase_token(token: str) -> dict:
    """
    Decode and verify a Supabase JWT.

    Returns dict with keys: sub (user_id), email, role, exp, iat
    Raises HTTPException 401 on invalid/expired token.
    """
    secret = get_supabase_jwt_secret()
    if not secret:
        # Auth not configured — return anonymous context
        return {"sub": "anonymous", "email": "anonymous@local", "role": "anon"}

    try:
        payload = jwt.decode(
            token,
            secret,
            algorithms=["HS256"],
            audience="authenticated",  # Supabase default audience
            options={"verify_exp": True},
        )
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired")
    except jwt.InvalidTokenError as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {e}")


async def get_current_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> dict:
    """
    FastAPI dependency — extract and verify user from Authorization header.

    Returns: { "user_id": str, "email": str, "role": str }
    """
    # Check if auth is configured
    secret = get_supabase_jwt_secret()
    if not secret:
        # Auth not configured — allow through (backward compat with dev mode)
        return {"user_id": "anonymous", "email": "dev@local", "role": "admin"}

    if not credentials:
        # Check for legacy admin token (backward compat during migration)
        from ichnoscope.config import get_settings
        settings = get_settings()
        admin_token = settings.admin_token.get_secret_value() if settings.admin_token else None
        auth_header = request.headers.get("Authorization", "")
        token = auth_header.replace("Bearer ", "").strip()

        if admin_token and token and hmac.compare_digest(token, admin_token):
            return {"user_id": "admin_legacy", "email": "admin@local", "role": "admin"}

        raise HTTPException(status_code=401, detail="Missing authentication credentials")

    payload = decode_supabase_token(credentials.credentials)

    return {
        "user_id": payload.get("sub", "unknown"),
        "email": payload.get("email", ""),
        "role": payload.get("role", "authenticated"),
    }
