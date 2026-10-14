"""FastAPI webhook gateway and service entrypoint for Ichnoscope."""

import hashlib
import hmac
import json
import logging

from fastapi import BackgroundTasks, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

from ichnoscope.api import router as api_router, serialize_run
from ichnoscope.config import get_settings
from ichnoscope.pipeline import ingest_incident, run_pipeline

logger = logging.getLogger(__name__)

app = FastAPI(
    title="Ichnoscope Server B — Core Orchestration",
    description="Dual-gated incident triage: staging, AI/git orchestration, and dispatch.",
    version="2.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r".*",
    allow_credentials=True,
    allow_methods=["*"],
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
        else "ichnoscope-internal-gateway-token-v2"
    )
    if authorization:
        token = authorization.replace("Bearer ", "").strip()
        if token != expected_secret:
            logger.warning("Unauthorized internal ingress attempt with token: %s", token[:6] + "...")
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

