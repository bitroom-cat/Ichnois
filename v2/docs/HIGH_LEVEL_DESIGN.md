# High-Level Design (HLD): Ichnoscope Upgraded Incident Intelligence Platform

| Document Information | Details |
| :--- | :--- |
| **System** | Ichnoscope v2.1.0 |
| **Document Classification** | High-Level Design (HLD) Specification |
| **Author** | System Architecture & Core Engineering Team |
| **Status** | Approved for Implementation |
| **Target Infrastructure** | Multi-Server Distributed Deployment (Edge DMZ + Core VPC) |

---

## 1. Executive Summary & Problem Formulation

### 1.1 The Operational Bottleneck
In modern production environments, application failures generate immediate telemetry storms. Traditional systems suffer from two fatal extremes:
1. **Unmoderated Automated AI Invocations:** Every incoming trace triggers LLM inference and Git Blame queries immediately. This wastes tokens on transient bot traffic, rate-limit storms, and non-actionable exceptions while exposing infrastructure to runaway API costs.
2. **Missing Ingestion Gate:** Human oversight previously only occurred at the point of publishing a GitHub issue. By that time, Git APIs had been queried, LLM tokens had been spent, and database storage had been consumed.

### 1.2 The Upgraded Architectural Solution
Ichnoscope v2 introduces a **Physically Separated, Dual-Gated Autonomous Architecture**:
* **Standalone Edge Gateway (Server A):** An attack-resistant, lightweight telemetry collector deployed at the network edge. It authenticates Sentry/GlitchTip payloads, defends against DoS and malicious payloads, enforces hard size ceilings ($\le 50\text{ KB}$), scrubs PII/secrets, returns instant `202 Accepted` to clients, and securely forwards clean incidents to Server B.
* **Dual-Gated Staging Pipeline (Server B):**
  * **Gate 1 (Ingestion Staging):** Errors arrive and are staged first as `staged_raw`. No AI models or Git blame APIs run until human sign-off (or automated policy rules) authorize them.
  * **Core Orchestration:** Deterministic stack frame normalization, SHA-256 fingerprinting, GitHub GraphQL blame correlation, and multi-provider LLM root-cause synthesis.
  * **Gate 2 (Draft Issue Staging):** The AI-generated hypothesis, suspect commit diff, and checklist are staged as `staged_draft` for interactive preview, editing, and publishing sign-off.
* **Policy Control Center:** A centralized governance matrix allowing teams to toggle between **Full Manual**, **Semi-Autonomous**, and **Fully Autonomous** modes globally or by environment and severity.

---

## 2. Physical Deployment Architecture & Network Boundaries

The system is partitioned into two physically distinct server environments separated by a secure network boundary:

```
+----------------------------------------------------------------------------------------------------+
|                                    ZONE 1: CLIENT RUNTIMES                                         |
|                 Client Application (Web Browser, Node.js API, Python Microservice)                  |
|                 SDK: GlitchTip / Sentry Client (tracesSampleRate: 0, beforeSend filter)             |
+----------------------------------------------------------------------------------------------------+
                                                  │
                                                  │ HTTPS POST /api/{project_id}/envelope/
                                                  │ (Public Internet / App VPC)
                                                  ▼
+----------------------------------------------------------------------------------------------------+
|                         ZONE 2: DMZ / EDGE SERVER (SERVER A)                                       |
|               Standalone Ingestion Gateway Microservice (FastAPI / Hardened Reverse Proxy)         |
|                                                                                                    |
|  [Security & Ingestion Perimeter]                                                                 |
|   1. TLS Termination & Origin Whitelisting                                                         |
|   2. Slowloris & DoS Protection (Read timeout: 2.5s)                                               |
|   3. Hard Request Body Ceiling: <= 50KB (HTTP 413 rejection)                                       |
|   4. Anti-Attack Inspection: SQLi, RCE token detection, JSON nesting depth check (max 10)         |
|   5. Project Key / DSN Authenticator: Validates project public key                                 |
|   6. Leaky-Bucket Rate Limiter: Per-IP (60/min) & Per-Project (120/min) limits                     |
|   7. Edge DLP & PII Scrubbing: Sanitizes bearer tokens, JWTs, AWS keys, passwords, emails         |
|   8. Fast ACK Dispatcher: Returns HTTP 202 Accepted (<25ms)                                        |
+----------------------------------------------------------------------------------------------------+
                                                  │
                                                  │ Encrypted HTTPS POST /internal/v1/incidents/ingress
                                                  │ Header: X-Internal-Gateway-Secret / mTLS
                                                  ▼
+----------------------------------------------------------------------------------------------------+
|                       ZONE 3: PROTECTED CORE SERVER (SERVER B)                                     |
|                     Main Control Center, DB & Orchestration Engine                                 |
|                                                                                                    |
|  +----------------------------------------------------------------------------------------------+  |
|  |                             STAGE 1: INGESTION STAGING QUEUE                                 |  |
|  |                Status: `staged_raw` (Pending Gate 1 Review / Zero AI Cost)                   |  |
|  +----------------------------------------------------------------------------------------------+  |
|                                                 │                                                  |
|                        +------------------------+------------------------+                         |
|                        │                                                 │                         |
|                        │ [Manual Mode]                                   │ [Auto-AI Rule Match]    |
|                        ▼                                                 ▼                         |
|  +-------------------------------------------+ +------------------------------------------------+  |
|  |           CONTROL CENTER (GATE 1)         | |              AUTO-DISPATCH ENGINE              |  |
|  |   - Web Operator reviews raw crash inbox  | |   - Rule Match: e.g., Production P1-Critical   |  |
|  |   - [Approve for AI] or [Dismiss/Spam]    | |   - Promotes directly to AI Pipeline           |  |
|  +-------------------------------------------+ +------------------------------------------------+  |
|                        │ (Approved)                                      │                         |
|                        +------------------------+------------------------+                         |
|                                                 │                                                  |
|                                                 ▼                                                  |
|  +----------------------------------------------------------------------------------------------+  |
|  |                                AI & CODE ORCHESTRATION PIPELINE                              |  |
|  | 1. Frame Parser: Normalizes frames, strips build prefixes, finds innermost in-app frame      |  |
|  | 2. Deduplication Engine: Computes SHA-256 fingerprint; counts repeat frequencies             |  |
|  | 3. Blame Correlator: Executes GitHub GraphQL blame at release SHA -> commit, author, diff   |  |
|  | 4. LLM Root-Cause Synthesizer: Structured hypothesis & 3-point verification checklist       |  |
|  | 5. Severity Classifier: Evaluates blast radius, users affected, and error severity           |  |
|  +----------------------------------------------------------------------------------------------+  |
|                                                 │                                                  |
|                                                 ▼                                                  |
|  +----------------------------------------------------------------------------------------------+  |
|  |                               STAGE 2: DRAFT ISSUE STAGING                                   |  |
|  |                Status: `staged_draft` (Pending Gate 2 Review / Interactive Preview)          |  |
|  +----------------------------------------------------------------------------------------------+  |
|                                                 │                                                  |
|                        +------------------------+------------------------+                         |
|                        │                                                 │                         |
|                        │ [Manual / Semi-Auto]                            │ [Full-Auto Mode]        |
|                        ▼                                                 ▼                         |
|  +-------------------------------------------+ +------------------------------------------------+  |
|  |           CONTROL CENTER (GATE 2)         | |              AUTO-PUBLISH ENGINE               |  |
|  |   - Interactive Markdown Preview          | |   - High confidence (>=90%) & P1 Critical      |  |
|  |   - Edit Title, Culprit, Checklist        | |   - Direct publish without human wait          |  |
|  |   - [Approve & Publish] or [Reject]       | +------------------------------------------------+  |
|  +-------------------------------------------+                                   │                 |
|                        │ (Approved)                                              │                 |
|                        +------------------------+--------------------------------+                 |
|                                                 │                                                  |
|                                                 ▼                                                  |
|  +----------------------------------------------------------------------------------------------+  |
|  |                                EXTERNAL DISPATCH & INTEGRATION                               |  |
|  |  - GitHub REST API: Creates structured Issue with commit diff, hypothesis & labels           |  |
|  |  - Slack Webhook: Posts actionable incident alert card with direct links                     |  |
|  +----------------------------------------------------------------------------------------------+  |
|                                                                                                    |
|  [Core Persistence & Dashboard UI]                                                                |
|   - SQLite / Turso libSQL Database (`ichnoscope_runs.db`)                                          |
|   - Next.js Web Dashboard & Operational Control Center                                            |
+----------------------------------------------------------------------------------------------------+
```

---

## 3. High-Level Component Decomposition

### 3.1 Component Responsibilities Matrix

| Component | Host | Primary Role | Technologies |
| :--- | :--- | :--- | :--- |
| **Edge Ingestion Gateway** | Server A | Public telemetry receiver, WAF defense, quota guard, rate limiter, PII redactor. | Python / FastAPI / Uvicorn, httpx |
| **Inter-Service Bridge** | Network | Secure payload transport from Server A to Server B. | HTTPS / mTLS / HMAC Secret Header |
| **Ingress Controller** | Server B | Authenticates payloads from Server A, stages into DB as `staged_raw`. | FastAPI Internal Router |
| **Control Center UI** | Server B | 2-Stage Kanban review board, issue editor, policy management. | Next.js 14, React, Tailwind CSS |
| **AI Orchestrator** | Server B | Frame parsing, Git blame, LLM synthesis, severity scoring. | Python, GitHub GraphQL/REST, LLMs |
| **Persistence Store** | Server B | Storage for runs, logs, fingerprints, policies, and project keys. | SQLite / Turso libSQL |
| **Notification Adapters**| Server B | Dispatches approved tickets to GitHub and Slack alerts. | GitHub REST API, Slack Webhook |

---

## 4. The Dual-Gated Operational Paradigm

The platform divides incident processing into two distinct transactional gates:

```
[ Incoming Telemetry ] ──> [ GATE 1: Ingestion Gate ] ──> [ AI Orchestration ] ──> [ GATE 2: Publishing Gate ] ──> [ GitHub / Slack ]
                                  │                                                      │
                                  ├── Approve ──> (Proceeds to AI)                       ├── Approve ──> (Published)
                                  └── Dismiss ──> (Halted, 0 Tokens)                     └── Reject  ──> (Discarded)
```

### 4.1 Gate 1: Pre-AI Ingestion Gate
* **Objective:** Protect token budget and compute by halting unsolicited, junk, or non-actionable errors.
* **Default State:** `staged_raw`.
* **Human Action:** Operator clicks `[Approve for AI]` to initiate deep investigation or `[Dismiss]` to drop the event.
* **Auto-Bypass:** Configurable automation policies can auto-approve high-priority environments (e.g., `production` with known critical paths).

### 4.2 Gate 2: Post-AI Publishing Gate
* **Objective:** Ensure no AI-generated hallucination or incorrect suspect commit is published to a public repository without validation.
* **Default State:** `staged_draft`.
* **Human Action:** Operator inspects the Markdown preview, edits the generated checklist or issue title if desired, and clicks `[Approve & Publish]` or `[Reject]`.
* **Auto-Bypass:** If `full_autonomous` mode is enabled and LLM culprit confidence $\ge 90\%$, the draft is automatically published.

---

## 5. Control Center Automation Modes

The Control Center provides three distinct automation profiles:

| Mode | Gate 1 Behavior | Gate 2 Behavior | Recommended Environment |
| :--- | :--- | :--- | :--- |
| **Full Manual** | Human approval required to run AI | Human sign-off required to publish | Dev / Staging / High-cost LLM tiers |
| **Semi-Autonomous** *(Standard)* | **Automated** (Auto-promoted to AI) | **Human sign-off required to publish** | Standard Production Environments |
| **Fully Autonomous** | **Automated** | **Automated** (Direct to GitHub) | Critical 24/7 On-Call / High-confidence incidents |

---

## 6. Non-Functional Requirements & System SLAs

### 6.1 Performance & Latency Targets
* **Edge Ingestion Ack (Server A):** $\le 25\text{ ms}$ (HTTP 202 Accepted).
* **Inter-Service Transfer:** $\le 50\text{ ms}$.
* **Complete AI Orchestration (Server B):** $\le 45\text{ seconds}$ from Gate 1 approval to `staged_draft` ready.
* **GitHub Issue Creation:** $\le 2\text{ seconds}$ from Gate 2 sign-off.

### 6.2 Availability & Resilience
* **Edge Gateway Resilience:** Server A operates stateless and continues accepting telemetry even if Server B is temporarily unreachable by spooling up to 1,000 events locally before throttling.
* **Database Fault Tolerance:** Native support for local SQLite with instant failover/replication to cloud-distributed Turso libSQL.
* **LLM Provider Redundancy:** Automatic multi-provider fallback (Gemini Flash $\rightarrow$ Groq $\rightarrow$ OpenRouter $\rightarrow$ Deterministic Evidence Template).

### 6.3 Security & Compliance
* **Zero PII Leakage:** Sensitive keys, JWTs, AWS credentials, and email addresses are stripped on Server A before passing the network boundary.
* **Isolation of Secrets:** Server A holds zero GitHub tokens and zero LLM API keys. Only Server B possesses credentials for external dispatch.
