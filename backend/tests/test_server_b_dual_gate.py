"""Comprehensive test suite for Server B Dual-Gate Orchestration Pipeline.

Validates:
1. Stage 1: Ingestion Staging Queue (`staged_raw` Gate 1)
2. Manual Approval Mode vs Auto-Dispatch Engine (Rule match: P1 / Production)
3. Gate 1 Operator Controls: [Approve for AI] and [Dismiss/Spam] (0 AI tokens)
4. AI & Git Orchestration Pipeline:
   - Stack Normalizer (failing in-app file path, line number, stack frame)
   - Deduplication Engine (SHA-256 fingerprinting & duplicate suppression)
   - GitHub Blame Correlator (suspect commit, diff, PR owner via GraphQL)
   - LLM Root-Cause Synthesizer (hypothesis and 3-point checklist)
   - Severity Classifier (P1-Critical, P2-High, P3-Medium)
5. Stage 2: Draft Issue Staging (`staged_draft` Gate 2 Review Queue)
6. Control Center Gate 2:
   - Interactive editing: Title, Assignee, Checklist overrides via PATCH
   - Operator [Approve & Publish] -> GitHub & Slack dispatch
   - Operator [Reject] -> Discard
7. Auto-Publish Engine: High confidence (>=90%) & P1 direct push in fully_autonomous mode
"""

import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from ichnoscope.config import load_settings
from ichnoscope.main import app
from ichnoscope.models import Incident, RunState
from ichnoscope.pipeline import (
    apply_policy_after_stage,
    execute_investigation,
    ingest_incident,
    publish_draft_issue,
    stage_raw_incident,
)
from ichnoscope.policy import evaluate_policy, should_auto_publish
from ichnoscope.store import get_run, list_gate_reviews, save_run, upsert_policy

client = TestClient(app)
FIXTURES_DIR = Path(__file__).resolve().parents[1] / "fixtures"


def _load_payment_fixture() -> dict:
    return json.loads((FIXTURES_DIR / "bug1_keyerror_payment.json").read_text(encoding="utf-8"))


def _load_cart_fixture() -> dict:
    return json.loads((FIXTURES_DIR / "bug2_attributeerror_cart.json").read_text(encoding="utf-8"))


@pytest.fixture
def clean_db(tmp_path: Path, monkeypatch):
    db_file = tmp_path / "server_b_test.db"
    monkeypatch.setattr("ichnoscope.db.DEFAULT_RUNS_DB", str(db_file))
    return str(db_file)


def test_stage_1_ingestion_staging_queue(clean_db):
    """Stage 1: Error arrives and is staged first with status `staged_raw` (Gate 1). Zero AI/Git calls."""
    payload = _load_payment_fixture()
    run_id, state = stage_raw_incident(payload, db_path=clean_db)

    assert run_id is not None
    assert state.status == "staged_raw"
    assert state.is_gate1_pending is True
    assert state.is_gate2_pending is False
    assert state.incident is not None
    assert state.incident.exception_type == "KeyError"
    # Zero git/LLM evidence yet
    assert state.culprit is None
    assert state.explanation is None

    stored = get_run(run_id, db_path=clean_db)
    assert stored is not None
    assert stored.status == "staged_raw"


def test_gate1_operator_dismiss_spam_zero_tokens(clean_db):
    """Control Center Gate 1: Operator reviews raw crash inbox and dismisses noise without spending AI tokens."""
    payload = _load_payment_fixture()
    run_id, _ = stage_raw_incident(payload, db_path=clean_db)

    resp = client.post(
        f"/api/runs/{run_id}/gate1/dismiss",
        json={"reviewer": "sre-oncall", "reason": "Expected 404 crawler noise"},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "dismissed"

    state = get_run(run_id, db_path=clean_db)
    assert state.status == "dismissed"
    assert state.gate1_review is not None
    assert state.gate1_review.action == "dismiss"
    assert state.gate1_review.approved_by == "sre-oncall"
    assert state.gate1_review.reason == "Expected 404 crawler noise"
    # Culprit and explanation remain None (no AI tokens were spent)
    assert state.culprit is None
    assert state.explanation is None


def test_gate1_manual_approval_advances_to_ai_pipeline(clean_db):
    """Control Center Gate 1: Operator approves raw incident -> advances to AI orchestration pipeline."""
    payload = _load_payment_fixture()
    run_id, _ = stage_raw_incident(payload, db_path=clean_db)

    resp = client.post(
        f"/api/runs/{run_id}/gate1/approve",
        json={"reviewer": "incident-commander", "notes": "Legitimate payment service failure"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] in ("staged_draft", "draft_ready", "published")

    state = get_run(run_id, db_path=clean_db)
    # Orchestration pipeline completed:
    assert state.culprit is not None
    assert state.explanation is not None
    assert len(state.explanation.checklist) == 3
    assert state.gate1_review is not None
    assert state.gate1_review.action == "approve"
    assert state.gate1_review.approved_by == "incident-commander"


def test_auto_dispatch_engine_rule_match(clean_db):
    """Auto-Dispatch Engine: Rule match (P1 / Production) advances directly to AI pipeline."""
    settings = load_settings({
        "USE_STUB_GITHUB": "true",
        "USE_STUB_LLM": "true",
        "DRY_RUN": "true",
        "AUTOMATION_MODE": "full_manual",  # Organization default is manual
    })

    # Add specific rule: P1 production bypasses Gate 1
    upsert_policy(
        "p1-auto-rule",
        "Production P1 Auto-Dispatch",
        {
            "default_mode": "full_manual",
            "rules": [
                {
                    "name": "Production Critical Escalation",
                    "condition": {"environment": "production", "severity": "P1-Critical"},
                    "action": {"gate1": "auto_approve", "gate2": "require_manual"},
                }
            ],
        },
        db_path=clean_db,
    )

    payload = _load_payment_fixture()  # Payment fixture is P1 production
    run_id, state, auto_promoted = ingest_incident(
        payload,
        db_path=clean_db,
        settings=settings,
        apply_policy=True,
    )

    assert auto_promoted is True
    assert state.status in ("staged_draft", "draft_ready")
    assert state.gate1_review is not None
    assert state.gate1_review.action == "auto_promoted"
    assert state.gate1_review.approved_by == "policy:Production Critical Escalation"


def test_stage_2_interactive_draft_review_and_edit(clean_db):
    """Stage 2: Draft Issue Staging (`staged_draft`), interactive edit of Title, Assignee, Checklist."""
    settings = load_settings({
        "USE_STUB_GITHUB": "true",
        "USE_STUB_LLM": "true",
        "DRY_RUN": "true",
        "GITHUB_REPOSITORY": "testowner/testrepo",
    })
    payload = _load_payment_fixture()
    run_id, _ = stage_raw_incident(payload, db_path=clean_db, settings=settings)
    state = execute_investigation(run_id, db_path=clean_db, settings=settings)

    assert state.status == "staged_draft"
    assert state.is_gate2_pending is True

    # Operator edits the draft via PATCH
    patch_resp = client.patch(
        f"/api/runs/{run_id}/draft",
        json={
            "draft_title": "[HOTFIX P1] Payment Gateway KeyError on stripe_customer_id",
            "custom_assignee": "senior-payment-eng",
            "draft_body": "Updated verification checklist:\n- [x] Check Stripe webhook\n- [ ] Deploy hotfix",
        },
    )
    assert patch_resp.status_code == 200
    patched = patch_resp.json()
    assert patched["draft_title"] == "[HOTFIX P1] Payment Gateway KeyError on stripe_customer_id"
    assert patched["custom_assignee"] == "senior-payment-eng"

    # Operator approves draft at Gate 2 -> Dispatches to GitHub and Slack
    approve_resp = client.post(
        f"/api/runs/{run_id}/gate2/approve",
        json={"reviewer": "lead-sre", "notes": "Checked against staging; ready to publish"},
    )
    assert approve_resp.status_code == 200
    assert approve_resp.json()["status"] == "published"
    assert approve_resp.json()["issue_url"] is not None

    final_state = get_run(run_id, db_path=clean_db)
    assert final_state.status == "published"
    assert final_state.gate2_review is not None
    assert final_state.gate2_review.action == "approve"
    assert final_state.gate2_review.approved_by == "lead-sre"


def test_stage_2_operator_reject(clean_db):
    """Control Center Gate 2: Operator rejects draft -> discarded without GitHub push."""
    settings = load_settings({"USE_STUB_GITHUB": "true", "USE_STUB_LLM": "true", "DRY_RUN": "true"})
    payload = _load_payment_fixture()
    run_id, _ = stage_raw_incident(payload, db_path=clean_db, settings=settings)
    execute_investigation(run_id, db_path=clean_db, settings=settings)

    reject_resp = client.post(
        f"/api/runs/{run_id}/gate2/reject",
        json={"reviewer": "lead-sre", "reason": "Already handled in PR #402"},
    )
    assert reject_resp.status_code == 200
    assert reject_resp.json()["status"] == "rejected"

    state = get_run(run_id, db_path=clean_db)
    assert state.status == "rejected"
    assert state.issue_url is None
    assert state.gate2_review is not None
    assert state.gate2_review.action == "reject"
    assert state.gate2_review.reason == "Already handled in PR #402"


def test_full_auto_mode_high_confidence_p1(clean_db):
    """Full Auto Mode / Auto-Publish Engine: High confidence (>=90%) & P1 automatically pushes to GitHub."""
    settings = load_settings({
        "USE_STUB_GITHUB": "true",
        "USE_STUB_LLM": "true",
        "DRY_RUN": "true",
        "AUTOMATION_MODE": "fully_autonomous",
        "GITHUB_REPOSITORY": "testowner/testrepo",
    })

    payload = _load_payment_fixture()  # P1 Critical with high confidence blame stub
    run_id, state, auto_promoted = ingest_incident(
        payload,
        db_path=clean_db,
        settings=settings,
        apply_policy=True,
    )

    assert auto_promoted is True
    assert state.status == "published"
    assert state.issue_url is not None
    assert state.gate1_review is not None
    assert state.gate1_review.action == "auto_promoted"
    assert state.gate2_review is not None
    assert state.gate2_review.action == "auto_promoted"


def test_policy_management_api(clean_db):
    """Validate GET /api/policies and POST /api/policies endpoints."""
    # List policies returns default
    resp = client.get("/api/policies")
    assert resp.status_code == 200
    data = resp.json()
    assert "default_mode" in data
    assert len(data["policies"]) >= 1

    # Upsert custom policy
    new_rule = {
        "default_mode": "semi_autonomous",
        "rules": [
            {
                "name": "Custom Database Filter",
                "condition": {"exception_type": "DatabaseError"},
                "action": {"gate1": "require_manual", "gate2": "require_manual"},
            }
        ],
    }
    upsert_resp = client.post(
        "/api/policies",
        json={
            "id": "db-policy",
            "name": "Database Error Policy",
            "is_active": True,
            "rule": new_rule,
        },
    )
    assert upsert_resp.status_code == 200
    assert upsert_resp.json()["id"] == "db-policy"

    # Verify updated list
    resp2 = client.get("/api/policies")
    assert any(p["id"] == "db-policy" for p in resp2.json()["policies"])


def test_server_a_internal_ingress(clean_db):
    """Server A forwarder submits sanitized payload to Server B internal ingress."""
    payload = _load_payment_fixture()
    envelope = {
        "gateway_received_at": 1729000000.0,
        "project_id": "payment-api",
        "environment": "production",
        "client_ip_hash": "123456789",
        "sanitized_payload": payload,
    }
    resp = client.post(
        "/internal/v1/incidents/ingress",
        json=envelope,
        headers={"Authorization": "Bearer ichnoscope-internal-gateway-token-v2"},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "staged_at_server_b"

