"""End-to-end dual-gated incident triage pipeline for Server B core."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

import httpx

from ichnoscope.blame import find_culprit
from ichnoscope.config import Settings
from ichnoscope.dedupe import attach, bump, claim, lookup
from ichnoscope.dedupe import fingerprint as calc_fingerprint
from ichnoscope.explain import explain_with_details
from ichnoscope.models import GateApproval, RunState
from ichnoscope.notify import notify_slack
from ichnoscope.parse import parse_sentry
from ichnoscope.policy import PolicyDecision, evaluate_policy, should_auto_publish
from ichnoscope.publisher import publish_issue, publish_repeat_comment
from ichnoscope.severity import rate_with_reason
from ichnoscope.store import record_gate_review, record_log, save_run
from ichnoscope.templates import build_issue_draft

logger = logging.getLogger(__name__)


def _new_run_id(run_id: str | None = None) -> str:
    return run_id or uuid.uuid4().hex[:10]


def _settings(settings: Settings | None) -> Settings:
    if settings is None:
        from ichnoscope.config import get_settings

        return get_settings()
    return settings


def _logger_for(run_id: str, state: RunState, db_path: str | None):
    def _log(step: str, message: str, level: str = "INFO") -> None:
        entry = f"[{level}] {step}: {message}"
        state.logs.append(entry)
        record_log(run_id, step, message, level=level, db_path=db_path)

    return _log


def _light_parse(payload: dict, settings: Settings, state: RunState) -> None:
    """Best-effort parse for Gate 1 inbox display. Never fails the staging record."""
    try:
        incident = parse_sentry(payload, path_prefix_strip=settings.path_prefix_strip)
        state.incident = incident
        state.environment = incident.environment
        state.fingerprint = calc_fingerprint(incident)
        severity, _reason = rate_with_reason(incident, settings=settings)
        state.severity = severity
    except Exception:  # noqa: BLE001
        payload_env = payload.get("environment")
        if isinstance(payload_env, str):
            state.environment = payload_env


def _infer_project_id(payload: dict, explicit_project_id: str | None = None) -> str:
    """Resolve project_id from argument, payload fields, or payload contents."""
    if explicit_project_id:
        return explicit_project_id
    if not isinstance(payload, dict):
        return "checkout-service"
    if payload.get("project_id"):
        return str(payload["project_id"])
    if payload.get("projectId"):
        return str(payload["projectId"])

    release = str(payload.get("release", ""))
    payload_str = str(payload)
    if "myshop" in release or "cart" in payload_str:
        return "myshop-backend"
    if "inventory" in payload_str:
        return "inventory-service"
    if "auth" in payload_str:
        return "auth-service"
    if "edge" in payload_str or "gateway" in payload_str:
        return "edge-gateway"
    if "payment" in payload_str or "checkout" in payload_str:
        return "checkout-service"
    return "checkout-service"


def stage_raw_incident(
    payload: dict,
    *,
    run_id: str | None = None,
    db_path: str | None = None,
    settings: Settings | None = None,
    project_id: str | None = None,
    environment: str | None = None,
) -> tuple[str, RunState]:
    """Persist an incoming event as Gate 1 `staged_raw` with zero Git/LLM calls."""
    settings = _settings(settings)
    active_run_id = _new_run_id(run_id)
    resolved_proj_id = _infer_project_id(payload, project_id)
    state = RunState(
        payload=payload,
        status="staged_raw",
        project_id=resolved_proj_id,
        environment=environment,
    )
    log = _logger_for(active_run_id, state, db_path)
    log("gateway", f"Staged raw incident for run {active_run_id} (Gate 1)")
    _light_parse(payload, settings, state)
    if environment:
        state.environment = environment
    save_run(active_run_id, state, db_path=db_path)
    return active_run_id, state


def execute_investigation(
    run_id: str,
    *,
    db_path: str | None = None,
    settings: Settings | None = None,
    client: httpx.Client | None = None,
    payload: dict | None = None,
) -> RunState:
    """Run parse, dedupe, blame, LLM synthesis, and severity. Stop at `staged_draft`."""
    from ichnoscope.store import get_run

    settings = _settings(settings)
    existing = get_run(run_id, db_path=db_path)
    if existing is None:
        if payload is None:
            raise ValueError(f"Run '{run_id}' not found")
        state = RunState(payload=payload, status="analyzing")
    else:
        state = existing
        if payload is not None:
            state.payload = payload

    log = _logger_for(run_id, state, db_path)
    state.status = "analyzing"
    save_run(run_id, state, db_path=db_path)

    import time
    start_time = time.monotonic()
    max_timeout_s = float(getattr(settings, "pipeline_timeout_seconds", 45.0))

    http_client = client or httpx.Client(timeout=httpx.Timeout(15.0, connect=5.0))
    close_client = client is None

    try:
        state.status = "parsing"
        try:
            incident = parse_sentry(state.payload, path_prefix_strip=settings.path_prefix_strip)
            state.incident = incident
            state.environment = incident.environment
            log("parse", f"Parsed incident: {incident.exception_type} at {incident.file_path}:{incident.line_number}")
        except Exception as exc:  # noqa: BLE001
            state.status = "failed"
            log("parse", f"Failed to parse payload: {exc}", level="ERROR")
            save_run(run_id, state, db_path=db_path)
            return state

        fp = calc_fingerprint(incident)
        state.fingerprint = fp
        is_new = claim(fp, db_path=db_path)

        if not is_new:
            prev_row = lookup(fp, db_path=db_path)
            bump_count, comment_due = bump(fp, db_path=db_path)
            log("dedupe", f"Fingerprint {fp} previously seen. Count incremented to {bump_count}")
            if prev_row and prev_row.issue_number and comment_due:
                log("dedupe", f"Posting repeat comment to issue #{prev_row.issue_number}")
                publish_repeat_comment(
                    issue_number=prev_row.issue_number,
                    count=bump_count,
                    settings=settings,
                    client=http_client,
                )
            state.status = "suppressed"
            save_run(run_id, state, db_path=db_path)
            return state

        log("dedupe", f"Claimed new incident fingerprint: {fp}")

        state.status = "blaming"
        blame_res = find_culprit(incident, settings=settings, client=http_client)
        state.culprit = blame_res.culprit
        if blame_res.culprit:
            log(
                "blame",
                f"Suspect identified via {blame_res.source}: {blame_res.culprit.sha[:7]} "
                f"by @{blame_res.culprit.author_login or 'unknown'} (confidence: {blame_res.culprit.confidence})",
            )
            if blame_res.culprit.within_window:
                state.is_regression = True
        else:
            log("blame", f"No suspect identified: {blame_res.error or 'blame inconclusive'}", level="WARN")

        state.status = "explaining"
        if (time.monotonic() - start_time) > max_timeout_s:
            log(
                "pipeline",
                f"Pipeline exceeded {max_timeout_s}s timeout after blame. Falling back to evidence-only template.",
                level="WARN",
            )
            explain_res = None
        else:
            explain_res = explain_with_details(
                incident,
                state.culprit,
                other_commits=blame_res.other_commits,
                settings=settings,
                client=http_client,
            )

        if explain_res and explain_res.explanation:
            state.explanation = explain_res.explanation
            log(
                "explain",
                f"Root cause hypothesis generated via {explain_res.source} "
                f"(provider: {explain_res.provider or 'internal'})",
            )
        else:
            log(
                "explain",
                f"LLM explanation unavailable: {explain_res.reason if explain_res else 'timed out'}. Falling back to evidence-only template.",
                level="WARN",
            )

        severity, severity_reason = rate_with_reason(incident, settings=settings)
        state.severity = severity
        log("severity", f"Rated severity: {severity} ({severity_reason})")

        repo = settings.github_repository
        if state.project_id:
            try:
                from ichnoscope.projects import get_project

                proj = get_project(state.project_id, db_path=db_path)
                if proj and proj.github_repo_override:
                    repo = proj.github_repo_override
            except Exception:
                pass

        draft = build_issue_draft(
            incident=incident,
            culprit=state.culprit,
            explanation=state.explanation,
            severity=severity,
            severity_reason=severity_reason,
            fingerprint=fp,
            is_regression=state.is_regression,
            repo=repo,
            fallback_assignee=settings.fallback_assignee,
        )
        if not state.draft_title_override:
            state.draft_title_override = draft.title
        if not state.draft_body_override:
            state.draft_body_override = draft.body

        state.status = "staged_draft"
        log("dispatch", "Issue draft assembled and staged for Gate 2 review")
        save_run(run_id, state, db_path=db_path)
        return state
    except Exception as exc:  # noqa: BLE001
        state.status = "failed"
        log("pipeline", f"Unexpected pipeline failure: {exc}", level="ERROR")
        save_run(run_id, state, db_path=db_path)
        return state
    finally:
        if close_client:
            http_client.close()


def publish_draft_issue(
    run_id: str,
    *,
    db_path: str | None = None,
    settings: Settings | None = None,
    client: httpx.Client | None = None,
    title_override: str | None = None,
    body_override: str | None = None,
    custom_assignee: str | None = None,
) -> RunState:
    """Publish a Gate 2 draft to GitHub and notify Slack."""
    from ichnoscope.store import get_run

    settings = _settings(settings)
    state = get_run(run_id, db_path=db_path)
    if state is None:
        raise ValueError(f"Run '{run_id}' not found")
    if not state.incident:
        raise ValueError("Cannot publish run without parsed incident")

    log = _logger_for(run_id, state, db_path)
    http_client = client or httpx.Client()
    close_client = client is None
    title = title_override or state.draft_title_override
    body = body_override or state.draft_body_override
    assignee = custom_assignee or state.custom_assignee

    repo_override = None
    channel_override = None
    webhook_override = None
    if state.project_id:
        try:
            from ichnoscope.projects import get_project

            proj = get_project(state.project_id, db_path=db_path)
            if proj:
                if proj.github_repo or proj.github_repo_override:
                    repo_override = proj.github_repo or proj.github_repo_override
                if proj.slack_channel_override:
                    channel_override = proj.slack_channel_override
                if proj.webhook_url:
                    webhook_override = proj.webhook_url
                if proj.fallback_assignee and not assignee:
                    assignee = proj.fallback_assignee
        except Exception:
            pass

    try:
        pub_res = publish_issue(
            incident=state.incident,
            culprit=state.culprit,
            explanation=state.explanation,
            severity=state.severity or "P3-Medium",
            fingerprint=state.fingerprint,
            is_regression=state.is_regression,
            settings=settings,
            client=http_client,
            title_override=title,
            body_override=body,
            assignee_override=assignee,
            repo_override=repo_override,
        )
        state.issue_url = pub_res.issue_url
        state.status = "published"
        if state.fingerprint:
            attach(state.fingerprint, pub_res.issue_number, db_path=db_path)
        log("dispatch", f"Published GitHub issue #{pub_res.issue_number}: {pub_res.issue_url}")
        notify_slack(
            title=title or f"{state.incident.exception_type}: {state.incident.error_message}",
            severity=state.severity or "P3-Medium",
            assignee=pub_res.assignee,
            issue_url=pub_res.issue_url,
            webhook_url=webhook_override,
            channel_override=channel_override,
            settings=settings,
            client=http_client,
        )
        save_run(run_id, state, db_path=db_path)
        return state
    except Exception as exc:
        state.status = "failed"
        log("dispatch", f"Failed to publish issue: {exc}", level="ERROR")
        save_run(run_id, state, db_path=db_path)
        raise
    finally:
        if close_client:
            http_client.close()


def _mark_review(state: RunState, gate: str, action: str, reviewer: str, notes: str | None) -> None:
    review = GateApproval(
        approved_by=reviewer,
        approved_at=datetime.now(timezone.utc),
        reason=notes,
        action=action,  # type: ignore[arg-type]
    )
    if gate == "gate1":
        state.gate1_review = review
    else:
        state.gate2_review = review


def apply_policy_after_stage(
    run_id: str,
    state: RunState,
    *,
    db_path: str | None = None,
    settings: Settings | None = None,
    client: httpx.Client | None = None,
) -> tuple[RunState, PolicyDecision, bool]:
    """Advance a staged run according to automation policy. Returns (state, decision, auto_promoted)."""
    settings = _settings(settings)
    decision = evaluate_policy(state, settings=settings, db_path=db_path)
    log = _logger_for(run_id, state, db_path)
    auto_promoted = False

    if decision.matched_rule:
        log("policy", f"Matched rule '{decision.matched_rule}' (mode={decision.default_mode})")
    else:
        log("policy", f"Using default mode '{decision.default_mode}'")

    if decision.gate1 == "auto_dismiss":
        state.status = "dismissed"
        _mark_review(state, "gate1", "dismiss", f"policy:{decision.matched_rule or decision.default_mode}", "auto_dismiss")
        record_gate_review(
            run_id,
            "gate1",
            "dismiss",
            f"policy:{decision.matched_rule or decision.default_mode}",
            notes="auto_dismiss",
            db_path=db_path,
        )
        log("gate1", "Auto-dismissed by policy (zero AI tokens spent)")
        save_run(run_id, state, db_path=db_path)
        return state, decision, False

    if decision.gate1 == "auto_approve":
        auto_promoted = True
        _mark_review(state, "gate1", "auto_promoted", f"policy:{decision.matched_rule or decision.default_mode}", None)
        record_gate_review(
            run_id,
            "gate1",
            "auto_promoted",
            f"policy:{decision.matched_rule or decision.default_mode}",
            db_path=db_path,
        )
        log("gate1", "Auto-approved for AI investigation")
        save_run(run_id, state, db_path=db_path)
        state = execute_investigation(run_id, db_path=db_path, settings=settings, client=client)
        if state.is_gate2_pending and should_auto_publish(state, decision):
            _mark_review(state, "gate2", "auto_promoted", f"policy:{decision.matched_rule or decision.default_mode}", "auto_publish")
            record_gate_review(
                run_id,
                "gate2",
                "auto_promoted",
                f"policy:{decision.matched_rule or decision.default_mode}",
                notes="auto_publish",
                db_path=db_path,
            )
            log("gate2", "Auto-publishing high-confidence P1 draft")
            save_run(run_id, state, db_path=db_path)
            state = publish_draft_issue(run_id, db_path=db_path, settings=settings, client=client)
        return state, decision, auto_promoted

    save_run(run_id, state, db_path=db_path)
    return state, decision, False


def ingest_incident(
    payload: dict,
    *,
    run_id: str | None = None,
    db_path: str | None = None,
    settings: Settings | None = None,
    client: httpx.Client | None = None,
    project_id: str | None = None,
    environment: str | None = None,
    apply_policy: bool = True,
) -> tuple[str, RunState, bool]:
    """Server B ingress: stage at Gate 1, then optionally auto-dispatch."""
    settings = _settings(settings)
    active_run_id, state = stage_raw_incident(
        payload,
        run_id=run_id,
        db_path=db_path,
        settings=settings,
        project_id=project_id,
        environment=environment,
    )
    if not apply_policy:
        return active_run_id, state, False
    state, _decision, auto_promoted = apply_policy_after_stage(
        active_run_id,
        state,
        db_path=db_path,
        settings=settings,
        client=client,
    )
    return active_run_id, state, auto_promoted


def run_pipeline(
    payload: dict,
    *,
    run_id: str | None = None,
    auto_publish: bool = True,
    db_path: str | None = None,
    settings: Settings | None = None,
    client: httpx.Client | None = None,
    project_id: str | None = None,
) -> RunState:
    """Compatibility wrapper used by tests and replay: investigate immediately, optionally publish."""
    settings = _settings(settings)
    active_run_id = _new_run_id(run_id)
    resolved_proj_id = _infer_project_id(payload, project_id)
    state = RunState(payload=payload, status="received", project_id=resolved_proj_id)
    log = _logger_for(active_run_id, state, db_path)
    log("gateway", f"Received incident payload for run {active_run_id}")
    save_run(active_run_id, state, db_path=db_path)

    state = execute_investigation(
        active_run_id,
        db_path=db_path,
        settings=settings,
        client=client,
        payload=payload,
    )
    if state.status in {"failed", "suppressed"}:
        return state
    if auto_publish and state.is_gate2_pending:
        return publish_draft_issue(
            active_run_id,
            db_path=db_path,
            settings=settings,
            client=client,
        )
    return state
