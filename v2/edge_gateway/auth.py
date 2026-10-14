"""Project Key & DSN Authenticator for Server A Edge Gateway.

Supports standard Sentry client headers (`X-Sentry-Auth`), custom Ignoscope tokens (`X-Ignoscope-Token`),
and DSN query string parameters.
"""

from fastapi import Request

from v2.edge_gateway.config import get_gateway_config


class AuthenticationError(Exception):
    """Raised when request lacks valid project telemetry credentials."""


def extract_telemetry_key(
    request: Request,
    x_sentry_auth: str | None = None,
    x_ignoscope_token: str | None = None,
) -> str:
    """Extract project public key or secret token from incoming HTTP headers or query parameters."""
    # 1. Custom Ignoscope Header
    if x_ignoscope_token and x_ignoscope_token.strip():
        return x_ignoscope_token.strip()

    # 2. Standard Sentry Header: e.g. "Sentry sentry_version=7, sentry_key=XYZ123, sentry_client=..."
    if x_sentry_auth:
        for component in x_sentry_auth.split(","):
            trimmed = component.strip()
            if trimmed.startswith("sentry_key="):
                return trimmed.split("sentry_key=", 1)[1].strip()

    # 3. Authorization Bearer Token
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        return auth_header[7:].strip()

    # 4. Fallback to query parameter (common in browser SDK GET/POST transports)
    query_key = request.query_params.get("sentry_key")
    if query_key:
        return query_key.strip()

    return ""


def authenticate_project_request(
    project_id: str,
    request: Request,
    x_sentry_auth: str | None = None,
    x_ignoscope_token: str | None = None,
) -> str:
    """Validate project key against allowed configuration."""
    config = get_gateway_config()
    extracted_key = extract_telemetry_key(request, x_sentry_auth, x_ignoscope_token)

    if not extracted_key:
        raise AuthenticationError("Missing telemetry authentication key or DSN identifier.")

    # If key whitelisting is strictly enforced, ensure key is recognized
    if config.enforce_auth_whitelist:
        if extracted_key not in config.allowed_project_keys:
            raise AuthenticationError(f"Unauthorized or revoked telemetry key: '{extracted_key}'")

    return extracted_key
