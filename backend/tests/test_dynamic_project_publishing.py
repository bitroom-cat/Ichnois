"""Tests verifying dynamic per-microservice GitHub repository targeting and token authorization."""

import json
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

import httpx
import pytest

from ichnoscope.config import load_settings
from ichnoscope.models import Incident, RunState, Culprit, Explanation
from ichnoscope.pipeline import publish_draft_issue, execute_investigation
from ichnoscope.projects import create_project, connect_github_project
from ichnoscope.publisher import publish_issue, publish_repeat_comment
from ichnoscope.store import save_run


def _make_sample_incident(project_id: str = "checkout-service") -> Incident:
    return Incident(
        incident_id="inc-dyn-test-1",
        source="sentry",
        occurred_at=datetime(2026, 10, 17, 10, 0, 0, tzinfo=timezone.utc),
        exception_type="KeyError",
        error_message="'stripe_token'",
        file_path="services/payment.py",
        line_number=42,
        stack_excerpt="services/payment.py:42 in process_charge\nKeyError: 'stripe_token'",
        environment="production",
    )


def test_dynamic_microservice_repo_and_token_publishing(tmp_path: Path):
    """Verify publish_draft_issue uses the project's specific repo and installation token."""
    db_file = tmp_path / "test_dyn_pub.db"

    # 1. Register microservice project connected to a unique GitHub repository
    proj = create_project("Custom Payment Service", db_path=db_file)
    connect_github_project(
        project_id=proj.project_id,
        installation_id="inst_998877",
        repo="acme-corp/custom-billing-engine",
        fallback_assignee="billing-lead",
        db_path=db_file,
    )

    incident = _make_sample_incident(project_id=proj.project_id)
    culprit = Culprit(
        sha="abc1234567890abcdef1234567890abcdef12",
        author_login="billing-lead",
        author_name="Billing Lead",
        message="Update charge token logic",
        committed_at=datetime(2026, 10, 17, 9, 0, 0, tzinfo=timezone.utc),
        within_window=True,
        confidence="high",
        diff="@@ -42 +42 @@\n+ token = card['stripe_token']",
    )
    explanation = Explanation(
        domain="backend",
        root_cause_hypothesis="Missing stripe_token in payload",
        checklist=["Check card payload", "Add fallback", "Run unit tests"],
    )

    # 2. Stage a draft run for this project
    run_id = "run-dyn-1"
    state = RunState(
        payload={"project_id": proj.project_id},
        project_id=proj.project_id,
        incident=incident,
        culprit=culprit,
        explanation=explanation,
        severity="P1-Critical",
        status="staged_draft",
        draft_title_override="[P1-Critical] KeyError: 'stripe_token' in services/payment.py:42",
        draft_body_override="Issue description...",
    )
    save_run(run_id, state, db_path=db_file)

    settings = load_settings({
        "DRY_RUN": "false",
        "GITHUB_REPOSITORY": "default-fallback/default-repo",
        "GITHUB_TOKEN": "fallback-pat-token",
    })

    recorded_requests: list[httpx.Request] = []

    def mock_github_handler(request: httpx.Request) -> httpx.Response:
        recorded_requests.append(request)
        url_str = str(request.url)
        # Mock assignee check
        if "/assignees/billing-lead" in url_str:
            return httpx.Response(204)
        # Mock issue creation
        if "/issues" in url_str:
            return httpx.Response(
                201,
                json={
                    "number": 456,
                    "html_url": "https://github.com/acme-corp/custom-billing-engine/issues/456",
                },
            )
        return httpx.Response(404)

    mock_client = httpx.Client(transport=httpx.MockTransport(mock_github_handler))

    # Mock the GitHub App service to return a scoped installation token
    with patch("ichnoscope.github_app.get_github_app_service") as mock_get_svc:
        mock_svc = MagicMock()
        mock_svc.get_installation_token.return_value = "ghs_dynamic_scoped_token_998877"
        mock_get_svc.return_value = mock_svc

        # Execute publish_draft_issue
        published_state = publish_draft_issue(
            run_id,
            db_path=db_file,
            settings=settings,
            client=mock_client,
        )

        assert published_state.status == "published"
        assert published_state.issue_url == "https://github.com/acme-corp/custom-billing-engine/issues/456"

        # Verify get_installation_token was called with the project's installation ID
        mock_svc.get_installation_token.assert_called_with("inst_998877")

    # Verify the HTTP request sent to GitHub
    issue_post = next(r for r in recorded_requests if r.method == "POST")
    # Must target the microservice's specific repository URL
    assert "https://api.github.com/repos/acme-corp/custom-billing-engine/issues" in str(issue_post.url)
    # Must authenticate using the microservice's dynamic installation token, NOT the fallback PAT!
    assert issue_post.headers["Authorization"] == "Bearer ghs_dynamic_scoped_token_998877"


def test_repeat_comment_scoped_to_microservice_repo(tmp_path: Path):
    """Verify publish_repeat_comment posts to the microservice's repository with dynamic token."""
    db_file = tmp_path / "test_repeat.db"

    proj = create_project("Auth Service", db_path=db_file)
    connect_github_project(
        project_id=proj.project_id,
        installation_id="inst_112233",
        repo="acme-corp/auth-microservice",
        db_path=db_file,
    )

    settings = load_settings({
        "DRY_RUN": "false",
        "GITHUB_REPOSITORY": "default-fallback/default-repo",
        "GITHUB_TOKEN": "fallback-pat-token",
    })

    recorded: list[httpx.Request] = []

    def mock_handler(request: httpx.Request) -> httpx.Response:
        recorded.append(request)
        return httpx.Response(201, json={"id": 789})

    mock_client = httpx.Client(transport=httpx.MockTransport(mock_handler))

    with patch("ichnoscope.github_app.get_github_app_service") as mock_get_svc:
        mock_svc = MagicMock()
        mock_svc.get_installation_token.return_value = "ghs_token_auth_112233"
        mock_get_svc.return_value = mock_svc

        success = publish_repeat_comment(
            issue_number=42,
            count=10,
            settings=settings,
            client=mock_client,
            project_id=proj.project_id,
            db_path=db_file,
        )

        assert success is True
        mock_svc.get_installation_token.assert_called_with("inst_112233")

    req = recorded[0]
    assert "https://api.github.com/repos/acme-corp/auth-microservice/issues/42/comments" in str(req.url)
    assert req.headers["Authorization"] == "Bearer ghs_token_auth_112233"
