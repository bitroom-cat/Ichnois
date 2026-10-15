"""ZONE 2: DMZ / EDGE SERVER (SERVER A) Standalone Telemetry Gateway.

Implements the complete 8-layer security perimeter:
1. TLS Termination & Origin Whitelisting
2. Slowloris & DoS Protection (Read timeout: 2.5s)
3. Hard Request Body Ceiling: <= 50KB (HTTP 413)
4. Anti-Attack Inspection: SQLi, RCE token detection, JSON nesting depth check (max 10)
5. Project Key / DSN Authenticator
6. Leaky-Bucket Rate Limiter: Per-IP & Per-Project quotas
7. Edge DLP & PII Scrubbing Layer
8. Fast ACK Dispatcher: HTTP 202 Accepted (<25ms)
"""

import asyncio
import logging
import uuid
from collections.abc import Callable

from fastapi import BackgroundTasks, FastAPI, Header, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from pathlib import Path
import sys

_CURRENT_DIR = str(Path(__file__).resolve().parent)
if _CURRENT_DIR not in sys.path:
    sys.path.insert(0, _CURRENT_DIR)

try:
    from v2.edge_gateway.auth import (
        AuthenticationError,
        authenticate_project_request,
        get_all_cached_keys,
        invalidate_project_key,
        sync_keys_from_server_b,
    )
    from v2.edge_gateway.config import get_gateway_config
    from v2.edge_gateway.forwarder import drain_dlq, forward_to_server_b
    from v2.edge_gateway.limiter import edge_ip_limiter, edge_project_limiter
    from v2.edge_gateway.redact import scrub_pii_and_secrets
    from v2.edge_gateway.security import SecurityPerimeterViolation, inspect_payload
except ImportError:
    from auth import (
        AuthenticationError,
        authenticate_project_request,
        get_all_cached_keys,
        invalidate_project_key,
        sync_keys_from_server_b,
    )
    from config import get_gateway_config
    from forwarder import drain_dlq, forward_to_server_b
    from limiter import edge_ip_limiter, edge_project_limiter
    from redact import scrub_pii_and_secrets
    from security import SecurityPerimeterViolation, inspect_payload

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] [Server-A-Edge] %(message)s")
logger = logging.getLogger("edge_gateway")

config = get_gateway_config()

app = FastAPI(
    title="Ichnoscope Edge Telemetry Gateway (Server A)",
    description="Standalone DMZ Ingestion Gateway & Security Perimeter",
    version="2.1.0",
)


# Layer 1: Origin Whitelisting & Secure Headers Middleware
class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Enforce HSTS, frame protection, and content type sniffing guards."""

    async def dispatch(self, request: Request, call_next: Callable):
        response: Response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response


@app.exception_handler(SecurityPerimeterViolation)
async def security_violation_handler(request: Request, exc: SecurityPerimeterViolation):
    return Response(
        content=f'{{"detail": "{exc.message}"}}',
        status_code=exc.status_code,
        media_type="application/json",
    )


app.add_middleware(SecurityHeadersMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.allowed_origins if "*" not in config.allowed_origins else ["*"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


# Layer 2: Slowloris & Read Timeout Guard
async def read_request_body_with_timeout(request: Request, timeout_seconds: float, max_bytes: int) -> bytes:
    """Read streaming request body with timeout and byte size ceiling to block slowloris attacks."""
    body_chunks = []
    total_bytes = 0

    async def _read_stream():
        nonlocal total_bytes
        async for chunk in request.stream():
            total_bytes += len(chunk)
            if total_bytes > max_bytes:
                raise SecurityPerimeterViolation(
                    f"Payload stream exceeded hard 50KB limit ({total_bytes} bytes).",
                    status_code=413,
                )
            body_chunks.append(chunk)

    try:
        await asyncio.wait_for(_read_stream(), timeout=timeout_seconds)
    except asyncio.TimeoutError as exc:
        logger.warning("Slowloris attack blocked: Client failed to complete transmission within %ss", timeout_seconds)
        raise HTTPException(
            status_code=408,
            detail=f"Request read timeout ({timeout_seconds}s). Connection dropped by edge shield.",
        ) from exc

    return b"".join(body_chunks)


@app.get("/healthz")
def healthz() -> dict[str, str]:
    """Liveness probe for edge orchestrator."""
    return {"status": "healthy", "zone": "DMZ", "node": "server-a-gateway"}


@app.get("/metrics")
def metrics() -> dict[str, object]:
    """Operational telemetry status."""
    return {
        "status": "active",
        "zone": "DMZ (Server A)",
        "guards": [
            "tls_termination",
            "slowloris_timeout_2.5s",
            "body_ceiling_50kb",
            "anti_sqli_rce",
            "leaky_bucket_rate_limiter",
            "dlp_pii_scrubber",
        ],
        "limits": {
            "max_body_bytes": config.max_body_bytes,
            "ip_limit_per_min": config.ip_rate_limit_per_min,
            "project_limit_per_min": config.project_rate_limit_per_min,
        },
    }


from fastapi.responses import HTMLResponse
try:
    from v2.edge_gateway.status_page import HTML_TEMPLATE
except ImportError:
    from status_page import HTML_TEMPLATE


@app.get("/", response_class=HTMLResponse)
@app.get("/status", response_class=HTMLResponse)
@app.get("/live", response_class=HTMLResponse)
def status_testing_dashboard() -> HTMLResponse:
    """Interactive testing cockpit and keep-alive status page."""
    return HTMLResponse(content=HTML_TEMPLATE)


@app.get("/api/ping-core")
async def ping_core_server() -> dict[str, object]:
    """Test connectivity from Server A Edge Gateway to Server B Core Platform."""
    import time
    import httpx

    start = time.monotonic()
    target_url = config.internal_core_url.replace("/internal/v1/incidents/ingress", "/healthz")
    headers = {
        "Authorization": f"Bearer {config.internal_gateway_secret}",
        "X-Gateway-Node": "edge-gateway-ping",
    }

    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            res = await client.get(target_url, headers=headers)
            elapsed_ms = round((time.monotonic() - start) * 1000, 2)
            content_type = res.headers.get("content-type", "")
            data = res.json() if "application/json" in content_type else res.text
            return {
                "reachable": res.is_success,
                "status_code": res.status_code,
                "latency_ms": elapsed_ms,
                "target_url": target_url,
                "core_response": data,
            }
    except Exception as exc:
        elapsed_ms = round((time.monotonic() - start) * 1000, 2)
        return {
            "reachable": False,
            "latency_ms": elapsed_ms,
            "error": str(exc),
            "target_url": target_url,
            "note": "Server B is currently offline or unreachable on the internal network.",
        }


async def _background_sync_worker():
    """Periodically sync active project keys and opportunistically drain DLQ."""
    while True:
        try:
            await asyncio.sleep(30.0)
            sync_keys_from_server_b()
            drain_dlq(max_batch=5)
        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.debug("Background worker pass error: %s", exc)


@app.on_event("startup")
async def on_startup():
    """Initialize background synchronization task on gateway boot."""
    try:
        sync_keys_from_server_b(force=True)
    except Exception:
        pass
    asyncio.create_task(_background_sync_worker())


@app.post("/internal/v1/cache/keys/invalidate")
async def invalidate_key_cache(
    request: Request,
    authorization: str | None = Header(default=None),
) -> dict[str, object]:
    """Instant cache eviction/refresh webhook from Server B."""
    import hmac

    expected_secret = config.internal_gateway_secret
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")
    token = authorization.split("Bearer ", 1)[1].strip()
    if not hmac.compare_digest(token, expected_secret):
        raise HTTPException(status_code=401, detail="Unauthorized")

    body = {}
    try:
        body = await request.json()
    except Exception:
        pass

    action = body.get("action", "sync")
    public_key = body.get("public_key")

    if action == "revoke" and public_key:
        invalidate_project_key(public_key)
        return {"status": "revoked", "public_key": public_key}

    sync_keys_from_server_b(force=True)
    return {"status": "synced", "active_keys": len(get_all_cached_keys())}


# Layer 8: Telemetry Ingestion Endpoints (Sentry / GlitchTip / Native)
@app.post("/api/{project_id}/envelope/")
@app.post("/api/{project_id}/store/")
@app.post("/api/v1/telemetry/ingest")
async def ingest_telemetry(
    request: Request,
    bg: BackgroundTasks,
    project_id: str = "default",
    x_sentry_auth: str | None = Header(default=None),
    x_ignoscope_token: str | None = Header(default=None),
) -> Response:
    """Ingest, validate, sanitize, and fast-ACK telemetry crashes."""
    client_ip = request.client.host if request.client else "127.0.0.1"

    # Layer 5: Project Key / DSN Authenticator
    try:
        project_key = authenticate_project_request(project_id, request, x_sentry_auth, x_ignoscope_token)
    except AuthenticationError as exc:
        logger.warning("Authentication failure from IP %s on project %s: %s", client_ip, project_id, exc)
        raise HTTPException(status_code=401, detail=str(exc)) from exc

    # Resolve project_id if matched from synchronized project cache
    cached_meta = getattr(request.state, "cached_project", None)
    if cached_meta and cached_meta.get("project_id"):
        project_id = cached_meta["project_id"]

    # Layer 6: Leaky-Bucket Rate Limiter (IP & Project)
    ip_check = edge_ip_limiter.check(client_ip)
    if not ip_check.allowed:
        logger.warning("IP rate limit exceeded for %s (retry after %ds)", client_ip, ip_check.retry_after)
        return Response(
            content='{"error": "Too Many Requests from this IP"}',
            status_code=429,
            media_type="application/json",
            headers={"Retry-After": str(ip_check.retry_after)},
        )

    project_check = edge_project_limiter.check(project_id or project_key)
    if not project_check.allowed:
        logger.warning("Project quota exceeded for %s (retry after %ds)", project_id, project_check.retry_after)
        return Response(
            content='{"error": "Project telemetry quota exceeded"}',
            status_code=429,
            media_type="application/json",
            headers={"Retry-After": str(project_check.retry_after)},
        )

    # Layer 2 & 3: Read body under 2.5s timeout with 50KB hard ceiling
    body_bytes = await read_request_body_with_timeout(
        request,
        timeout_seconds=config.read_timeout_seconds,
        max_bytes=config.max_body_bytes,
    )

    # Layer 4: Anti-Attack Inspection (SQLi, RCE, JSON depth check)
    try:
        raw_payload = inspect_payload(
            body_bytes,
            max_bytes=config.max_body_bytes,
            max_depth=config.max_json_depth,
        )
    except SecurityPerimeterViolation as exc:
        logger.warning("Security perimeter violation from %s: %s", client_ip, exc.message)
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc

    # Layer 7: Edge DLP & PII Scrubbing
    sanitized_payload = scrub_pii_and_secrets(raw_payload)

    # Layer 8: Fast ACK (<25ms) + Asynchronous Forwarding to Server B
    event_id = sanitized_payload.get("event_id") or uuid.uuid4().hex[:12]
    environment = sanitized_payload.get("environment") or "production"

    bg.add_task(forward_to_server_b, project_id, environment, client_ip, sanitized_payload)

    return Response(
        content=f'{{"id": "{event_id}", "status": "accepted"}}',
        status_code=202,
        media_type="application/json",
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("v2.edge_gateway.app:app", host=config.host, port=config.port, reload=True)
