"""Pytest configuration and environment isolation for backend tests."""

import pytest
from ichnoscope.config import get_settings


@pytest.fixture(autouse=True)
def isolate_test_environment(monkeypatch):
    """Ensure local .env credentials do not leak into unit tests unless explicitly set."""
    monkeypatch.setenv("ADMIN_TOKEN", "")
    monkeypatch.setenv("SUPABASE_JWT_SECRET", "")
    monkeypatch.setenv("TURSO_DATABASE_URL", "")
    monkeypatch.setenv("TURSO_AUTH_TOKEN", "")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()
