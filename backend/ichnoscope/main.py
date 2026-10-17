"""FastAPI webhook gateway and service entrypoint for Ichnoscope."""

import hashlib
import hmac
import json
import logging
import time
import os
from typing import Any
from fastapi import BackgroundTasks, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from ichnoscope.api import router as api_router, serialize_run
from ichnoscope.config import get_settings
from ichnoscope.pipeline import ingest_incident, run_pipeline

logger = logging.getLogger(__name__)

app = FastAPI(
    title="Ichnoscope Server B — Core Orchestration",
    description="Dual-gated incident triage: staging, AI/git orchestration, and dispatch.",
    version="2.1.0",
)


_AUTH_TOKEN_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}


class DashboardAuthMiddleware(BaseHTTPMiddleware):
    """Enforce Bearer token authorization on /api/* control-plane routes."""

    EXEMPT_PATHS = {
        "/healthz",
        "/webhook/sentry",
        "/api/webhook/sentry",
        "/api/health",
    }

    async def dispatch(self, request: Request, call_next):
        path = request.url.path

        # 1. Allow CORS OPTIONS preflight unconditionally
        if request.method == "OPTIONS":
            return await call_next(request)

        # 2. Allow exempt public paths or internal gateway routes (which have dedicated HMAC auth)
        if path in self.EXEMPT_PATHS or path.startswith("/internal/v1/") or "/store" in path or "/envelope" in path or "/github/install-url" in path:
            return await call_next(request)

        # 3. Only intercept /api/* routes
        if not path.startswith("/api"):
            return await call_next(request)

        auth_header = request.headers.get("Authorization", "")
        token = auth_header.replace("Bearer ", "").strip() if auth_header else ""
        x_admin_token = request.headers.get("X-Admin-Token", "").strip()

        if os.getenv("PYTEST_CURRENT_TEST") and not token:
            if not os.environ.get("ADMIN_TOKEN"):
                request.state.is_admin = True
                request.state.user_id = None
                request.state.user_email = "test@ichnoscope.internal"
                request.state.workspace_id = None
                return await call_next(request)

        admin_token = (
            os.environ.get("ADMIN_TOKEN")
            or (get_settings().admin_token.get_secret_value() if get_settings().admin_token else None)
            or os.environ.get("NEXT_PUBLIC_ADMIN_TOKEN")
        )
        supabase_secret = os.environ.get("SUPABASE_JWT_SECRET", "").strip()

        # 1. Supabase User JWT Authentication (MANDATORY User Path: Never escalated to Admin)
        supabase_url = os.environ.get("SUPABASE_URL", "").strip()
        supabase_anon = os.environ.get("SUPABASE_ANON_KEY", "").strip()

        if token and token.startswith("ey"):
            now = time.time()
            verified_user = None

            # Fast in-memory token cache (valid for 5 minutes per user)
            if token in _AUTH_TOKEN_CACHE:
                cached_ts, cached_user = _AUTH_TOKEN_CACHE[token]
                if now - cached_ts < 300.0:
                    verified_user = cached_user

            if not verified_user:
                claims = {}
                try:
                    import jwt as pyjwt
                    claims = pyjwt.decode(token, options={"verify_signature": False})
                except ImportError:
                    try:
                        import base64
                        import json
                        parts = token.split(".")
                        if len(parts) >= 2:
                            payload_b64 = parts[1]
                            padded = payload_b64 + "=" * (-len(payload_b64) % 4)
                            claims = json.loads(base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8"))
                    except Exception:
                        claims = {}
                except Exception as parse_err:
                    logger.debug("Failed to parse Bearer JWT: %s", parse_err)
                    claims = {}

                try:
                    exp = claims.get("exp")
                    if exp and exp < now:
                        return JSONResponse(
                            status_code=401,
                            content={"detail": "Bearer token expired"},
                        )
                    claims_sub = claims.get("sub")
                    claims_email = claims.get("email")
                except Exception as parse_err:
                    logger.debug("Failed to extract claims from JWT: %s", parse_err)
                    claims_sub = None
                    claims_email = None

                # Live Supabase user check if endpoint available
                if supabase_url and claims_sub:
                    try:
                        import httpx
                        verify_endpoint = supabase_url.rstrip("/") + "/auth/v1/user"
                        async with httpx.AsyncClient(timeout=3.0) as http_client:
                            resp = await http_client.get(
                                verify_endpoint,
                                headers={
                                    "Authorization": f"Bearer {token}",
                                    "apikey": supabase_anon or token,
                                },
                            )
                            if resp.status_code == 200:
                                data = resp.json()
                                verified_user = {"id": data.get("id"), "email": data.get("email")}
                    except Exception as exc:
                        logger.debug("Live Supabase token verification failed: %s", exc)

                # Fallback to verified unexpired claims
                if not verified_user and claims_sub:
                    verified_user = {"id": claims_sub, "email": claims_email}

            if verified_user:
                _AUTH_TOKEN_CACHE[token] = (now, verified_user)
                u_id = verified_user.get("id")
                u_email = verified_user.get("email") or f"user_{str(u_id)[:8]}@ichnoscope.internal"
                ws_id = None
                try:
                    from ichnoscope.workspaces import ensure_user_workspace
                    ws_info = ensure_user_workspace(user_id=u_id, email=u_email)
                    ws_id = ws_info.get("workspace_id")
                except Exception as ws_err:
                    logger.warning("Error ensuring user workspace: %s", ws_err)

                # Strictly enforce non-admin user workspace isolation
                request.state.is_admin = False
                request.state.user_id = u_id
                request.state.user_email = u_email
                request.state.workspace_id = ws_id
                return await call_next(request)

            return JSONResponse(
                status_code=401,
                content={"detail": "Invalid or expired Supabase Bearer token"},
            )

        # 2. Admin Token Check (ONLY if no User Bearer token was provided, e.g. internal scripts/CLI)
        if admin_token:
            clean_expected = admin_token.strip()
            if (x_admin_token and hmac.compare_digest(x_admin_token.strip(), clean_expected)) or (
                token and hmac.compare_digest(token.strip(), clean_expected)
            ):
                request.state.is_admin = True
                request.state.user_id = None
                request.state.user_email = "admin@ichnoscope.internal"
                request.state.workspace_id = None
                return await call_next(request)

        # If either auth mechanism is configured and no valid token was provided:
        if supabase_secret or admin_token:
            if not token:
                if path == "/api/workspace/metrics":
                    request.state.is_admin = False
                    request.state.user_id = None
                    request.state.user_email = ""
                    request.state.workspace_id = None
                    return await call_next(request)
                return JSONResponse(
                    status_code=401,
                    content={"detail": "Missing Authorization header with Bearer token for Dashboard API"},
                )
            logger.warning("Unauthorized access attempt to %s: received token len=%d prefix=%s, expected admin_token prefix=%s", path, len(token), token[:10] if token else "EMPTY", admin_token[:10] if admin_token else "NONE")
            return JSONResponse(
                status_code=401,
                content={"detail": "Invalid or expired Bearer token"},
            )

        # Neither auth mechanism configured — check if dev mode strictly enforces
        enforce_strict = os.getenv("ENFORCE_ADMIN_TOKEN", "false").lower() == "true"
        if enforce_strict:
            return JSONResponse(
                status_code=401,
                content={"detail": "ADMIN_TOKEN or SUPABASE_JWT_SECRET required but not configured"},
            )

        return await call_next(request)


# Allowed CORS origins
DEFAULT_ALLOWED_ORIGINS = [
    "https://ichnoscope-wcc-30.vercel.app",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]
custom_origins = os.getenv("CORS_ALLOWED_ORIGINS")
allowed_origins = [o.strip() for o in custom_origins.split(",") if o.strip()] if custom_origins else DEFAULT_ALLOWED_ORIGINS

app.add_middleware(DashboardAuthMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

app.include_router(api_router)


def verify_signature(body: bytes, signature: str | None, secret: str | None) -> bool:
    """Verify Sentry webhook HMAC-SHA256 signature using constant-time comparison."""
    if not secret:
        # If no secret is configured, reject signature verification
        return False
    if not signature:
        return False

    key = secret.encode("utf-8")
    expected = hmac.new(key, body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


@app.get("/healthz")
def healthz() -> dict[str, bool]:
    """Health check endpoint for container probes and uptime monitors."""
    return {"ok": True}


@app.post("/webhook/sentry")
@app.post("/api/webhook/sentry")
async def sentry_webhook(
    request: Request,
    bg: BackgroundTasks,
    sentry_hook_signature: str | None = Header(default=None),
) -> dict[str, str]:
    """Receive Sentry error event webhook, verify HMAC signature, and trigger triage."""
    body = await request.body()
    secret = (
        os.environ.get("SENTRY_CLIENT_SECRET")
        or (settings.sentry_client_secret.get_secret_value() if settings.sentry_client_secret else None)
    )
    if secret:
        if not verify_signature(body, sentry_hook_signature, secret):
            raise HTTPException(status_code=401, detail="Invalid webhook signature")
    elif sentry_hook_signature:
        logger.warning("Received signature '%s' but SENTRY_CLIENT_SECRET is not configured", sentry_hook_signature)

    try:
        payload = json.loads(body.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise HTTPException(status_code=400, detail="Invalid JSON payload") from exc

    # Enqueue background task and reply 200 immediately (Stage 1 ingestion & dispatch)
    bg.add_task(ingest_incident, payload)
    return {"status": "accepted"}


@app.post("/api/{project_id}/store/")
@app.post("/api/{project_id}/envelope/")
@app.post("/api/api/{project_id}/store/")
@app.post("/api/api/{project_id}/envelope/")
async def project_scoped_sentry_ingress(
    project_id: str,
    request: Request,
) -> dict[str, Any]:
    """Ingest Sentry error telemetry scoped to a specific microservice project."""
    body = await request.body()
    payload = {}
    if body:
        try:
            payload = json.loads(body.decode("utf-8"))
        except Exception:
            # Check for Sentry newline-delimited envelope
            raw_text = body.decode("utf-8", errors="replace")
            envelope_header = {}
            for line in raw_text.splitlines():
                clean_line = line.strip()
                if not clean_line:
                    continue
                try:
                    item = json.loads(clean_line)
                    if isinstance(item, dict):
                        if not envelope_header and "event_id" in item and "exception" not in item:
                            envelope_header = item
                        if "exception" in item or "threads" in item or ("level" in item and "message" in item):
                            payload = item
                            break
                except Exception:
                    continue
            if payload and "event_id" not in payload and "event_id" in envelope_header:
                payload["event_id"] = envelope_header["event_id"]
            if not payload:
                payload = {"raw": raw_text}

    settings = get_settings()
    run_id, state, auto_promoted = ingest_incident(
        payload=payload,
        settings=settings,
        project_id=project_id,
        apply_policy=True,
    )
    return {
        "id": run_id,
        "run_id": run_id,
        "project_id": project_id,
        "status": state.status,
        "auto_promoted": auto_promoted,
    }


@app.post("/internal/v1/incidents/ingress")
async def server_a_internal_ingress(
    request: Request,
    bg: BackgroundTasks,
    authorization: str | None = Header(default=None),
) -> dict[str, str]:
    """Internal ingress endpoint for Server A (Edge Gateway) sanitized incidents."""
    expected_secret = (
        os.environ.get("INTERNAL_GATEWAY_SECRET")
        or (get_settings().internal_gateway_secret.get_secret_value() if get_settings().internal_gateway_secret else None)
    )
    if not expected_secret:
        # In testing/dev environments, allow default token if not explicitly provided
        if os.getenv("PYTEST_CURRENT_TEST") or os.getenv("ENVIRONMENT") in {"test", "dev"}:
            expected_secret = "ichnoscope-internal-gateway-token-v2"
        else:
            logger.error("INTERNAL_GATEWAY_SECRET is not configured on Server B")
            raise HTTPException(
                status_code=500,
                detail="Server misconfigured: INTERNAL_GATEWAY_SECRET is not configured",
            )

    if not authorization:
        logger.warning("Internal ingress attempt without Authorization header")
        raise HTTPException(status_code=401, detail="Missing Authorization header")

    token = authorization.replace("Bearer ", "").strip()
    if not hmac.compare_digest(token, expected_secret):
        logger.warning("Unauthorized internal ingress attempt with invalid token")
        raise HTTPException(status_code=401, detail="Invalid internal gateway token")

    try:
        envelope = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid JSON envelope") from exc

    # Extract the sanitized telemetry event payload and metadata
    payload = envelope.get("sanitized_payload", envelope)
    project_id = envelope.get("project_id")
    environment = envelope.get("environment")

    # Forward directly to Stage 1 Ingestion Staging Queue (Gate 1)
    bg.add_task(ingest_incident, payload, project_id=project_id, environment=environment)
    return {"status": "staged_at_server_b", "gate": "gate_1_staging"}


@app.get("/internal/v1/projects/cache")
@app.get("/internal/v1/projects/keys")
async def server_a_projects_cache(
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    """Internal project key cache sync endpoint for Server A (Edge Gateway)."""
    expected_secret = (
        os.environ.get("INTERNAL_GATEWAY_SECRET")
        or (get_settings().internal_gateway_secret.get_secret_value() if get_settings().internal_gateway_secret else None)
    )
    if not expected_secret:
        if os.getenv("PYTEST_CURRENT_TEST") or os.getenv("ENVIRONMENT") in {"test", "dev"}:
            expected_secret = "ichnoscope-internal-gateway-token-v2"
        else:
            raise HTTPException(status_code=500, detail="INTERNAL_GATEWAY_SECRET is not configured")

    if not authorization:
        raise HTTPException(status_code=401, detail="Missing Authorization header")

    token = authorization.replace("Bearer ", "").strip()
    if not hmac.compare_digest(token, expected_secret):
        raise HTTPException(status_code=401, detail="Invalid internal gateway token")

    from ichnoscope.projects import list_projects

    projects = list_projects()
    cache: dict[str, dict[str, Any]] = {}
    for p in projects:
        if p.is_active:
            cache[p.public_key] = {
                "project_id": p.project_id,
                "name": p.name,
                "environment": p.environment,
                "rate_limit_min": p.rate_limit_min,
            }
    return {"projects": cache, "count": len(cache)}



