import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel

from ichnoscope.config import get_settings
from ichnoscope.models import GateApproval
from ichnoscope.pipeline import execute_investigation, ingest_incident, publish_draft_issue
from ichnoscope.policy import evaluate_policy, should_auto_publish
from ichnoscope.publisher import publish_issue
from ichnoscope.store import (
    ensure_default_policy,
    get_run,
    get_run_logs,
    list_gate_reviews,
    list_policies,
    list_runs,
    record_gate_review,
    save_run,
    upsert_policy,
)

router = APIRouter(prefix="/api")


def serialize_run(run_id: str, state: Any) -> dict[str, Any]:
    """Normalize a run for Control Center clients."""
    inc = state.incident
    expl = state.explanation
    cul = state.culprit
    return {
        "id": run_id,
        "status": state.status,
        "severity": state.severity,
        "fingerprint": state.fingerprint,
        "is_regression": state.is_regression,
        "issue_url": state.issue_url,
        "project_id": state.project_id,
        "environment": state.environment or (inc.environment if inc else None),
        "exception_type": inc.exception_type if inc else None,
        "error_message": inc.error_message if inc else None,
        "file_path": inc.file_path if inc else None,
        "line_number": inc.line_number if inc else None,
        "draft_title": state.draft_title_override,
        "draft_body": state.draft_body_override,
        "custom_assignee": state.custom_assignee,
        "gate1_review": state.gate1_review.model_dump(mode="json") if state.gate1_review else None,
        "gate2_review": state.gate2_review.model_dump(mode="json") if state.gate2_review else None,
        "incident": inc.model_dump(mode="json") if inc else None,
        "explanation": expl.model_dump(mode="json") if expl else None,
        "culprit": cul.model_dump(mode="json") if cul else None,
        "logs_count": len(state.logs),
    }


@router.get("/runs")
def api_list_runs(
    status: str | None = Query(default=None),
    severity: str | None = Query(default=None),
    project_id: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
) -> list[dict[str, Any]]:
    """List recent incident triage runs for the Control Center board, optionally scoped to a project."""
    aliases = {
        "staged_draft": {"staged_draft", "draft_ready"},
        "draft_ready": {"staged_draft", "draft_ready"},
        "staged_raw": {"staged_raw", "received"},
        "analyzing": {"analyzing", "parsing", "blaming", "explaining"},
        "dismissed": {"dismissed", "rejected"},
    }
    raw_runs = list_runs(limit=limit, project_id=project_id)
    wanted = aliases.get(status, {status} if status else None)
    items: list[dict[str, Any]] = []
    for run_id, state in raw_runs:
        if wanted and state.status not in wanted:
            continue
        if severity and state.severity != severity:
            continue
        items.append(serialize_run(run_id, state))
    return items


@router.get("/runs/{run_id}")
def api_get_run(run_id: str) -> dict[str, Any]:
    """Retrieve detailed execution state and audit trail for a run."""
    state = get_run(run_id)
    if not state:
        raise HTTPException(status_code=404, detail=f"Run '{run_id}' not found")

    detailed_logs = get_run_logs(run_id)

    payload = serialize_run(run_id, state)
    payload["logs"] = detailed_logs if detailed_logs else state.logs
    payload["gate_reviews"] = list_gate_reviews(run_id)
    return payload


class RejectRequest(BaseModel):
    reason: str | None = None
    reviewer: str | None = None


class GateReviewRequest(BaseModel):
    reviewer: str | None = None
    notes: str | None = None
    reason: str | None = None
    custom_assignee: str | None = None
    title_override: str | None = None
    body_override: str | None = None


class DraftUpdateRequest(BaseModel):
    draft_title: str | None = None
    draft_body: str | None = None
    custom_assignee: str | None = None


class PolicyUpsertRequest(BaseModel):
    id: str | None = None
    name: str
    is_active: bool = True
    rule: dict[str, Any]


def _require_run(run_id: str):
    state = get_run(run_id)
    if not state:
        raise HTTPException(status_code=404, detail=f"Run '{run_id}' not found")
    return state


@router.post("/runs/{run_id}/gate1/approve")
def api_gate1_approve(run_id: str, body: GateReviewRequest | None = None) -> dict[str, Any]:
    """Promote a raw incident from Gate 1 into the AI orchestration pipeline."""
    state = _require_run(run_id)
    if not state.is_gate1_pending:
        raise HTTPException(status_code=409, detail=f"Run is not awaiting Gate 1 (status={state.status})")

    reviewer = (body.reviewer if body else None) or "operator"
    notes = (body.notes if body else None) or (body.reason if body else None)
    state.status = "analyzing"
    state.gate1_review = GateApproval(
        approved_by=reviewer,
        approved_at=datetime.now(timezone.utc),
        reason=notes,
        action="approve",
    )
    record_gate_review(run_id, "gate1", "approve", reviewer, notes=notes)
    save_run(run_id, state)

    settings = get_settings()
    state = execute_investigation(run_id, settings=settings)
    if state.is_gate2_pending:
        decision = evaluate_policy(state, settings=settings)
        if should_auto_publish(state, decision):
            state.gate2_review = GateApproval(
                approved_by=f"policy:{decision.matched_rule or decision.default_mode}",
                approved_at=datetime.now(timezone.utc),
                reason="auto_publish",
                action="auto_promoted",
            )
            record_gate_review(run_id, "gate2", "auto_promoted", "policy", notes="auto_publish")
            save_run(run_id, state)
            state = publish_draft_issue(run_id, settings=settings)

    return {
        "id": run_id,
        "status": state.status,
        "message": "AI investigation pipeline completed."
        if state.status != "analyzing"
        else "AI investigation pipeline enqueued successfully.",
        **serialize_run(run_id, state),
    }


@router.post("/runs/{run_id}/gate1/dismiss")
def api_gate1_dismiss(run_id: str, body: GateReviewRequest | None = None) -> dict[str, Any]:
    """Drop a raw incident at Gate 1 without spending AI tokens."""
    state = _require_run(run_id)
    if not state.is_gate1_pending:
        raise HTTPException(status_code=409, detail=f"Run is not awaiting Gate 1 (status={state.status})")
    reviewer = (body.reviewer if body else None) or "operator"
    reason = (body.reason if body else None) or (body.notes if body else None) or "Dismissed as noise"
    state.status = "dismissed"
    state.gate1_review = GateApproval(
        approved_by=reviewer,
        approved_at=datetime.now(timezone.utc),
        reason=reason,
        action="dismiss",
    )
    record_gate_review(run_id, "gate1", "dismiss", reviewer, notes=reason)
    state.logs.append(f"[INFO] gate1: Dismissed by {reviewer}; reason: '{reason}'")
    save_run(run_id, state)
    return {"id": run_id, "status": "dismissed"}


@router.post("/runs/{run_id}/gate2/approve")
def api_gate2_approve(run_id: str, body: GateReviewRequest | None = None) -> dict[str, Any]:
    """Approve an AI draft and publish the GitHub issue."""
    state = _require_run(run_id)
    if state.status == "published":
        return {"id": run_id, "status": "already_published", "issue_url": state.issue_url}
    if not state.is_gate2_pending:
        raise HTTPException(status_code=409, detail=f"Run is not awaiting Gate 2 (status={state.status})")
    if not state.incident:
        raise HTTPException(status_code=400, detail="Cannot approve run without parsed incident")

    reviewer = (body.reviewer if body else None) or "operator"
    if body:
        if body.title_override:
            state.draft_title_override = body.title_override
        if body.body_override:
            state.draft_body_override = body.body_override
        if body.custom_assignee:
            state.custom_assignee = body.custom_assignee
    state.gate2_review = GateApproval(
        approved_by=reviewer,
        approved_at=datetime.now(timezone.utc),
        reason=body.notes if body else None,
        action="approve",
    )
    record_gate_review(run_id, "gate2", "approve", reviewer, notes=body.notes if body else None)
    save_run(run_id, state)

    try:
        state = publish_draft_issue(
            run_id,
            settings=get_settings(),
            title_override=body.title_override if body else None,
            body_override=body.body_override if body else None,
            custom_assignee=body.custom_assignee if body else None,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Publishing failed: {exc}") from exc

    issue_number = None
    if state.issue_url and state.issue_url.rstrip("/").split("/")[-1].isdigit():
        issue_number = int(state.issue_url.rstrip("/").split("/")[-1])
    return {
        "id": run_id,
        "status": "published",
        "issue_number": issue_number,
        "issue_url": state.issue_url,
    }


@router.post("/runs/{run_id}/gate2/reject")
def api_gate2_reject(run_id: str, body: GateReviewRequest | RejectRequest | None = None) -> dict[str, Any]:
    """Reject a drafted issue without creating a GitHub issue."""
    state = _require_run(run_id)
    if not state.is_gate2_pending and state.status not in {"analyzing", "failed"}:
        if state.status not in {"staged_draft", "draft_ready"}:
            # Allow legacy reject of any non-terminal draft-like run.
            pass
    reviewer = (body.reviewer if body else None) or "operator"
    reason = (body.reason if body else None) or (body.notes if body else None) or "No reason provided"
    state.status = "rejected"
    state.gate2_review = GateApproval(
        approved_by=reviewer,
        approved_at=datetime.now(timezone.utc),
        reason=reason,
        action="reject",
    )
    record_gate_review(run_id, "gate2", "reject", reviewer, notes=reason)
    state.logs.append(f"[INFO] gate2: Rejected by {reviewer}; reason: '{reason}'")
    save_run(run_id, state)
    return {"id": run_id, "status": "rejected"}


@router.patch("/runs/{run_id}/draft")
def api_patch_draft(run_id: str, body: DraftUpdateRequest) -> dict[str, Any]:
    """Edit the Gate 2 markdown draft before publishing."""
    state = _require_run(run_id)
    if not state.is_gate2_pending:
        raise HTTPException(status_code=409, detail="Draft can only be edited while awaiting Gate 2")
    if body.draft_title is not None:
        state.draft_title_override = body.draft_title
    if body.draft_body is not None:
        state.draft_body_override = body.draft_body
    if body.custom_assignee is not None:
        state.custom_assignee = body.custom_assignee
    save_run(run_id, state)
    return serialize_run(run_id, state)


@router.get("/policies")
def api_list_policies() -> dict[str, Any]:
    settings = get_settings()
    default = ensure_default_policy(default_mode=settings.automation_mode)
    return {"default_mode": settings.automation_mode, "policies": list_policies() or [default]}


@router.post("/policies")
def api_upsert_policy(req: PolicyUpsertRequest) -> dict[str, Any]:
    policy_id = req.id or req.name.lower().replace(" ", "-")
    saved = upsert_policy(policy_id, req.name, req.rule, is_active=req.is_active)
    return saved


@router.post("/runs/{run_id}/approve")
def api_approve_run(run_id: str, body: GateReviewRequest | None = None) -> dict[str, Any]:
    """Legacy alias for Gate 2 approve."""
    return api_gate2_approve(run_id, body)


@router.post("/runs/{run_id}/reject")
def api_reject_run(run_id: str, body: RejectRequest | None = None) -> dict[str, Any]:
    """Legacy alias for Gate 2 reject."""
    return api_gate2_reject(run_id, body)


class SettingsUpdateRequest(BaseModel):
    github_repository: str | None = None
    fallback_assignee: str | None = None
    path_prefix_strip: str | None = None
    window_hours: int | None = None
    p1_users: int | None = None
    p1_events: int | None = None
    p2_users: int | None = None
    p2_events: int | None = None
    dry_run: bool | None = None
    slack_webhook_url: str | None = None
    admin_token: str | None = None
    automation_mode: str | None = None


class SlackTestRequest(BaseModel):
    webhook_url: str | None = None


from ichnoscope.db import save_system_setting


def _persist_env_update(updates: dict[str, str]) -> None:
    """Persist updated settings to SQLite/Turso database and best-effort to local .env file."""
    for k, v in updates.items():
        try:
            save_system_setting(k, str(v))
        except Exception:
            pass

    for candidate in [Path("backend/.env"), Path(".env")]:
        if candidate.is_file():
            try:
                content = candidate.read_text(encoding="utf-8")
                lines = content.splitlines()
                updated_lines: list[str] = []
                keys_found = set()
                for line in lines:
                    stripped = line.strip()
                    if stripped and not stripped.startswith("#") and "=" in stripped:
                        key = stripped.split("=", 1)[0].strip()
                        if key in updates:
                            updated_lines.append(f"{key}={updates[key]}")
                            keys_found.add(key)
                            continue
                    updated_lines.append(line)
                for k, v in updates.items():
                    if k not in keys_found:
                        updated_lines.append(f"{k}={v}")
                candidate.write_text("\n".join(updated_lines) + "\n", encoding="utf-8")
            except Exception:
                pass
            break


@router.get("/settings")
def api_get_settings() -> dict[str, Any]:
    """Return sanitized system settings."""
    settings = get_settings()
    summary = settings.safe_summary()
    if settings.slack_webhook_url:
        summary["slack_webhook_url"] = settings.slack_webhook_url.get_secret_value()
    if settings.admin_token:
        summary["admin_token"] = settings.admin_token.get_secret_value()
    return summary


@router.post("/settings")
def api_update_settings(req: SettingsUpdateRequest) -> dict[str, Any]:
    """Dynamically update system settings (including Slack Webhook URL and repository scoping)."""
    updates: dict[str, str] = {}
    if req.slack_webhook_url is not None:
        val = req.slack_webhook_url.strip()
        os.environ["SLACK_WEBHOOK_URL"] = val
        updates["SLACK_WEBHOOK_URL"] = val
    if req.github_repository is not None:
        val = req.github_repository.strip()
        os.environ["GITHUB_REPOSITORY"] = val
        updates["GITHUB_REPOSITORY"] = val
    if req.fallback_assignee is not None:
        val = req.fallback_assignee.strip()
        os.environ["FALLBACK_ASSIGNEE"] = val
        updates["FALLBACK_ASSIGNEE"] = val
    if req.path_prefix_strip is not None:
        val = req.path_prefix_strip.strip()
        os.environ["PATH_PREFIX_STRIP"] = val
        updates["PATH_PREFIX_STRIP"] = val
    if req.dry_run is not None:
        val = "true" if req.dry_run else "false"
        os.environ["DRY_RUN"] = val
        updates["DRY_RUN"] = val
    if req.p1_users is not None:
        val = str(req.p1_users)
        os.environ["P1_USERS"] = val
        updates["P1_USERS"] = val
    if req.p1_events is not None:
        val = str(req.p1_events)
        os.environ["P1_EVENTS"] = val
        updates["P1_EVENTS"] = val
    if req.p2_users is not None:
        val = str(req.p2_users)
        os.environ["P2_USERS"] = val
        updates["P2_USERS"] = val
    if req.p2_events is not None:
        val = str(req.p2_events)
        os.environ["P2_EVENTS"] = val
        updates["P2_EVENTS"] = val
    if req.admin_token is not None:
        val = req.admin_token.strip()
        os.environ["ADMIN_TOKEN"] = val
        updates["ADMIN_TOKEN"] = val
    if req.automation_mode is not None:
        val = req.automation_mode.strip()
        os.environ["AUTOMATION_MODE"] = val
        updates["AUTOMATION_MODE"] = val

    if updates:
        _persist_env_update(updates)

    get_settings.cache_clear()
    settings = get_settings()
    summary = settings.safe_summary()
    if settings.slack_webhook_url:
        summary["slack_webhook_url"] = settings.slack_webhook_url.get_secret_value()
    if settings.admin_token:
        summary["admin_token"] = settings.admin_token.get_secret_value()
    return summary


@router.post("/notifications/slack/test")
def api_test_slack(req: SlackTestRequest | None = None) -> dict[str, Any]:
    """Dispatch an immediate test alert to Slack to verify webhook connectivity."""
    from ichnoscope.notify import notify_slack

    settings = get_settings()
    target_url = (req.webhook_url.strip() if req and req.webhook_url else None) or (
        settings.slack_webhook_url.get_secret_value() if settings.slack_webhook_url else None
    )
    if not target_url:
        raise HTTPException(
            status_code=400,
            detail="No Slack Webhook URL configured. Please enter a valid Slack webhook URL in Settings.",
        )

    repo = settings.github_repository or "ichnoscope-org/incident-tracker"
    ok = notify_slack(
        title="Ichnoscope Incident Alert Test",
        severity="P2-High",
        assignee="ichnoscope-bot",
        issue_url=f"https://github.com/{repo}/issues/1",
        webhook_url=target_url,
    )
    if ok:
        return {"ok": True, "message": "Test notification delivered to Slack successfully!"}
    raise HTTPException(
        status_code=502,
        detail="Slack returned an error. Please verify the Webhook URL format and channel permissions.",
    )


@router.get("/health")
def api_get_health() -> list[dict[str, Any]]:
    """Return component health overview for the dashboard."""
    settings = get_settings()
    return [
        {
            "key": "sentry",
            "name": "Sentry Webhook Listener",
            "status": "healthy" if settings.sentry_client_secret else "degraded",
            "description": "Ingesting error events from Sentry",
            "latency_ms": 15,
        },
        {
            "key": "github",
            "name": "GitHub Integration",
            "status": "healthy" if settings.github_token else "degraded",
            "description": "Blame lookup and issue publishing",
            "latency_ms": 45,
        },
        {
            "key": "llm",
            "name": "LLM Inference Pipeline",
            "status": "healthy" if (settings.use_stub_llm or settings.llm_providers()) else "degraded",
            "description": "Root-cause explanation generation",
            "latency_ms": 110,
        },
        {
            "key": "slack",
            "name": "Slack Notifications",
            "status": "healthy" if settings.slack_webhook_url else "degraded",
            "description": "Incoming webhook alert dispatcher",
            "latency_ms": 20,
        },
        {
            "key": "core",
            "name": "Server B Dual-Gate Orchestrator",
            "status": "healthy",
            "description": "Gate 1 staging, AI pipeline, Gate 2 draft review",
            "latency_ms": 12,
        },
    ]


@router.post("/runs/{run_id}/rerun")
def api_rerun_run(run_id: str) -> dict[str, Any]:
    """Re-run triage pipeline explanation for an existing run."""
    state = get_run(run_id)
    if not state or not state.incident:
        raise HTTPException(status_code=404, detail=f"Run '{run_id}' not found")

    from ichnoscope.explain import explain_with_details

    settings = get_settings()
    exp_res = explain_with_details(state.incident, state.culprit, settings=settings)
    state.explanation = exp_res.explanation
    state.logs.append(f"[INFO] admin: Re-ran triage explanation via {exp_res.provider or 'stub'}")
    save_run(run_id, state)
    return api_get_run(run_id)


@router.post("/runs/replay")
def api_replay_fixture(fixture: str = "payment_npe") -> dict[str, Any]:
    """Trigger pipeline execution on a saved Sentry fixture and store the triaged incident."""
    import json
    from pathlib import Path
    from ichnoscope.pipeline import run_pipeline

    fixtures_dir = Path(__file__).resolve().parents[1] / "fixtures"
    mapping = {
        "payment_npe": "bug1_keyerror_payment.json",
        "auth_jwt": "bug2_attributeerror_cart.json",
        "db_leak": "edge_library_frame_last.json",
    }
    filename = mapping.get(fixture, fixture)
    if not filename.endswith(".json"):
        filename = f"{filename}.json"

    file_path = fixtures_dir / filename
    if not file_path.is_file():
        raise HTTPException(status_code=404, detail=f"Fixture '{filename}' not found at {fixtures_dir}")

    payload = json.loads(file_path.read_text(encoding="utf-8"))
    settings = get_settings()
    run_id, _state, _auto = ingest_incident(payload=payload, settings=settings, apply_policy=True)
    return api_get_run(run_id)


class GitHubConnectRequest(BaseModel):
    installation_id: str | int
    repo: str


class ProjectCreateRequest(BaseModel):
    name: str
    environment: str = "production"
    rate_limit_min: int = 120
    github_repo_override: str | None = None
    slack_channel_override: str | None = None


class ProjectUpdateRequest(BaseModel):
    name: str | None = None
    environment: str | None = None
    rate_limit_min: int | None = None
    github_repo_override: str | None = None
    slack_channel_override: str | None = None
    is_active: bool | None = None


@router.get("/projects")
def api_list_projects() -> list[dict[str, Any]]:
    """List all registered projects with credentials and metadata."""
    from ichnoscope.projects import list_projects

    projects = list_projects()
    return [p.to_safe_dict() for p in projects]


@router.post("/projects")
def api_create_project(req: ProjectCreateRequest) -> dict[str, Any]:
    """Register a new application project and issue public/secret API keys."""
    from ichnoscope.projects import create_project

    project = create_project(
        name=req.name,
        environment=req.environment,
        rate_limit_min=req.rate_limit_min,
        github_repo_override=req.github_repo_override,
        slack_channel_override=req.slack_channel_override,
    )
    return project.model_dump()


@router.get("/projects/{project_id}")
def api_get_project(project_id: str) -> dict[str, Any]:
    """Retrieve details for a specific project."""
    from ichnoscope.projects import get_project

    project = get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found")
    return project.to_safe_dict()


@router.patch("/projects/{project_id}")
def api_update_project(project_id: str, req: ProjectUpdateRequest) -> dict[str, Any]:
    """Update settings or active status for a specific project."""
    from ichnoscope.projects import update_project

    updated = update_project(project_id, req.model_dump(exclude_unset=True))
    if not updated:
        raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found")
    return updated.to_safe_dict()


@router.delete("/projects/{project_id}")
def api_delete_project(project_id: str) -> dict[str, Any]:
    """Delete a registered project."""
    from ichnoscope.projects import delete_project

    ok = delete_project(project_id)
    if not ok:
        raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found")
    return {"status": "deleted", "project_id": project_id}


@router.post("/projects/{project_id}/keys/rotate")
def api_rotate_project_key(project_id: str) -> dict[str, Any]:
    """Rotate public and secret credentials for a registered project."""
    from ichnoscope.projects import rotate_project_key

    project = rotate_project_key(project_id)
    if not project:
        raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found")
    return project.model_dump()


@router.get("/projects/{project_id}/github/install-url")
def api_get_github_install_url(project_id: str) -> dict[str, Any]:
    """Return GitHub App installation URL for linking a repository."""
    from ichnoscope.config import get_settings
    settings = get_settings()
    app_name = settings.github_app_name or os.getenv("GITHUB_APP_NAME") or "ichnois-connection"
    install_url = f"https://github.com/apps/{app_name}/installations/new?state={project_id}"
    return {
        "install_url": install_url,
        "app_name": app_name,
        "project_id": project_id,
    }


@router.get("/projects/{project_id}/github/repos")
def api_list_github_repos(project_id: str, installation_id: str | None = None) -> list[dict[str, Any]]:
    """List accessible GitHub repositories for a project or installation."""
    from ichnoscope.github_app import get_github_app_service, GitHubAppError
    from ichnoscope.projects import get_project

    project = get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found")

    target_inst = installation_id or project.github_installation_id
    if not target_inst:
        raise HTTPException(
            status_code=400,
            detail="No GitHub installation ID provided or linked to this project. Please install the GitHub App first."
        )

    try:
        service = get_github_app_service()
        repos = service.list_installation_repositories(target_inst)
        return repos
    except GitHubAppError as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@router.post("/projects/{project_id}/github/connect")
def api_connect_github_repo(project_id: str, req: GitHubConnectRequest) -> dict[str, Any]:
    """Connect a GitHub repository and installation to a project."""
    from ichnoscope.projects import connect_github_project

    updated = connect_github_project(project_id, req.installation_id, req.repo)
    if not updated:
        raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found")
    return updated.to_safe_dict()


@router.post("/projects/{project_id}/github/disconnect")
def api_disconnect_github_repo(project_id: str) -> dict[str, Any]:
    """Disconnect GitHub repository from a project."""
    from ichnoscope.projects import disconnect_github_project

    updated = disconnect_github_project(project_id)
    if not updated:
        raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found")
    return updated.to_safe_dict()


@router.get("/internal/v1/projects/cache")
@router.get("/internal/v1/projects/keys")
def api_internal_projects_cache() -> dict[str, Any]:
    """Internal cache synchronization endpoint for Server A (Edge Gateway)."""
    from ichnoscope.projects import list_projects

    projects = list_projects()
    cache: dict[str, dict[str, Any]] = {}
    for p in projects:
        if p.is_active:
            cache[p.public_key] = {
                "project_id": p.project_id,
                "name": p.name,
                "environment": p.environment,
                "rate_limit_min": p.rate_limit_min,
            }
    return {"projects": cache, "count": len(cache)}


# ---------------------------------------------------------------------------
# Team Membership & Role Management Endpoints
# ---------------------------------------------------------------------------

class TeamMemberAddRequest(BaseModel):
    user_id: str
    email: str = ""
    display_name: str = ""
    role: str = "viewer"


class TeamMemberUpdateRequest(BaseModel):
    role: str


class UserProfileSyncRequest(BaseModel):
    user_id: str
    email: str
    display_name: str = ""
    avatar_url: str = ""


@router.post("/user/sync")
def api_sync_user_profile(req: UserProfileSyncRequest) -> dict[str, Any]:
    """Upsert user profile from Supabase claims upon authentication."""
    from ichnoscope.teams import upsert_user_profile

    upsert_user_profile(
        user_id=req.user_id,
        email=req.email,
        display_name=req.display_name or None,
        avatar_url=req.avatar_url or None,
    )
    return {"status": "synced", "user_id": req.user_id}


@router.get("/user/{user_id}/projects")
def api_get_user_projects(user_id: str) -> dict[str, Any]:
    """Retrieve all projects accessible to a user along with their granted role."""
    from ichnoscope.teams import get_user_projects

    projects = get_user_projects(user_id)
    return {"projects": projects, "count": len(projects)}


@router.get("/projects/{project_id}/members")
def api_get_project_members(project_id: str) -> dict[str, Any]:
    """List all team members assigned to a project."""
    from ichnoscope.teams import get_project_members

    members = get_project_members(project_id)
    return {"project_id": project_id, "members": members, "count": len(members)}


@router.post("/projects/{project_id}/members")
def api_add_project_member(project_id: str, req: TeamMemberAddRequest) -> dict[str, Any]:
    """Add or invite a member to a project with a specific role."""
    from ichnoscope.teams import add_team_member, upsert_user_profile

    if req.email:
        upsert_user_profile(
            user_id=req.user_id,
            email=req.email,
            display_name=req.display_name or None,
        )

    member = add_team_member(
        project_id=project_id,
        user_id=req.user_id,
        role=req.role,
        invited_by="admin",
    )
    return {"status": "added", "member": member}


@router.patch("/projects/{project_id}/members/{user_id}")
def api_update_project_member(
    project_id: str, user_id: str, req: TeamMemberUpdateRequest
) -> dict[str, Any]:
    """Update a team member's role within a project."""
    from ichnoscope.teams import update_member_role

    try:
        updated = update_member_role(
            project_id=project_id,
            user_id=user_id,
            new_role=req.role,
            actor_id="admin",
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if not updated:
        raise HTTPException(
            status_code=404,
            detail=f"Member '{user_id}' not found in project '{project_id}'",
        )
    return {"status": "updated", "member": updated}


@router.delete("/projects/{project_id}/members/{user_id}")
def api_remove_project_member(project_id: str, user_id: str) -> dict[str, Any]:
    """Remove a team member from a project."""
    from ichnoscope.teams import remove_team_member

    ok = remove_team_member(
        project_id=project_id,
        user_id=user_id,
        actor_id="admin",
    )
    if not ok:
        raise HTTPException(
            status_code=404,
            detail=f"Member '{user_id}' not found in project '{project_id}'",
        )
    return {"status": "removed", "project_id": project_id, "user_id": user_id}

