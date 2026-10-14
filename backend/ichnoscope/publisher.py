"""GitHub issue creation and repeat event comment publisher."""

import logging
from dataclasses import dataclass

import httpx

from ichnoscope.config import Settings
from ichnoscope.dedupe import fingerprint as calc_fingerprint
from ichnoscope.models import Culprit, Explanation, Incident, Severity
from ichnoscope.templates import build_issue_draft

logger = logging.getLogger(__name__)

GITHUB_REST_API: str = "https://api.github.com"


class PublisherError(Exception):
    """Exception raised when publishing to GitHub fails."""


@dataclass(frozen=True)
class PublishResult:
    """Outcome of publishing a triaged issue to GitHub."""

    issue_number: int
    issue_url: str
    assignee: str | None
    labels: list[str]


def render_repeat_comment(count: int) -> str:
    """Format markdown message for repeated incident events on an open issue."""
    return (
        f":warning: **Repeated Incident Detected**\n\n"
        f"Seen {count} more times in production since triage.\n"
        f"_Automated duplicate tracking by Ichnoscope._"
    )


def check_assignable(
    client: httpx.Client,
    owner: str,
    repo: str,
    login: str,
    token: str | None,
) -> bool:
    """Check whether a user login can be assigned to issues in the repository."""
    if not login:
        return False
    url = f"{GITHUB_REST_API}/repos/{owner}/{repo}/assignees/{login}"
    headers = {"Accept": "application/vnd.github.v3+json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    try:
        resp = client.get(url, headers=headers, timeout=10.0)
        return resp.status_code == 204
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to check assignability for @%s: %s", login, exc)
        return False


def publish_issue(
    incident: Incident,
    culprit: Culprit | None,
    explanation: Explanation | None,
    severity: Severity,
    *,
    severity_reason: str = "Calculated from incident telemetry",
    fingerprint: str | None = None,
    is_regression: bool = False,
    previous_issue_number: int | None = None,
    settings: Settings | None = None,
    client: httpx.Client | None = None,
    title_override: str | None = None,
    body_override: str | None = None,
    assignee_override: str | None = None,
) -> PublishResult:
    """Publish a drafted incident issue to GitHub, honoring dry_run mode."""
    if settings is None:
        from ichnoscope.config import get_settings

        settings = get_settings()

    owner = settings.github_owner
    repo = settings.github_repo_name
    token = settings.github_token.get_secret_value() if settings.github_token else None
    fp = fingerprint or calc_fingerprint(incident)

    draft = build_issue_draft(
        incident=incident,
        culprit=culprit,
        explanation=explanation,
        severity=severity,
        severity_reason=severity_reason,
        fingerprint=fp,
        is_regression=is_regression,
        previous_issue_number=previous_issue_number,
        repo=settings.github_repository,
        fallback_assignee=assignee_override or settings.fallback_assignee,
    )
    if title_override:
        draft.title = title_override
    if body_override:
        draft.body = body_override
    if assignee_override:
        draft.suggested_owner = assignee_override

    # Dry run returns simulated response without network calls
    if settings.dry_run:
        simulated_num = 999
        simulated_url = f"https://github.com/{owner or 'mock-owner'}/{repo or 'mock-repo'}/issues/{simulated_num}"
        return PublishResult(
            issue_number=simulated_num,
            issue_url=simulated_url,
            assignee=draft.suggested_owner,
            labels=draft.labels,
        )

    if not owner or not repo or not token:
        raise PublisherError("GitHub repository and token must be configured when DRY_RUN is false")

    http_client = client or httpx.Client()
    close_client = client is None

    try:
        # Check assignability of suggested owner
        assignee = draft.suggested_owner
        if assignee and not check_assignable(http_client, owner, repo, assignee, token):
            if settings.fallback_assignee and check_assignable(http_client, owner, repo, settings.fallback_assignee, token):
                assignee = settings.fallback_assignee
            else:
                assignee = None

        url = f"{GITHUB_REST_API}/repos/{owner}/{repo}/issues"
        headers = {
            "Accept": "application/vnd.github.v3+json",
            "Authorization": f"Bearer {token}",
        }
        payload: dict = {
            "title": draft.title,
            "body": draft.body,
            "labels": draft.labels,
        }
        if assignee:
            payload["assignees"] = [assignee]

        # Retry up to 3 times on transient errors
        last_exc: Exception | None = None
        for _ in range(3):
            try:
                resp = http_client.post(url, headers=headers, json=payload, timeout=20.0)
                if resp.status_code == 201:
                    data = resp.json()
                    return PublishResult(
                        issue_number=int(data["number"]),
                        issue_url=str(data["html_url"]),
                        assignee=assignee,
                        labels=draft.labels,
                    )
                if 400 <= resp.status_code < 500:
                    raise PublisherError(f"GitHub client error HTTP {resp.status_code}: {resp.text[:120]}")
            except (httpx.TimeoutException, httpx.TransportError) as exc:
                last_exc = exc

        raise PublisherError(f"Failed to create GitHub issue after retries: {last_exc}")
    finally:
        if close_client:
            http_client.close()


def publish_repeat_comment(
    issue_number: int,
    count: int,
    *,
    settings: Settings | None = None,
    client: httpx.Client | None = None,
) -> bool:
    """Post repeat occurrence comment to an open GitHub issue."""
    if settings is None:
        from ichnoscope.config import get_settings

        settings = get_settings()

    if settings.dry_run:
        return True

    owner = settings.github_owner
    repo = settings.github_repo_name
    token = settings.github_token.get_secret_value() if settings.github_token else None

    if not owner or not repo or not token:
        logger.warning("Cannot post comment: repository or token unconfigured")
        return False

    url = f"{GITHUB_REST_API}/repos/{owner}/{repo}/issues/{issue_number}/comments"
    headers = {
        "Accept": "application/vnd.github.v3+json",
        "Authorization": f"Bearer {token}",
    }
    payload = {"body": render_repeat_comment(count)}

    http_client = client or httpx.Client()
    close_client = client is None

    try:
        resp = http_client.post(url, headers=headers, json=payload, timeout=15.0)
        return resp.status_code == 201
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to post repeat comment to issue #%d: %s", issue_number, exc)
        return False
    finally:
        if close_client:
            http_client.close()
