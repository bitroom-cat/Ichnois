"""Project Key & DSN Authenticator for Server A Edge Gateway.

Supports standard Sentry client headers (`X-Sentry-Auth`), custom Ignoscope tokens (`X-Ignoscope-Token`),
and DSN query string parameters. Maintains an in-memory cache synchronized from Server B with zero-DB latency.
"""

from __future__ import annotations

import logging
from pathlib import Path
import sys
import threading
import time
from typing import Any

from fastapi import Request
import httpx

# Ensure local directory is in path when run standalone
_CURRENT_DIR = str(Path(__file__).resolve().parent)
if _CURRENT_DIR not in sys.path:
    sys.path.insert(0, _CURRENT_DIR)

try:
    from v2.edge_gateway.config import get_gateway_config
except ImportError:
    from config import get_gateway_config

logger = logging.getLogger("edge_gateway.auth")

_KEY_CACHE_LOCK = threading.Lock()
# Mapping of public_key -> dict containing project metadata (project_id, name, rate_limit_min, etc.)
_KEY_CACHE: dict[str, dict[str, Any]] = {}
_LAST_SYNC_TIME: float = 0.0
_SYNC_INTERVAL_SECONDS: float = 30.0


class AuthenticationError(Exception):
    """Raised when request lacks valid project telemetry credentials."""


def get_cached_project(public_key: str) -> dict[str, Any] | None:
    """Return cached project metadata for a public key."""
    with _KEY_CACHE_LOCK:
        return _KEY_CACHE.get(public_key)


def update_cached_project(public_key: str, data: dict[str, Any]) -> None:
    """Manually update or insert a project key into the in-memory cache."""
    with _KEY_CACHE_LOCK:
        _KEY_CACHE[public_key] = data


def invalidate_project_key(public_key: str) -> None:
    """Evict a revoked project key from the in-memory cache."""
    with _KEY_CACHE_LOCK:
        _KEY_CACHE.pop(public_key, None)


def get_all_cached_keys() -> set[str]:
    """Return all known active public keys currently in memory."""
    with _KEY_CACHE_LOCK:
        return set(_KEY_CACHE.keys())


def sync_keys_from_server_b(timeout: float = 4.0, force: bool = False) -> bool:
    """Synchronize active project public keys from Server B internal API.
    
    Fast zero-DB edge path: keeps an in-memory cache updated every 30s.
    """
    global _LAST_SYNC_TIME
    now = time.time()
    if not force and (now - _LAST_SYNC_TIME) < _SYNC_INTERVAL_SECONDS:
        return True

    config = get_gateway_config()
    sync_url = config.internal_core_url.replace(
        "/internal/v1/incidents/ingress", "/internal/v1/projects/cache"
    )
    headers = {
        "Authorization": f"Bearer {config.internal_gateway_secret}",
        "X-Gateway-Node": "edge-gateway-node-01",
    }

    try:
        with httpx.Client(timeout=timeout) as client:
            resp = client.get(sync_url, headers=headers)
            if resp.status_code == 200:
                data = resp.json()
                projects_map = data.get("projects", {})
                with _KEY_CACHE_LOCK:
                    _KEY_CACHE.clear()
                    _KEY_CACHE.update(projects_map)
                _LAST_SYNC_TIME = now
                logger.info("Synced %d active project keys from Server B", len(projects_map))
                return True
            logger.warning(
                "Server B project cache sync returned HTTP %d: %s",
                resp.status_code,
                resp.text[:120],
            )
            return False
    except Exception as exc:
        logger.warning("Could not sync project keys from Server B (%s): %s", sync_url, exc)
        return False


def extract_telemetry_key(
    request: Request,
    x_sentry_auth: str | None = None,
    x_ignoscope_token: str | None = None,
) -> str:
    """Extract project public key or secret token from incoming HTTP headers or query parameters."""
    # 1. Custom Ignoscope / Ichnoscope Header
    token = (
        x_ignoscope_token
        or request.headers.get("x-ignoscope-token")
        or request.headers.get("x-ichnoscope-token")
    )
    if token and token.strip():
        return token.strip()

    # 2. Standard Sentry Header: e.g. "Sentry sentry_version=7, sentry_key=XYZ123..."
    sentry_header = x_sentry_auth or request.headers.get("x-sentry-auth")
    if sentry_header:
        clean = sentry_header.strip()
        if clean.startswith("Sentry "):
            clean = clean[7:].strip()
        for component in clean.split(","):
            trimmed = component.strip()
            if trimmed.startswith("sentry_key="):
                return trimmed.split("sentry_key=", 1)[1].strip()

    # 3. Authorization Bearer Token
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        return auth_header[7:].strip()

    # 4. Fallback to query parameter (common in browser SDK GET/POST transports)
    query_key = request.query_params.get("sentry_key")
    if query_key:
        return query_key.strip()

    return ""


def authenticate_project_request(
    project_id: str,
    request: Request,
    x_sentry_auth: str | None = None,
    x_ignoscope_token: str | None = None,
) -> str:
    """Validate project key against in-memory synced cache and static config."""
    config = get_gateway_config()
    extracted_key = extract_telemetry_key(request, x_sentry_auth, x_ignoscope_token)

    if not extracted_key:
        raise AuthenticationError("Missing telemetry authentication key or DSN identifier.")

    # 1. Check in-memory sync cache
    cached_meta = get_cached_project(extracted_key)
    if cached_meta:
        # Attach resolved project details to request state for downstream handlers
        try:
            request.state.cached_project = cached_meta
        except Exception:
            pass
        return extracted_key

    # 2. Check static allowed_project_keys whitelist
    if extracted_key in config.allowed_project_keys:
        return extracted_key

    # 3. If key whitelisting is strictly enforced, reject unknown keys
    if config.enforce_auth_whitelist:
        raise AuthenticationError(f"Unauthorized or revoked telemetry key: '{extracted_key}'")

    return extracted_key
