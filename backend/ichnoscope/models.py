"""Data models and type definitions for the Ichnoscope incident-triage pipeline; called by parse, blame, explain, dispatch, and the API."""

from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

Domain = Literal["backend", "frontend", "database", "infra"]
Severity = Literal["P1-Critical", "P2-High", "P3-Medium"]
Confidence = Literal["high", "low"]
RunStatus = Literal[
    "received",
    "staged_raw",
    "dismissed",
    "analyzing",
    "parsing",
    "blaming",
    "explaining",
    "staged_draft",
    "draft_ready",
    "published",
    "rejected",
    "failed",
    "suppressed",
]

AutomationMode = Literal["full_manual", "semi_autonomous", "fully_autonomous"]
GateName = Literal["gate1", "gate2"]
GateAction = Literal["approve", "dismiss", "reject", "auto_promoted"]


def _ensure_utc(dt: datetime) -> datetime:
    """Ensure datetime is timezone-aware UTC. If naive, assume UTC."""
    if dt.tzinfo is None or dt.tzinfo.utcoffset(dt) is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


class Incident(BaseModel):
    """Normalized incident representation extracted from Sentry telemetry; built by code only."""

    model_config = ConfigDict(extra="ignore")

    incident_id: str
    source: str = "sentry"
    occurred_at: datetime
    release_sha: str | None = None
    exception_type: str
    error_message: str
    file_path: str
    line_number: int = Field(ge=1)
    stack_excerpt: str
    environment: str = "production"
    event_count: int = Field(default=1, ge=1)
    users_affected: int = Field(default=0, ge=0)

    @field_validator("occurred_at", mode="after")
    @classmethod
    def validate_occurred_at(cls, v: datetime) -> datetime:
        return _ensure_utc(v)

    @field_validator("file_path", mode="after")
    @classmethod
    def validate_file_path(cls, v: str) -> str:
        path = v.strip()
        while path.startswith(("./", "/")):
            if path.startswith("./"):
                path = path[2:]
            elif path.startswith("/"):
                path = path[1:]
        return path

    @field_validator("stack_excerpt", mode="after")
    @classmethod
    def validate_stack_excerpt(cls, v: str) -> str:
        if len(v) > 4000:
            return v[:4000]
        return v


class Culprit(BaseModel):
    """Suspect commit details correlated with the failing line at release SHA; built by code only."""

    sha: str
    author_login: str | None = None
    author_name: str
    message: str
    committed_at: datetime
    pr_number: int | None = None
    diff: str = ""
    within_window: bool = False
    confidence: Confidence = "high"

    @field_validator("committed_at", mode="after")
    @classmethod
    def validate_committed_at(cls, v: datetime) -> datetime:
        return _ensure_utc(v)

    @field_validator("diff", mode="after")
    @classmethod
    def validate_diff(cls, v: str) -> str:
        if len(v) > 6000:
            return v[:6000] + "\n... [truncated]"
        return v


class Explanation(BaseModel):
    """Structured incident explanation and verification checklist; the ONLY output emitted by the LLM."""

    model_config = ConfigDict(extra="forbid")

    domain: Domain
    root_cause_hypothesis: str
    checklist: list[str]

    @field_validator("root_cause_hypothesis", mode="after")
    @classmethod
    def validate_hypothesis(cls, v: str) -> str:
        stripped = v.strip()
        if not stripped:
            raise ValueError("root_cause_hypothesis cannot be empty")
        if len(stripped) > 1200:
            raise ValueError("root_cause_hypothesis exceeds 1200 characters")
        return stripped

    @field_validator("checklist", mode="after")
    @classmethod
    def validate_checklist(cls, v: list[str]) -> list[str]:
        if len(v) != 3:
            raise ValueError("checklist must contain exactly 3 items")
        cleaned: list[str] = []
        for idx, item in enumerate(v):
            stripped = item.strip()
            if not stripped:
                raise ValueError(f"checklist item {idx + 1} cannot be empty or whitespace-only")
            if len(stripped) > 300:
                raise ValueError(f"checklist item {idx + 1} exceeds 300 characters")
            cleaned.append(stripped)
        return cleaned


class GateApproval(BaseModel):
    """Human or policy decision recorded at Gate 1 (ingest) or Gate 2 (publish)."""

    approved_by: str | None = None
    approved_at: datetime | None = None
    reason: str | None = None
    action: GateAction | None = None

    @field_validator("approved_at", mode="after")
    @classmethod
    def validate_approved_at(cls, v: datetime | None) -> datetime | None:
        return _ensure_utc(v) if v is not None else None


class RunState(BaseModel):
    """Pipeline execution state tracking an incident run from receipt to GitHub issue draft; built by code."""

    payload: dict
    fingerprint: str = ""
    is_regression: bool = False
    incident: Incident | None = None
    culprit: Culprit | None = None
    explanation: Explanation | None = None
    severity: Severity | None = None
    status: RunStatus = "staged_raw"
    issue_url: str | None = None
    logs: list[str] = Field(default_factory=list)
    project_id: str | None = None
    environment: str | None = None
    gate1_review: GateApproval | None = None
    gate2_review: GateApproval | None = None
    draft_title_override: str | None = None
    draft_body_override: str | None = None
    custom_assignee: str | None = None

    def add_log(self, message: str) -> None:
        """Append an audit log line with current UTC timestamp formatted as 'HH:MM:SS message'."""
        now_str = datetime.now(timezone.utc).strftime("%H:%M:%S")
        self.logs.append(f"{now_str} {message}")

    @property
    def is_gate1_pending(self) -> bool:
        return self.status in {"staged_raw", "received"}

    @property
    def is_gate2_pending(self) -> bool:
        return self.status in {"staged_draft", "draft_ready"}

    @property
    def is_analyzing(self) -> bool:
        return self.status in {"analyzing", "parsing", "blaming", "explaining"}


def explanation_json_schema() -> dict:
    """Return the JSON Schema for the Explanation model, used to constrain structured LLM output."""
    return Explanation.model_json_schema()
