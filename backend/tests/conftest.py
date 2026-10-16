"""Pytest configuration and environment isolation for backend tests."""

import pytest
from ichnoscope.config import get_settings


@pytest.fixture(autouse=True)
def isolate_test_environment(monkeypatch):
    """Ensure local .env credentials do not leak into unit tests unless explicitly set."""
    monkeypatch.delenv("ADMIN_TOKEN", raising=False)
    monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)
    monkeypatch.delenv("TURSO_DATABASE_URL", raising=False)
    monkeypatch.delenv("TURSO_AUTH_TOKEN", raising=False)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()
