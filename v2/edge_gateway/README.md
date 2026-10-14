# ZONE 2: DMZ / Edge Server (Server A) - Standalone Telemetry Gateway

**High-Performance Ingestion Gateway & Security Perimeter Shield for Ichnoscope**

This directory contains the independent, standalone microservice deployed on **Server A (Public Edge / DMZ)**. It acts as the universal crash sensor for client applications, enforces an 8-layer security defense perimeter, strips sensitive PII/secrets, and delivers clean incidents to the internal Core Platform (Server B).

---

## The 8 Perimeter Guardrails

| Layer | Guardrail | Implementation | Protection Target |
| :---: | :--- | :--- | :--- |
| **1** | **TLS Termination & Origin Whitelisting** | `SecurityHeadersMiddleware` | Enforces HSTS, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and strict CORS whitelist. |
| **2** | **Slowloris & DoS Protection** | `read_request_body_with_timeout` | Streams payload with a strict 2.5-second read timeout. Drops stalled or slow HTTP attacks. |
| **3** | **Hard Body Ceiling ($\le 50\text{KB}$)** | `validate_body_size` | Rejects payloads exceeding 50KB immediately with HTTP 413 Payload Too Large. |
| **4** | **Anti-Attack Inspection** | `inspect_payload` | Scans for SQLi (`UNION SELECT`, `--`), RCE tokens (`eval`, `__import__`, `${jndi:`), and limits JSON depth to 10. |
| **5** | **Project Key / DSN Authenticator** | `auth.py` | Validates public key from Sentry DSN, `X-Sentry-Auth`, or `X-Ignoscope-Token`. Rejects invalid keys with HTTP 401. |
| **6** | **Leaky-Bucket Rate Limiter** | `limiter.py` | Enforces 60 req/min per IP and 120 req/min per Project. Returns HTTP 429 with `Retry-After` header. |
| **7** | **Edge DLP & PII Scrubbing** | `redact.py` | Scrubs passwords, bearer tokens, JWTs, AWS credentials, Slack webhooks, and emails before network egress. |
| **8** | **Fast ACK Dispatcher** | `forwarder.py` | Responds to client with `HTTP 202 Accepted` ($< 25\text{ms}$) and defers forwarding to Server B in the background. |

---

## Directory Structure

```
v2/edge_gateway/
├── app.py             # FastAPI entrypoint with security middleware and ingestion routes
├── auth.py            # DSN and Project Key authentication parser
├── config.py          # Environment settings (ports, limits, core ingress URL)
├── forwarder.py       # Asynchronous HTTP bridge forwarding clean payloads to Server B
├── limiter.py         # Thread-safe leaky-bucket rate limiter (IP & Project)
├── redact.py          # Fast DLP regex scrubbing engine for credentials and PII
├── security.py        # WAF attack defense (50KB ceiling, slowloris, SQLi, RCE, JSON depth)
├── test_gateway.py    # Automated test suite validating all 8 security layers
├── Dockerfile         # Hardened non-root Alpine container image (<50MB)
└── requirements.txt   # Minimal pinned dependencies (FastAPI, Uvicorn, HTTPX, Pydantic)
```

---

## Running Standalone

### 1. Local Development
```bash
# Set environment variables
export EDGE_GATEWAY_PORT=8001
export INTERNAL_CORE_URL="http://127.0.0.1:8000/internal/v1/incidents/ingress"
export INTERNAL_GATEWAY_SECRET="ichnoscope-internal-gateway-token-v2"

# Start edge gateway
python -m uvicorn v2.edge_gateway.app:app --host 0.0.0.0 --port 8001 --reload
```

### 2. Standalone Docker Container (Server A)
```bash
docker build -t ichnoscope-edge-gateway:v2 -f v2/edge_gateway/Dockerfile v2/edge_gateway/
docker run -d \
  -p 8001:8001 \
  -e INTERNAL_CORE_URL="https://core.internal.yourcompany.com/internal/v1/incidents/ingress" \
  -e INTERNAL_GATEWAY_SECRET="your-secure-shared-token" \
  --name edge-gateway \
  ichnoscope-edge-gateway:v2
```

---

## Client Application Configuration (GlitchTip / Sentry SDK)

Client applications point directly to Server A without any external SaaS dependencies:

```typescript
import * as Sentry from "@sentry/node";

Sentry.init({
  // Point directly to Server A Edge Gateway
  dsn: "https://sentry_public_key@telemetry.yourcompany.com:8001/1",
  
  // Disable tracing and replay bloat (Raw crash exceptions only)
  tracesSampleRate: 0.0,
  replaysSessionSampleRate: 0.0,
  
  // Attach static scope tags for AI blame and repo correlation
  environment: process.env.NODE_ENV || "production",
  release: process.env.GIT_COMMIT_SHA,
});
```

---

## Automated Verification

Run the test suite to verify all 8 security guardrails:
```bash
pytest v2/edge_gateway/test_gateway.py -v
```
