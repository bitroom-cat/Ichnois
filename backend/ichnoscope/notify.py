"""Best-effort notifications to Slack incoming webhooks for triaged incidents."""

import logging

import httpx

from ichnoscope.config import Settings
from ichnoscope.redact import redact

logger = logging.getLogger(__name__)


def notify_slack(
    title: str,
    severity: str,
    assignee: str | None,
    issue_url: str,
    *,
    webhook_url: str | None = None,
    channel_override: str | None = None,
    settings: Settings | None = None,
    client: httpx.Client | None = None,
) -> bool:
    """Send formatted notification to Slack incoming webhook; always best-effort and non-blocking."""
    target_url = webhook_url
    if channel_override and (channel_override.startswith("http://") or channel_override.startswith("https://")):
        target_url = channel_override

    if not target_url:
        if settings is None:
            from ichnoscope.config import get_settings

            settings = get_settings()
        if settings.slack_webhook_url:
            target_url = settings.slack_webhook_url.get_secret_value()

    if not target_url:
        return False

    clean_title = redact(title)
    owner = assignee if assignee else "unassigned"

    payload: dict = {
        "text": f"*{clean_title}* ({severity}) - @{owner}: {issue_url}",
        "blocks": [
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": (
                        f":rotating_light: *[Auto-Triage] {clean_title}*\n"
                        f"*Severity:* `{severity}` | *Assignee:* `@{owner}`\n"
                        f"<{issue_url}|View GitHub Issue>"
                    ),
                },
            }
        ],
    }
    if channel_override and not channel_override.startswith("http"):
        payload["channel"] = channel_override

    http_client = client or httpx.Client()
    close_client = client is None

    try:
        resp = http_client.post(target_url, json=payload, timeout=5.0)
        if resp.status_code in (200, 204):
            return True
        logger.warning("Slack webhook returned HTTP %d: %s", resp.status_code, resp.text[:120])
        return False
    except Exception as exc:  # noqa: BLE001 - notifications are best-effort only
        logger.warning("Failed to deliver Slack notification: %s", exc)
        return False
    finally:
        if close_client:
            http_client.close()
