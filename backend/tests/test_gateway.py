"""Unit tests for backend/ichnoscope/main.py and backend/ichnoscope/api.py."""

import hashlib
import hmac
import json
from pathlib import Path

from fastapi.testclient import TestClient
from ichnoscope.main import app, verify_signature
from ichnoscope.models import Incident, RunState
from ichnoscope.store import save_run

client = TestClient(app)


def _compute_sig(body: bytes, secret: str) -> str:
    return hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()


def test_healthz():
    resp = client.get("/healthz")
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}


def test_verify_signature():
    secret = "secret-key-123"
    body = b'{"hello": "world"}'
    valid_sig = _compute_sig(body, secret)

    assert verify_signature(body, valid_sig, secret) is True
    assert verify_signature(body, "wrong_sig", secret) is False
    assert verify_signature(body, None, secret) is False
    assert verify_signature(body, valid_sig, None) is False


def test_webhook_sentry_valid(monkeypatch):
    secret = "sentry-secret-999"
    monkeypatch.setenv("SENTRY_CLIENT_SECRET", secret)

    body = json.dumps({"action": "created", "event": {"id": "123"}}).encode("utf-8")
    sig = _compute_sig(body, secret)

    resp = client.post(
        "/webhook/sentry",
        content=body,
        headers={"sentry-hook-signature": sig, "Content-Type": "application/json"},
    )
    assert resp.status_code == 200
    assert resp.json() == {"status": "accepted"}

    # Verify /api/webhook/sentry alias
    resp_alias = client.post(
        "/api/webhook/sentry",
        content=body,
        headers={"sentry-hook-signature": sig, "Content-Type": "application/json"},
    )
    assert resp_alias.status_code == 200
    assert resp_alias.json() == {"status": "accepted"}


def test_webhook_sentry_bad_signature(monkeypatch):
    monkeypatch.setenv("SENTRY_CLIENT_SECRET", "sentry-secret-999")

    body = b'{"test": 1}'
    resp = client.post(
        "/webhook/sentry",
        content=body,
        headers={"sentry-hook-signature": "bad-signature"},
    )
    assert resp.status_code == 401


def test_webhook_sentry_bad_json(monkeypatch):
    secret = "sentry-secret-999"
    monkeypatch.setenv("SENTRY_CLIENT_SECRET", secret)

    body = b"{not-valid-json"
    sig = _compute_sig(body, secret)

    resp = client.post(
        "/webhook/sentry",
        content=body,
        headers={"sentry-hook-signature": sig},
    )
    assert resp.status_code == 400


def test_api_runs_crud(tmp_path: Path, monkeypatch):
    db_file = tmp_path / "api_test.db"
    monkeypatch.setattr("ichnoscope.db.DEFAULT_RUNS_DB", str(db_file))

    # Create dummy run
    inc = Incident(
        incident_id="inc-api-1",
        occurred_at="2026-10-04T12:00:00Z",
        exception_type="KeyError",
        error_message="'token'",
        file_path="src/pay.py",
        line_number=20,
        stack_excerpt="trace",
    )
    state = RunState(
        payload={},
        fingerprint="012345abcdef",
        status="draft_ready",
        incident=inc,
        logs=["Step 1 complete"],
    )
    save_run("run-api-100", state, db_path=db_file)

    # List runs
    resp_list = client.get("/api/runs")
    assert resp_list.status_code == 200
    runs = resp_list.json()
    assert any(r["id"] == "run-api-100" for r in runs)

    # Get single run
    resp_get = client.get("/api/runs/run-api-100")
    assert resp_get.status_code == 200
    assert resp_get.json()["incident"]["exception_type"] == "KeyError"

    # Reject run
    resp_rej = client.post("/api/runs/run-api-100/reject")
    assert resp_rej.status_code == 200
    assert resp_rej.json()["status"] == "rejected"

    # Verify status changed
    resp_after = client.get("/api/runs/run-api-100")
    assert resp_after.json()["status"] == "rejected"


def test_api_approve_run(tmp_path: Path, monkeypatch):
    from ichnoscope.config import get_settings

    db_file = tmp_path / "api_approve.db"
    monkeypatch.setattr("ichnoscope.db.DEFAULT_RUNS_DB", str(db_file))
    monkeypatch.setenv("DRY_RUN", "true")
    monkeypatch.setenv("GITHUB_REPOSITORY", "owner/repo")
    get_settings.cache_clear()

    inc = Incident(
        incident_id="inc-api-2",
        occurred_at="2026-10-04T12:00:00Z",
        exception_type="ValueError",
        error_message="invalid value",
        file_path="src/main.py",
        line_number=10,
        stack_excerpt="trace",
    )
    state = RunState(
        payload={},
        fingerprint="abcdef012345",
        status="draft_ready",
        incident=inc,
    )
    save_run("run-to-approve", state, db_path=db_file)

    resp = client.post("/api/runs/run-to-approve/approve")
    assert resp.status_code == 200
    assert resp.json()["status"] == "published"
    assert resp.json()["issue_number"] == 999


def test_api_settings_and_health():
    resp_settings = client.get("/api/settings")
    assert resp_settings.status_code == 200
    assert "dry_run" in resp_settings.json()

    resp_health = client.get("/api/health")
    assert resp_health.status_code == 200
    assert len(resp_health.json()) in (4, 5)
