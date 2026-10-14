"""Automation policy engine for dual-gated Server B triage."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

from ichnoscope.config import Settings
from ichnoscope.models import RunState
from ichnoscope.store import ensure_default_policy, list_policies

Gate1Action = Literal["require_manual", "auto_approve", "auto_dismiss"]
Gate2Action = Literal["require_manual", "auto_publish"]


@dataclass(frozen=True)
class PolicyDecision:
    """Resolved gate behavior for a staged incident."""

    default_mode: str
    matched_rule: str | None
    gate1: Gate1Action
    gate2: Gate2Action
    slack_alert: bool = False


def _as_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item) for item in value]
    return [str(value)]


def _env_of(state: RunState) -> str:
    if state.environment:
        return state.environment
    if state.incident and state.incident.environment:
        return state.incident.environment
    payload = state.payload or {}
    tags = payload.get("tags") if isinstance(payload.get("tags"), dict) else {}
    return str(payload.get("environment") or tags.get("environment") or "production")


def _exception_of(state: RunState) -> str | None:
    if state.incident:
        return state.incident.exception_type
    payload = state.payload or {}
    values = (payload.get("exception") or {}).get("values") if isinstance(payload.get("exception"), dict) else None
    if isinstance(values, list) and values:
        return values[0].get("type")
    return None


def _severity_of(state: RunState) -> str | None:
    return state.severity


def _rule_matches(condition: dict[str, Any], state: RunState) -> bool:
    if not condition:
        return True
    env = _env_of(state).strip().lower()
    wanted_env = condition.get("environment")
    if wanted_env is not None:
        env_ok = env in {item.strip().lower() for item in _as_list(wanted_env)}
        if not env_ok:
            return False

    wanted_sev = condition.get("severity")
    if wanted_sev is not None:
        current = (_severity_of(state) or "").strip()
        if current not in _as_list(wanted_sev):
            return False

    wanted_exc = condition.get("exception_type")
    if wanted_exc is not None:
        current_exc = _exception_of(state) or ""
        if current_exc not in _as_list(wanted_exc):
            return False
    return True


def _mode_actions(mode: str) -> tuple[Gate1Action, Gate2Action]:
    normalized = (mode or "semi_autonomous").lower().replace("-", "_")
    if normalized in {"full_manual", "manual"}:
        return "require_manual", "require_manual"
    if normalized in {"fully_autonomous", "full_auto", "autonomous"}:
        return "auto_approve", "auto_publish"
    return "auto_approve", "require_manual"


def evaluate_policy(
    state: RunState,
    *,
    settings: Settings | None = None,
    db_path: str | None = None,
) -> PolicyDecision:
    """Return the first matching rule, otherwise the organization default mode."""
    if settings is None:
        from ichnoscope.config import get_settings

        settings = get_settings()

    ensure_default_policy(default_mode=settings.automation_mode, db_path=db_path)
    policies = [p for p in list_policies(db_path=db_path) if p.get("is_active")]
    default_mode = settings.automation_mode
    rules: list[dict[str, Any]] = []
    for policy in policies:
        rule_doc = policy.get("rule") or {}
        if rule_doc.get("default_mode"):
            default_mode = str(rule_doc["default_mode"])
        rules.extend(rule_doc.get("rules") or [])

    gate1, gate2 = _mode_actions(default_mode)
    for rule in rules:
        condition = rule.get("condition") or {}
        if not _rule_matches(condition, state):
            continue
        action = rule.get("action") or {}
        g1 = action.get("gate1", gate1)
        g2 = action.get("gate2", gate2)
        if g1 not in {"require_manual", "auto_approve", "auto_dismiss"}:
            g1 = gate1
        if g2 not in {"require_manual", "auto_publish"}:
            g2 = gate2
        return PolicyDecision(
            default_mode=default_mode,
            matched_rule=str(rule.get("name") or "unnamed"),
            gate1=g1,
            gate2=g2,
            slack_alert=bool(action.get("slack_alert")),
        )

    return PolicyDecision(
        default_mode=default_mode,
        matched_rule=None,
        gate1=gate1,
        gate2=gate2,
    )


def should_auto_publish(state: RunState, decision: PolicyDecision) -> bool:
    """Full-auto publish only for high-confidence P1 drafts."""
    if decision.gate2 != "auto_publish":
        return False
    if state.severity != "P1-Critical":
        return False
    if state.culprit is None:
        return False
    return state.culprit.confidence == "high"
