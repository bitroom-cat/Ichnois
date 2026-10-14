"""Data Loss Prevention (DLP) & PII scrubbing layer for Server A Edge Gateway.

Strips secrets, credentials, tokens, and personal identifiers before telemetry crosses the network boundary.
"""

import json
import re

PATTERNS = [
    # Private Key blocks
    (
        re.compile(r"-----BEGIN [A-Z0-9 _-]+PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 _-]+PRIVATE KEY-----"),
        "[REDACTED:private_key]",
    ),
    # Slack Webhooks
    (
        re.compile(r"https://hooks\.slack\.com/services/[A-Za-z0-9_-]{3,64}/[A-Za-z0-9_-]{3,64}/[A-Za-z0-9_-]{10,64}"),
        "[REDACTED:slack_webhook]",
    ),
    # GitHub Tokens (ghp_, gho_, github_pat_)
    (
        re.compile(r"\bgh[pousr]_[A-Za-z0-9]{36,255}\b|\bgithub_pat_[A-Za-z0-9_]{22,255}\b"),
        "[REDACTED:github_token]",
    ),
    # AWS Access Keys
    (
        re.compile(r"\b(A[KS]IA)[0-9A-Z]{16}\b"),
        "[REDACTED:aws_key]",
    ),
    # Google API Keys
    (
        re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b"),
        "[REDACTED:google_key]",
    ),
    # JWT Tokens
    (
        re.compile(r"\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b"),
        "[REDACTED:jwt]",
    ),
    # Bearer / Basic Auth Headers
    (
        re.compile(r"\b(Bearer|Basic)\s+(?!\[REDACTED:)([A-Za-z0-9_.-]{16,255})\b"),
        r"\1 [REDACTED:bearer]",
    ),
    # Secret Key/Password Assignments in Text
    (
        re.compile(
            r"""(?i)(["']?(?:[a-zA-Z0-9_]*(?:password|passwd|secret|token|api_key|apikey|access_key|client_secret)[a-zA-Z0-9_]*)["']?\s*[:=]\s*)(["'])(?!\[REDACTED:)([^"'\r\n]{8,})\2"""
        ),
        r"\1\2[REDACTED:secret_literal]\2",
    ),
    # Email Addresses
    (
        re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"),
        "[REDACTED:email]",
    ),
]


def scrub_pii_and_secrets(payload: dict) -> dict:
    """Scrub sensitive credentials and PII from a parsed telemetry dictionary."""
    raw_str = json.dumps(payload)
    for pattern, replacement in PATTERNS:
        raw_str = pattern.sub(replacement, raw_str)

    clean_dict = json.loads(raw_str)

    # Explicitly strip sensitive HTTP request headers if present in Sentry format
    if "request" in clean_dict and isinstance(clean_dict["request"], dict):
        headers = clean_dict["request"].get("headers")
        if isinstance(headers, dict):
            for sensitive_header in ["cookie", "authorization", "x-auth-token", "proxy-authorization"]:
                headers.pop(sensitive_header, None)
                headers.pop(sensitive_header.title(), None)

    return clean_dict
