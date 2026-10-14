# Ichnoscope API Documentation

| Document Details | Value |
| :--- | :--- |
| **Version** | 2.1.0-PROD |
| **System** | Ichnoscope Autonomous Incident Intelligence Platform |
| **Scope** | Server A (Edge Ingestion Gateway), Inter-Service Bridge, Server B (Control Center Core) |
| **Protocol** | RESTful HTTP/1.1 & HTTP/2 over TLS |

---

## Architecture & API Boundaries Overview

The platform partitions its API surface into three distinct network zones:

```
[ Client Applications / SDKs ]
               │
               │ (Public HTTPS)
               ▼
[ 1. SERVER A: EDGE INGESTION GATEWAY (DMZ) ]
  ├── POST /api/{project_id}/envelope/
  ├── POST /api/{project_id}/store/
  ├── POST /api/v1/telemetry/ingest
  ├── GET  /healthz
  └── GET  /metrics
               │
               │ (Private HTTPS / mTLS / Shared Token)
               ▼
[ 2. INTER-SERVICE INGRESS BRIDGE ]
  └── POST /internal/v1/incidents/ingress
               │
               ▼
[ 3. SERVER B: MAIN CONTROL CENTER & AI CORE ]
  ├── GET   /api/runs
  ├── GET   /api/runs/{run_id}
  ├── POST  /api/runs/{run_id}/gate1/approve
  ├── POST  /api/runs/{run_id}/gate1/dismiss
  ├── POST  /api/runs/{run_id}/gate2/approve
  ├── POST  /api/runs/{run_id}/gate2/reject
  ├── PATCH /api/runs/{run_id}/draft
  ├── GET   /api/policies
  ├── POST  /api/policies
  ├── GET   /api/settings
  └── POST  /api/settings
```

---

# Section 1: Server A - Standalone Edge Telemetry Gateway (Public DMZ)

**Base URL:** `https://telemetry.yourcompany.com:8001`

### 1.1 Ingest Telemetry Envelope (Sentry v8+ Compatible)
Accepts modern chunked multipart Sentry envelope payloads.

* **Method:** `POST`
* **Route:** `/api/{project_id}/envelope/`
* **Headers:**
  | Header | Type | Required | Description |
  | :--- | :--- | :--- | :--- |
  | `X-Sentry-Auth` | String | Conditional | `Sentry sentry_version=7, sentry_key=<PUBLIC_KEY>, sentry_client=sentry.javascript/7.0` |
  | `X-Ignoscope-Token` | String | Conditional | Custom project secret or public key (alternative to `X-Sentry-Auth`) |
  | `Content-Type` | String | Yes | `application/x-sentry-envelope` or `application/json` |

* **Request Body Limits:**
  * Maximum payload size: strictly $\le 50\text{ KB}$ (`51,200 bytes`).
  * Request stream timeout: `2.5 seconds` (Slowloris defense).

* **Response:**
  * **Status:** `202 Accepted`
  * **Content-Type:** `application/json`
  ```json
  {
    "id": "e4b9c1d802fa",
    "status": "accepted"
  }
  ```

---

### 1.2 Ingest Telemetry Store (Sentry v7 Compatible)
Accepts standard Sentry JSON crash payloads.

* **Method:** `POST`
* **Route:** `/api/{project_id}/store/`
* **Request Body Example:**
  ```json
  {
    "event_id": "9b1deb4d3b7d4bad9bdd2b0d7b3dcb6d",
    "timestamp": "2026-10-14T23:30:00Z",
    "platform": "python",
    "environment": "production",
    "release": "f2a89c01b34e56d7",
    "exception": {
      "values": [
        {
          "type": "KeyError",
          "value": "payment_token",
          "stacktrace": {
            "frames": [
              {
                "filename": "services/payment.py",
                "lineno": 142,
                "function": "process_charge",
                "in_app": true
              }
            ]
          }
        }
      ]
    },
    "tags": {
      "service": "billing-api"
    }
  }
  ```
* **Response:** `202 Accepted` (`{"id": "9b1deb4d3b7d4bad9bdd2b0d7b3dcb6d", "status": "accepted"}`)

---

### 1.3 Ingest Telemetry (Native Ignoscope Format)
Direct JSON endpoint for lightweight client agents without SDKs.

* **Method:** `POST`
* **Route:** `/api/v1/telemetry/ingest`
* **Headers:**
  | Header | Type | Required | Description |
  | :--- | :--- | :--- | :--- |
  | `X-Ignoscope-Token` | String | Yes | Valid project telemetry token |
  | `Content-Type` | String | Yes | `application/json` |

* **Request Body Example:**
  ```json
  {
    "event_id": "crash_8712a",
    "environment": "production",
    "release_sha": "d8e9f1a2",
    "error_type": "DatabaseConnectionTimeout",
    "message": "Connection to replica pool timed out after 5000ms",
    "file_path": "db/pool.py",
    "line_number": 88
  }
  ```
* **Response:** `202 Accepted`

---

### 1.4 Edge Health & Operational Metrics

#### `GET /healthz`
* **Purpose:** High-frequency liveness check for edge load balancers.
* **Response:** `200 OK`
  ```json
  {
    "status": "healthy",
    "zone": "DMZ",
    "node": "server-a-gateway"
  }
  ```

#### `GET /metrics`
* **Purpose:** Edge operational status and configured perimeter quotas.
* **Response:** `200 OK`
  ```json
  {
    "status": "active",
    "zone": "DMZ (Server A)",
    "guards": [
      "tls_termination",
      "slowloris_timeout_2.5s",
      "body_ceiling_50kb",
      "anti_sqli_rce",
      "leaky_bucket_rate_limiter",
      "dlp_pii_scrubber"
    ],
    "limits": {
      "max_body_bytes": 51200,
      "ip_limit_per_min": 60,
      "project_limit_per_min": 120
    }
  }
  ```

---

### 1.5 Edge Error Responses & Security Interceptions

| Status Code | Error Reason | Response Body Example |
| :---: | :--- | :--- |
| **`400 Bad Request`** | SQLi / RCE / JSON Depth (>10) breach | `{"detail": "Malicious SQL injection pattern detected in telemetry payload."}` |
| **`401 Unauthorized`** | Missing or unapproved Project Key | `{"detail": "Missing telemetry authentication key or DSN identifier."}` |
| **`408 Request Timeout`** | Slowloris / Client read timeout (>2.5s)| `{"detail": "Request read timeout (2.5s). Connection dropped by edge shield."}` |
| **`413 Payload Too Large`** | Request body exceeds 50KB | `{"detail": "Payload stream exceeded hard 50KB limit (55011 bytes)."}` |
| **`429 Too Many Requests`** | IP or Project Rate limit exceeded | `{"error": "Too Many Requests from this IP"}` *(Headers include `Retry-After: 45`)* |

---

# Section 2: Inter-Service Ingress Bridge (Server A $\rightarrow$ Server B)

**Base URL:** Internal VPC / Protected Network (`https://core.internal.yourcompany.com`)

### 2.1 Forward Sanitized Incident Event
Delivers sanitized, pre-validated telemetry from Server A directly to Server B's staging inbox.

* **Method:** `POST`
* **Route:** `/internal/v1/incidents/ingress`
* **Security & Headers:**
  | Header | Type | Required | Description |
  | :--- | :--- | :--- | :--- |
  | `Authorization` | String | Yes | `Bearer <INTERNAL_GATEWAY_SECRET>` |
  | `X-Gateway-Node` | String | Yes | Host identifier (e.g., `edge-gateway-node-01`) |
  | `Content-Type` | String | Yes | `application/json` |

* **Request Body Schema:**
  ```json
  {
    "gateway_received_at": 1728948000.125,
    "project_id": "proj_prod_billing",
    "environment": "production",
    "client_ip_hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "sanitized_payload": {
      "event_id": "9b1deb4d3b7d4bad9bdd2b0d7b3dcb6d",
      "timestamp": "2026-10-14T23:30:00Z",
      "release": "f2a89c01b34e56d7",
      "exception": {
        "values": [
          {
            "type": "KeyError",
            "value": "[REDACTED:secret_literal] in services/payment.py",
            "stacktrace": { ... }
          }
        ]
      }
    }
  }
  ```

* **Server B Behavior:**
  1. Validates `Bearer` token against configured `settings.internal_gateway_secret`.
  2. Creates a run record with status **`staged_raw` (Gate 1)**.
  3. Evaluates automation policies. If an auto-approve rule matches, promotes to **`analyzing`**.
* **Response:**
  * **Status:** `200 OK`
  ```json
  {
    "run_id": "run-e4b9c1d8",
    "status": "staged_raw",
    "auto_promoted": false
  }
  ```

---

# Section 3: Server B - Control Center Core REST APIs

**Base URL:** `https://dashboard.yourcompany.com` (or `http://localhost:8000`)

### 3.1 Runs & Incidents Management

#### `GET /api/runs`
List recent incident triage runs across the platform with filtering for the staging board.

* **Query Parameters:**
  | Parameter | Type | Required | Default | Description |
  | :--- | :--- | :--- | :--- | :--- |
  | `status` | String | No | None | Filter by status: `staged_raw`, `analyzing`, `staged_draft`, `published`, `dismissed` |
  | `severity` | String | No | None | Filter by severity: `P1-Critical`, `P2-High`, `P3-Medium` |
  | `limit` | Integer | No | 50 | Maximum number of records to return |

* **Response:** `200 OK`
  ```json
  [
    {
      "id": "run-e4b9c1d8",
      "status": "staged_raw",
      "severity": "P1-Critical",
      "fingerprint": "a17f8b90c12e",
      "is_regression": false,
      "issue_url": null,
      "incident": {
        "exception_type": "KeyError",
        "error_message": "payment_token",
        "file_path": "services/payment.py",
        "line_number": 142,
        "environment": "production",
        "event_count": 3
      },
      "culprit": null,
      "explanation": null,
      "logs_count": 2
    }
  ]
  ```

#### `GET /api/runs/{run_id}`
Retrieve complete state, blame culprit, LLM explanation, and step-by-step audit logs for a run.

* **Response:** `200 OK`
  ```json
  {
    "id": "run-e4b9c1d8",
    "status": "staged_draft",
    "severity": "P1-Critical",
    "fingerprint": "a17f8b90c12e",
    "incident": { ... },
    "culprit": {
      "sha": "a1b2c3d4e5f67890",
      "author_login": "johndoe",
      "author_name": "John Doe",
      "message": "Refactor payment token storage",
      "confidence": "high",
      "diff": "@@ -140,4 +140,4 @@\n- token = req.get('token')\n+ token = req['payment_token']"
    },
    "explanation": {
      "domain": "backend",
      "root_cause_hypothesis": "The commit replaced safe dictionary get() with direct key lookup for payment_token.",
      "checklist": [
        "Verify if older client versions still submit the legacy token key",
        "Add fallback to req.get('token')",
        "Add integration test verifying checkout without payment_token"
      ]
    },
    "logs": [
      "[INFO] gateway: Ingested payload from Server A",
      "[INFO] parse: Extracted KeyError at services/payment.py:142",
      "[INFO] blame: Culprit commit identified: a1b2c3d by @johndoe",
      "[INFO] explain: LLM root cause synthesized via Gemini Flash"
    ]
  }
  ```

---

### 3.2 Gate 1 Operations (Ingestion Staging)

#### `POST /api/runs/{run_id}/gate1/approve`
Approve a raw crash to begin deep investigation. Triggers frame parsing, Git blame, and LLM explanation.

* **Request Body:**
  ```json
  {
    "reviewer": "oncall-engineer@company.com",
    "notes": "Legitimate crash reported after v2.4 deployment"
  }
  ```
* **Response:** `200 OK`
  ```json
  {
    "id": "run-e4b9c1d8",
    "status": "analyzing",
    "message": "Investigation pipeline enqueued successfully."
  }
  ```

#### `POST /api/runs/{run_id}/gate1/dismiss`
Dismiss a raw incident without spending AI tokens or calling GitHub APIs.

* **Request Body:**
  ```json
  {
    "reviewer": "oncall-engineer@company.com",
    "reason": "Known flaky network timeout during database migration"
  }
  ```
* **Response:** `200 OK` (`{"status": "dismissed"}`)

---

### 3.3 Gate 2 Operations (Draft Issue Publishing)

#### `POST /api/runs/{run_id}/gate2/approve`
Sign off on an AI-synthesized incident draft and publish it directly to GitHub.

* **Request Body:**
  ```json
  {
    "reviewer": "lead-architect@company.com",
    "custom_assignee": "johndoe"
  }
  ```
* **Response:** `200 OK`
  ```json
  {
    "id": "run-e4b9c1d8",
    "status": "published",
    "issue_number": 142,
    "issue_url": "https://github.com/your-org/main-repo/issues/142"
  }
  ```

#### `POST /api/runs/{run_id}/gate2/reject`
Reject and discard an issue draft. Nothing is posted to GitHub.

* **Request Body:**
  ```json
  {
    "reviewer": "lead-architect@company.com",
    "reason": "Blame suspect confidence inconclusive; triaging manually"
  }
  ```
* **Response:** `200 OK` (`{"status": "rejected"}`)

#### `PATCH /api/runs/{run_id}/draft`
Allows human operators to customize the issue title, hypothesis, or checklist before final sign-off.

* **Request Body:**
  ```json
  {
    "draft_title": "[P1] KeyError in services/payment.py:142 affecting checkout",
    "draft_body": "Customized Markdown description for GitHub..."
  }
  ```
* **Response:** `200 OK` (`{"status": "draft_updated"}`)

---

### 3.4 Automation Policies & Settings

#### `GET /api/policies` & `POST /api/policies`
Retrieve or update automated escalation and bypass rules.

* **Payload Example:**
  ```json
  {
    "name": "Production Critical Auto-Escalate",
    "is_active": true,
    "conditions": {
      "environment": "production",
      "severity": "P1-Critical"
    },
    "actions": {
      "gate1": "auto_approve",
      "gate2": "auto_publish",
      "notify_slack": true
    }
  }
  ```

#### `POST /api/notifications/slack/test`
Dispatches an immediate test alert to Slack to verify webhook connectivity.

* **Request Body:**
  ```json
  {
    "webhook_url": "https://hooks.slack.com/services/T00/B00/XXXX"
  }
  ```
* **Response:** `200 OK` (`{"ok": true, "message": "Test notification delivered to Slack successfully!"}`)
