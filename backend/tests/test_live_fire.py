"""Automated test verifying incident dispatch to the Edge Gateway API."""

import pytest
from scripts.fire_test_incident import build_sentry_payload, SCENARIOS


def test_build_sentry_payload_structure():
    """Verify generated Sentry envelope has all standard fields and PII headers."""
    payload, title = build_sentry_payload("payment_crash", environment="staging", include_pii=True)

    assert "event_id" in payload
    assert payload["platform"] == "python"
    assert payload["environment"] == "staging"
    assert payload["exception"]["values"][0]["type"] == "KeyError"
    assert payload["user"]["email"] == "customer_alice@example.com"
    assert "Authorization" in payload["request"]["headers"]
    assert "Bearer" in payload["request"]["headers"]["Authorization"]


def test_scenario_catalog():
    """Verify all scenarios produce valid exception descriptors."""
    for key in SCENARIOS:
        payload, title = build_sentry_payload(key)
        assert len(payload["exception"]["values"]) == 1
        exc = payload["exception"]["values"][0]
        assert exc["type"]
        assert exc["value"]
