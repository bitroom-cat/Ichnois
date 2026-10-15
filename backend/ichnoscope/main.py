"""FastAPI webhook gateway and service entrypoint for Ichnoscope."""

import hashlib
import hmac
import json
import logging

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


class DashboardAuthMiddleware(BaseHTTPMiddleware):
    """Enforce Bearer token authorization on /api/* control-plane routes."""

    EXEMPT_PATHS = {
        "/healthz",
        "/webhook/sentry",
        "/api/webhook/sentry",
    }

    async def dispatch(self, request: Request, call_next):
        path = request.url.path

        # 1. Allow CORS OPTIONS preflight unconditionally
        if request.method == "OPTIONS":
            return await call_next(request)

        # 2. Allow exempt public paths or internal gateway routes (which have dedicated HMAC auth)
        if path in self.EXEMPT_PATHS or path.startswith("/internal/v1/"):
            return await call_next(request)

        # 3. Only intercept /api/* routes
        if not path.startswith("/api"):
            return await call_next(request)

        settings = get_settings()
        admin_token = settings.admin_token.get_secret_value() if settings.admin_token else None

        # If admin_token is configured, strictly enforce Bearer token
        if admin_token:
            auth_header = request.headers.get("Authorization")
            if not auth_header:
                return JSONResponse(
                    status_code=401,
                    content={"detail": "Missing Authorization header with Bearer token for Dashboard API"},
                )

            token = auth_header.replace("Bearer ", "").strip()
            if not hmac.compare_digest(token, admin_token):
                logger.warning("Unauthorized access attempt to %s with invalid admin token", path)
                return JSONResponse(
                    status_code=401,
                    content={"detail": "Invalid Admin Bearer token"},
                )
        else:
            enforce_strict = os.getenv("ENFORCE_ADMIN_TOKEN", "false").lower() == "true"
            if enforce_strict:
                return JSONResponse(
                    status_code=401,
                    content={"detail": "ADMIN_TOKEN is required but not configured"},
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
    settings = get_settings()

    secret = settings.sentry_client_secret.get_secret_value() if settings.sentry_client_secret else None
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


@app.post("/internal/v1/incidents/ingress")
async def server_a_internal_ingress(
    request: Request,
    bg: BackgroundTasks,
    authorization: str | None = Header(default=None),
) -> dict[str, str]:
    """Internal ingress endpoint for Server A (Edge Gateway) sanitized incidents."""
    settings = get_settings()
    expected_secret = (
        settings.internal_gateway_secret.get_secret_value()
        if settings.internal_gateway_secret
        else None
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
    settings = get_settings()
    expected_secret = (
        settings.internal_gateway_secret.get_secret_value()
        if settings.internal_gateway_secret
        else None
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



