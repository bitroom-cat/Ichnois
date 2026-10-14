"""End-to-End Compatibility & Integration Test: Server A (Edge Gateway) <-> Server B (Core Platform).

Validates the complete cross-boundary incident pipeline:
1. Client reports crash to Server A Edge Gateway (/api/1/store/ or /api/v1/telemetry/ingest)
2. Server A authenticates DSN, blocks attacks, scrubs PII, and returns HTTP 202 Accepted
3. Server A forwarder delivers payload to Server B (/internal/v1/incidents/ingress)
4. Server B validates internal secret and stages as `staged_raw` (Gate 1)
5. Control Center approves at Gate 1 -> runs AI blame & root-cause orchestration
6. Incident advances to `staged_draft` (Gate 2) ready for publishing
"""

import sys
import json
from pathlib import Path
from unittest.mock import patch
import pytest
from fastapi.testclient import TestClient

ROOT_DIR = Path(__file__).resolve().parents[2]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from ichnoscope.config import load_settings
from ichnoscope.main import app as server_b_app
from ichnoscope.models import RunState
from ichnoscope.store import get_run, list_runs
from v2.edge_gateway.app import app as server_a_app

server_a_client = TestClient(server_a_app)
server_b_client = TestClient(server_b_app)

FIXTURES_DIR = Path(__file__).resolve().parents[1] / "fixtures"


@pytest.fixture
def clean_test_db(tmp_path: Path, monkeypatch):
    test_db = tmp_path / "e2e_test.db"
    monkeypatch.setattr("ichnoscope.db.DEFAULT_RUNS_DB", str(test_db))
    monkeypatch.setenv("AUTOMATION_MODE", "full_manual")
    from ichnoscope.config import get_settings
    get_settings.cache_clear()
    return str(test_db)


def test_server_a_to_server_b_end_to_end_pipeline(clean_test_db):
    """Verify complete cross-server interoperability: Client -> Server A -> Server B -> Dual-Gate."""
    # 1. Prepare realistic error payload with sensitive credentials
    raw_crash_payload = json.loads((FIXTURES_DIR / "bug1_keyerror_payment.json").read_text(encoding="utf-8"))
    raw_crash_payload["data"]["event"]["environment"] = "staging"
    raw_crash_payload["user"] = {"email": "customer_alice@example.com"}
    raw_crash_payload["request"] = {
        "headers": {
            "Authorization": "Bearer sensitive_customer_secret_token_12345",
            "Cookie": "session_cookie_abc=987654321",
        }
    }

    # 2. Client dispatches to Server A (Edge Gateway)
    headers = {
        "X-Sentry-Auth": "Sentry sentry_version=7, sentry_key=sentry_public_key, sentry_client=sentry.python/1.0",
        "Content-Type": "application/json",
    }

    # We mock Server A's forwarder call to route directly into Server B test client
    forwarded_envelopes = []

    def mock_forward_to_server_b(project_id, environment, client_ip, sanitized_payload):
        envelope = {
            "gateway_received_at": 1728950000.0,
            "project_id": project_id,
            "environment": environment,
            "client_ip_hash": str(hash(client_ip)),
            "sanitized_payload": sanitized_payload,
        }
        forwarded_envelopes.append(envelope)
        # Direct HTTP POST to Server B internal ingress
        ingress_resp = server_b_client.post(
            "/internal/v1/incidents/ingress",
            json=envelope,
            headers={"Authorization": "Bearer ichnoscope-internal-gateway-token-v2"},
        )
        assert ingress_resp.status_code == 200
        return True

    with patch("v2.edge_gateway.app.forward_to_server_b", side_effect=mock_forward_to_server_b):
        res_a = server_a_client.post("/api/1/store/", json=raw_crash_payload, headers=headers)
        assert res_a.status_code == 202
        data_a = res_a.json()
        assert data_a["status"] == "accepted"

    # 3. Verify Server A sanitized the payload before forwarding
    assert len(forwarded_envelopes) == 1
    forwarded = forwarded_envelopes[0]["sanitized_payload"]
    raw_dump = json.dumps(forwarded)
    assert "customer_alice@example.com" not in raw_dump
    assert "[REDACTED:email]" in raw_dump
    assert "sensitive_customer_secret_token" not in raw_dump

    # 4. Verify Server B staged the event as `staged_raw` (Gate 1)
    runs = list_runs(limit=10, db_path=clean_test_db)
    assert len(runs) >= 1
    run_id, state = runs[0]
    assert state.status == "staged_raw"
    assert state.is_gate1_pending is True

    # 5. Operator approves in Control Center at Gate 1
    approve_res = server_b_client.post(
        f"/api/runs/{run_id}/gate1/approve",
        json={"reviewer": "oncall-engineer@company.com", "notes": "Confirmed valid payment crash"},
    )
    assert approve_res.status_code == 200

    # 6. Verify state advanced to Gate 2 (Draft Issue Staging)
    updated_state = get_run(run_id, db_path=clean_test_db)
    assert updated_state.status in ("staged_draft", "draft_ready", "published")
    assert updated_state.culprit is not None
    assert updated_state.explanation is not None


def test_server_a_to_server_b_auto_policy_escalation(tmp_path: Path, monkeypatch):
    """Verify that a Production P1 incident auto-promotes per organization policy."""
    test_db = tmp_path / "auto_test.db"
    monkeypatch.setattr("ichnoscope.db.DEFAULT_RUNS_DB", str(test_db))
    monkeypatch.setenv("AUTOMATION_MODE", "semi_autonomous")
    from ichnoscope.config import get_settings
    get_settings.cache_clear()

    raw_crash_payload = json.loads((FIXTURES_DIR / "bug1_keyerror_payment.json").read_text(encoding="utf-8"))
    raw_crash_payload["data"]["event"]["environment"] = "production"

    headers = {
        "X-Sentry-Auth": "Sentry sentry_version=7, sentry_key=sentry_public_key, sentry_client=sentry.python/1.0",
        "Content-Type": "application/json",
    }

    def mock_forward_to_server_b(project_id, environment, client_ip, sanitized_payload):
        envelope = {
            "gateway_received_at": 1728950000.0,
            "project_id": project_id,
            "environment": environment,
            "client_ip_hash": str(hash(client_ip)),
            "sanitized_payload": sanitized_payload,
        }
        ingress_resp = server_b_client.post(
            "/internal/v1/incidents/ingress",
            json=envelope,
            headers={"Authorization": "Bearer ichnoscope-internal-gateway-token-v2"},
        )
        assert ingress_resp.status_code == 200
        return True

    with patch("v2.edge_gateway.app.forward_to_server_b", side_effect=mock_forward_to_server_b):
        res_a = server_a_client.post("/api/1/store/", json=raw_crash_payload, headers=headers)
        assert res_a.status_code == 202

    runs = list_runs(limit=10, db_path=str(test_db))
    assert len(runs) >= 1
    run_id, state = runs[0]
    # Production Critical rule auto-promotes Gate 1 directly into investigation & staging draft
    assert state.status in ("staged_draft", "draft_ready", "published")


def test_server_b_rejects_unauthorized_gateway_ingress():
    """Verify Server B denies ingress from edge servers presenting incorrect tokens."""
    envelope = {
        "gateway_received_at": 1728950000.0,
        "project_id": "1",
        "sanitized_payload": {"event_id": "bad-ingress-test"},
    }
    # 1. Invalid token
    resp_invalid = server_b_client.post(
        "/internal/v1/incidents/ingress",
        json=envelope,
        headers={"Authorization": "Bearer forged-or-invalid-token"},
    )
    assert resp_invalid.status_code == 401
    assert "Invalid internal gateway token" in resp_invalid.json()["detail"]

    # 2. Correct token
    with patch("ichnoscope.main.ingest_incident") as mock_ingest:
        resp_valid = server_b_client.post(
            "/internal/v1/incidents/ingress",
            json=envelope,
            headers={"Authorization": "Bearer ichnoscope-internal-gateway-token-v2"},
        )
        assert resp_valid.status_code == 200
        assert resp_valid.json()["status"] == "staged_at_server_b"
        assert mock_ingest.called


