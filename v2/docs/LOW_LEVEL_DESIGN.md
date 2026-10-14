# Low-Level Design (LLD): Ichnoscope Incident Intelligence Platform

| Document Information | Details |
| :--- | :--- |
| **System** | Ichnoscope v2.1.0 |
| **Document Classification** | Low-Level Design (LLD) & Technical Implementation Contract |
| **Status** | Approved Specification for Engineering Implementation |
| **Target Codebase** | `backend/ichnoscope/`, `services/gateway/`, `web/` |

---

## 1. Database Architecture & Schema Design (Server B Core)

The persistence layer uses a unified **SQLite / Turso libSQL** driver ([backend/ichnoscope/db.py](file:///d:/Ichnoscope-WCC-30/backend/ichnoscope/db.py)) supporting both local development and distributed cloud deployments.

### 1.1 Entity-Relationship (ER) Model

```
+------------------+         +--------------------+         +--------------------+
|  project_keys    |         |        runs        | 1    N  |     run_logs       |
+------------------+         +--------------------+<--------+--------------------+
| project_id (PK)  |         | id (PK)            |         | id (PK)            |
| name             |         | fingerprint (FK)   |         | run_id (FK)        |
| public_key (UQ)  |         | status             |         | step               |
| secret_key       |         | severity           |         | level              |
| rate_limit_min   |         | is_regression      |         | message            |
| environment      |         | issue_url          |         | timestamp          |
| is_active        |         | raw_payload        |         +--------------------+
+------------------+         | state_json         |
                             | draft_title        |         +--------------------+
                             | draft_body         | 1    N  |    gate_reviews    |
                             | created_at         |<--------+--------------------+
                             | updated_at         |         | id (PK)            |
                             +--------------------+         | run_id (FK)        |
                                       │                    | gate ('gate1'|'2') |
                                       │                    | action ('approve') |
                                       ▼ 1                  | reviewer           |
                             +--------------------+         | notes              |
                             |        seen        |         | created_at         |
                             +--------------------+         +--------------------+
                             | fp (PK)            |
                             | issue_number       |
                             | count              |
                             | first_seen         |
                             | last_seen          |
                             | last_comment_at    |
                             +--------------------+
```

### 1.2 Database Schema DDL (`ichnoscope_runs.db`)

```sql
-- 1. Project Keys & Telemetry Sensor Config
CREATE TABLE IF NOT EXISTS project_keys (
    project_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    public_key TEXT UNIQUE NOT NULL,
    secret_key TEXT NOT NULL,
    rate_limit_min INTEGER DEFAULT 120,
    environment TEXT DEFAULT 'production',
    is_active INTEGER DEFAULT 1,
    created_at REAL NOT NULL
);

-- 2. Incident Runs Table (Updated with Dual-Gate Staging Fields)
CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    fingerprint TEXT NOT NULL,
    status TEXT NOT NULL,           -- 'staged_raw', 'analyzing', 'staged_draft', 'published', 'dismissed', 'rejected', 'failed', 'suppressed'
    severity TEXT,                  -- 'P1-Critical', 'P2-High', 'P3-Medium'
    is_regression INTEGER DEFAULT 0,
    issue_url TEXT,
    draft_title TEXT,               -- Allows human overrides in Gate 2
    draft_body TEXT,                -- Allows human overrides in Gate 2
    raw_payload TEXT NOT NULL,      -- Clean sanitized payload from Server A
    state_json TEXT NOT NULL,       -- Serialized RunState model
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);

-- 3. Gate Auditing Table (Tracks human decisions at Gate 1 and Gate 2)
CREATE TABLE IF NOT EXISTS gate_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    gate TEXT NOT NULL CHECK(gate IN ('gate1', 'gate2')),
    action TEXT NOT NULL CHECK(action IN ('approve', 'dismiss', 'reject', 'auto_promoted')),
    reviewer TEXT NOT NULL,         -- 'admin', user email, or 'policy:production_p1'
    notes TEXT,
    created_at REAL NOT NULL,
    FOREIGN KEY(run_id) REFERENCES runs(id) ON DELETE CASCADE
);

-- 4. Deduplication & Storm Counter Table
CREATE TABLE IF NOT EXISTS seen (
    fp TEXT PRIMARY KEY,
    issue_number INTEGER,
    count INTEGER NOT NULL DEFAULT 1,
    first_seen REAL NOT NULL,
    last_seen REAL NOT NULL,
    last_comment_at REAL
);

-- 5. Detailed Step Execution Logs
CREATE TABLE IF NOT EXISTS run_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    step TEXT NOT NULL,             -- 'gateway', 'parse', 'dedupe', 'blame', 'explain', 'severity', 'dispatch'
    level TEXT NOT NULL,            -- 'INFO', 'WARN', 'ERROR'
    message TEXT NOT NULL,
    timestamp REAL NOT NULL,
    FOREIGN KEY(run_id) REFERENCES runs(id) ON DELETE CASCADE
);

-- 6. Dynamic Automation Policies Table
CREATE TABLE IF NOT EXISTS automation_policies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    rule_json TEXT NOT NULL,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);

-- Performance Optimization Indexes
CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
CREATE INDEX IF NOT EXISTS idx_runs_updated ON runs(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_gate_reviews_run ON gate_reviews(run_id, gate);
CREATE INDEX IF NOT EXISTS idx_logs_run_id ON run_logs(run_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_seen_count ON seen(count DESC);
```

### 1.3 Database Migration Script (`ichnoscope_runs_v2.sql`)

```python
def migrate_to_v2(conn):
    """Safely apply schema enhancements without data loss."""
    cursor = conn.cursor()
    # Check if runs table needs draft columns
    cursor.execute("PRAGMA table_info(runs);")
    columns = [row[1] for row in cursor.fetchall()]
    
    if "draft_title" not in columns:
        cursor.execute("ALTER TABLE runs ADD COLUMN draft_title TEXT;")
    if "draft_body" not in columns:
        cursor.execute("ALTER TABLE runs ADD COLUMN draft_body TEXT;")
        
    # Create new auxiliary tables
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS gate_reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        gate TEXT NOT NULL,
        action TEXT NOT NULL,
        reviewer TEXT NOT NULL,
        notes TEXT,
        created_at REAL NOT NULL
    );
    """)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS automation_policies (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        is_active INTEGER DEFAULT 1,
        rule_json TEXT NOT NULL,
        created_at REAL NOT NULL,
        updated_at REAL NOT NULL
    );
    """)
    conn.commit()
```

---

## 2. API Endpoint Design & Specifications

The API architecture is explicitly segregated into three distinct boundary contracts:
1. **Part A:** Server A Public Edge Ingestion APIs (Client $\rightarrow$ Server A)
2. **Part B:** Inter-Service Ingress API (Server A $\rightarrow$ Server B)
3. **Part C:** Server B Control Center Operational REST APIs (Web UI $\rightarrow$ Server B)

---

### Part A: Server A Public Edge Ingestion APIs (DMZ)

#### A.1 `POST /api/{project_id}/envelope/`
Accepts Sentry v8+ modern multipart envelopes.

* **Headers:**
  * `Content-Type`: `application/x-sentry-envelope`
  * `X-Sentry-Auth`: `Sentry sentry_version=7, sentry_key=<PUBLIC_KEY>, sentry_client=sentry.javascript.browser/7.0.0`
* **Guardrails Applied:**
  * Request body capped at 50KB.
  * Public key matched against cached `project_keys`.
  * Rate limiter check (60 req/min per IP, 120 req/min per Project).
  * Payload unpacked, PII sanitized via `redact.py`.
* **Response:**
  * `202 Accepted`
  ```json
  {
    "id": "e4b9c1d802fa",
    "status": "accepted"
  }
  ```
* **Failure Responses:**
  * `401 Unauthorized`: Missing or invalid public key.
  * `413 Payload Too Large`: Payload exceeds 50KB ceiling.
  * `429 Too Many Requests`: Project or IP rate limit exceeded.

#### A.2 `POST /api/{project_id}/store/`
Accepts standard Sentry JSON payloads.
* **Headers:**
  * `Content-Type`: `application/json`
  * `X-Sentry-Auth`: `Sentry sentry_key=<PUBLIC_KEY>`
* **Response:** `202 Accepted`

#### A.3 `POST /api/v1/telemetry/ingest`
Accepts custom native Ignoscope JSON payloads.
* **Headers:**
  * `Content-Type`: `application/json`
  * `X-Ignoscope-Token`: `<PROJECT_PUBLIC_OR_SECRET_KEY>`
* **Response:** `202 Accepted`

#### A.4 `GET /healthz` & `GET /metrics`
* Returns uptime status, active rate-limiter bucket count, and processed event counters.

---

### Part B: Inter-Service Ingress API (Server A $\rightarrow$ Server B)

#### B.1 `POST /internal/v1/incidents/ingress`
Secure internal endpoint on Server B accepting verified and sanitized payloads from Server A.

* **Headers:**
  * `Authorization`: `Bearer <INTERNAL_GATEWAY_SHARED_SECRET>`
  * `X-Gateway-Node`: `gateway-edge-01`
  * `Content-Type`: `application/json`
* **Request Body Schema:**
  ```json
  {
    "gateway_received_at": 1728948000.125,
    "project_id": "proj_prod_billing",
    "environment": "production",
    "client_ip_hash": "e3b0c44298fc",
    "sanitized_payload": {
      "event_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
      "timestamp": "2026-10-14T23:30:00Z",
      "release": "a1b2c3d4e5f6",
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
      }
    }
  }
  ```
* **Processing on Server B:**
  1. Validates `Bearer` token against `settings.internal_gateway_secret`.
  2. Creates new run record in `runs` with `status = "staged_raw"`.
  3. Evaluates active `automation_policies`:
     * If policy matches (e.g. `Auto-Approve Prod P1`), triggers async worker immediately.
     * Otherwise, holds in Gate 1 queue awaiting human review.
* **Response:**
  ```json
  {
    "run_id": "run-e4b9c1d8",
    "status": "staged_raw",
    "auto_promoted": false
  }
  ```

---

### Part C: Server B Control Center Operational APIs

#### C.1 `GET /api/runs`
Lists triage runs with filtering for the multi-stage board.
* **Query Parameters:**
  * `status`: Optional filter (`staged_raw`, `analyzing`, `staged_draft`, `published`, `dismissed`)
  * `severity`: Optional filter (`P1-Critical`, `P2-High`, `P3-Medium`)
  * `limit`: Integer (default 50)
* **Response:**
  ```json
  [
    {
      "id": "run-e4b9c1d8",
      "status": "staged_raw",
      "severity": "P1-Critical",
      "fingerprint": "fp_8a7c1b",
      "exception_type": "KeyError",
      "error_message": "payment_token",
      "file_path": "services/payment.py",
      "line_number": 142,
      "environment": "production",
      "created_at": 1728948000.125
    }
  ]
  ```

#### C.2 `POST /api/runs/{run_id}/gate1/approve`
Promotes a raw incident from Gate 1 to the AI Orchestration Pipeline.
* **Headers:** `Authorization: Bearer <ADMIN_OR_SESSION_TOKEN>`
* **Request Body:**
  ```json
  {
    "reviewer": "alice@company.com",
    "notes": "Legitimate payment crash identified in v2.4 rollout"
  }
  ```
* **Actions:**
  1. Updates `runs.status` to `analyzing`.
  2. Inserts audit record into `gate_reviews`.
  3. Enqueues background worker: `execute_investigation(run_id)`.
* **Response:**
  ```json
  {
    "id": "run-e4b9c1d8",
    "status": "analyzing",
    "message": "AI investigation pipeline enqueued successfully."
  }
  ```

#### C.3 `POST /api/runs/{run_id}/gate1/dismiss`
Dismisses a raw incident as noise or spam without calling AI models.
* **Request Body:**
  ```json
  {
    "reviewer": "alice@company.com",
    "reason": "Known flaky network timeout; will be fixed in infrastructure refresh."
  }
  ```
* **Actions:** Updates status to `dismissed`, records audit entry. Zero AI tokens spent.

#### C.4 `POST /api/runs/{run_id}/gate2/approve`
Approves an AI-generated draft issue and publishes it to GitHub.
* **Request Body:**
  ```json
  {
    "reviewer": "bob@company.com",
    "custom_assignee": "octocat",
    "title_override": null,
    "body_override": null
  }
  ```
* **Actions:**
  1. Calls GitHub REST API `POST /repos/{owner}/{repo}/issues`.
  2. Attaches GitHub issue number to deduplication table `seen`.
  3. Dispatches Slack alert card.
  4. Updates status to `published`.
* **Response:**
  ```json
  {
    "id": "run-e4b9c1d8",
    "status": "published",
    "issue_number": 142,
    "issue_url": "https://github.com/company/repo/issues/142"
  }
  ```

#### C.5 `POST /api/runs/{run_id}/gate2/reject`
Rejects a drafted issue without creating a GitHub issue.
* **Request Body:**
  ```json
  {
    "reviewer": "bob@company.com",
    "reason": "Incorrect blame suspect; will triage manually."
  }
  ```
* **Actions:** Updates status to `rejected`, records audit entry.

#### C.6 `PATCH /api/runs/{run_id}/draft`
Allows human operators to edit the AI-generated issue title, hypothesis, or checklist before publishing.
* **Request Body:**
  ```json
  {
    "draft_title": "[P1] KeyError: 'payment_token' in services/payment.py:142",
    "draft_body": "Updated root cause analysis text..."
  }
  ```

#### C.7 `GET /api/policies` & `POST /api/policies`
Retrieves or updates the automation policy rules (e.g., auto-promoting Gate 1 for P1 incidents).

---

## 3. Algorithmic Specifications & Implementation Logic

### 3.1 Rate Limiting Algorithm (Token Bucket with Burst Control)

```python
class TokenBucketLimiter:
    """In-memory thread-safe token bucket with sliding decay for Server A."""
    
    def __init__(self, capacity: int, fill_rate_per_sec: float):
        self.capacity = capacity
        self.fill_rate = fill_rate_per_sec
        self.tokens = float(capacity)
        self.last_updated = time.monotonic()
        self.lock = threading.Lock()

    def allow(self) -> bool:
        with self.lock:
            now = time.monotonic()
            elapsed = now - self.last_updated
            self.last_updated = now
            # Replenish tokens based on elapsed time
            self.tokens = min(self.capacity, self.tokens + elapsed * self.fill_rate)
            if self.tokens >= 1.0:
                self.tokens -= 1.0
                return True
            return False
```

### 3.2 Anti-Attack & WAF Inspection Pipeline

```python
def inspect_and_sanitize(body_bytes: bytes) -> dict:
    """Execute multi-tier attack vector defense on incoming raw payload."""
    # 1. Hard Size Check
    if len(body_bytes) > 51200:  # 50KB
        raise PayloadTooLargeError("Payload exceeds 50KB ceiling")

    # 2. Parse JSON with depth check
    try:
        raw_text = body_bytes.decode("utf-8")
        data = json.loads(raw_text)
    except Exception as exc:
        raise MalformedPayloadError("Invalid JSON encoding") from exc

    # 3. Nesting Depth Validator
    def _check_depth(obj, depth=1):
        if depth > 10:
            raise AttackPatternError("Exceeded max JSON nesting depth (10)")
        if isinstance(obj, dict):
            for v in obj.values():
                _check_depth(v, depth + 1)
        elif isinstance(obj, list):
            for item in obj:
                _check_depth(item, depth + 1)

    _check_depth(data)

    # 4. DLP & PII Redaction
    sanitized_text = redact(raw_text)
    return json.loads(sanitized_text)
```

---

## 4. Codebase Architecture & Required Modifications

### 4.1 Modifications in Existing Files

| File Path | Nature of Change | Implementation Details |
| :--- | :--- | :--- |
| [backend/ichnoscope/models.py](file:///d:/Ichnoscope-WCC-30/backend/ichnoscope/models.py) | **Update Model** | Add `staged_raw`, `analyzing`, `staged_draft`, `dismissed` to `RunStatus`. Add `GateApproval` model and draft override fields in `RunState`. |
| [backend/ichnoscope/pipeline.py](file:///d:/Ichnoscope-WCC-30/backend/ichnoscope/pipeline.py) | **Refactor Logic** | Split monolithic `run_pipeline()` into 3 modular sub-routines: `stage_raw_incident()`, `execute_investigation()`, and `publish_draft_issue()`. |
| [backend/ichnoscope/api.py](file:///d:/Ichnoscope-WCC-30/backend/ichnoscope/api.py) | **Add Endpoints** | Add `/internal/v1/incidents/ingress`, `/runs/{id}/gate1/approve`, `/runs/{id}/gate1/dismiss`, `/runs/{id}/gate2/approve`, `/runs/{id}/gate2/reject`, `/runs/{id}/draft`. |
| [backend/ichnoscope/db.py](file:///d:/Ichnoscope-WCC-30/backend/ichnoscope/db.py) | **Update DDL** | Add `gate_reviews`, `automation_policies`, `project_keys` tables and migration helper. |
| [backend/ichnoscope/store.py](file:///d:/Ichnoscope-WCC-30/backend/ichnoscope/store.py) | **Add Queries** | Add `record_gate_review()`, `update_run_draft()`, and filtering queries by gate status. |
| [web/src/app/app/runs/page.tsx](file:///d:/Ichnoscope-WCC-30/web/src/app/app/runs/page.tsx) | **Update UI** | Upgrade runs view into a dual-stage review board: Tab 1 (Raw Inbox - Gate 1), Tab 2 (Draft Review - Gate 2), Tab 3 (Published). |
| [web/src/components/ActionBar.tsx](file:///d:/Ichnoscope-WCC-30/web/src/components/ActionBar.tsx) | **Update UI** | Provide dynamic actions matching current gate: Gate 1 shows `[Approve for AI]` / `[Dismiss]`; Gate 2 shows `[Publish to GitHub]` / `[Reject]`. |

### 4.2 New Standalone Service Structure (Server A Gateway)

```
services/gateway/
├── __init__.py
├── main.py          # FastAPI application for Server A
├── config.py        # Gateway settings (PORT, INTERNAL_BRIDGE_URL, BRIDGE_SECRET)
├── limiter.py       # Leaky-bucket and IP throttle algorithms
├── validator.py     # DSN token parsing and 50KB body size enforcement
├── Dockerfile       # Lightweight Alpine container (<50MB footprint)
└── requirements.txt # Minimal dependencies: fastapi, uvicorn, httpx, pydantic
```
