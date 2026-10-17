"""Tests for multi-project CRUD, key rotation, edge cache synchronization, and repo overrides."""

from __future__ import annotations

import tempfile
from fastapi.testclient import TestClient
import pytest

from ichnoscope.api import router
from ichnoscope.main import app as server_b_app
from ichnoscope.projects import (
    create_project,
    delete_project,
    ensure_default_project,
    get_project,
    get_project_by_public_key,
    list_projects,
    rotate_project_key,
    update_project,
)
from v2.edge_gateway.app import app as edge_app
from v2.edge_gateway.auth import (
    authenticate_project_request,
    get_all_cached_keys,
    get_cached_project,
    invalidate_project_key,
    update_cached_project,
)


@pytest.fixture
def temp_db(tmp_path):
    return tmp_path / "test_projects.db"


def test_project_crud_lifecycle(temp_db):
    # 1. Initial list ensures default project
    projects = list_projects(db_path=temp_db)
    assert len(projects) >= 1
    assert any(p.project_id == "proj_default" for p in projects)

    # 2. Create project
    proj = create_project(
        name="Billing Microservice",
        environment="staging",
        rate_limit_min=150,
        github_repo_override="org/billing-service",
        slack_channel_override="#billing-alerts",
        db_path=temp_db,
    )
    assert proj.project_id.startswith("proj_")
    assert proj.public_key.startswith("pk_live_")
    assert proj.secret_key.startswith("sk_live_")
    assert proj.github_repo_override == "org/billing-service"
    assert proj.slack_channel_override == "#billing-alerts"

    # 3. Get by project_id and public_key
    fetched = get_project(proj.project_id, db_path=temp_db)
    assert fetched is not None
    assert fetched.name == "Billing Microservice"

    fetched_key = get_project_by_public_key(proj.public_key, db_path=temp_db)
    assert fetched_key is not None
    assert fetched_key.project_id == proj.project_id

    # 4. Rotate key
    old_pub = proj.public_key
    rotated = rotate_project_key(proj.project_id, db_path=temp_db)
    assert rotated is not None
    assert rotated.public_key != old_pub
    assert rotated.public_key.startswith("pk_live_")

    # 5. Update project
    updated = update_project(
        proj.project_id,
        {"name": "Billing Microservice V2", "rate_limit_min": 200},
        db_path=temp_db,
    )
    assert updated.name == "Billing Microservice V2"
    assert updated.rate_limit_min == 200

    # 6. Delete project
    deleted = delete_project(proj.project_id, db_path=temp_db)
    assert deleted is True
    assert get_project(proj.project_id, db_path=temp_db) is None


def test_server_b_project_endpoints(monkeypatch):
    monkeypatch.setenv("ADMIN_TOKEN", "test-admin-secret-999")
    monkeypatch.setenv("INTERNAL_GATEWAY_SECRET", "test-gateway-secret-888")
    client = TestClient(server_b_app)

    # Unauthorized access to /api/projects
    resp = client.get("/api/projects")
    assert resp.status_code == 401

    auth_headers = {"Authorization": "Bearer test-admin-secret-999"}

    # List projects
    resp = client.get("/api/projects", headers=auth_headers)
    assert resp.status_code == 200
    initial_count = len(resp.json())

    # Create project
    create_payload = {
        "name": "Auth Service",
        "environment": "production",
        "rate_limit_min": 180,
        "github_repo_override": "my-org/auth-api",
        "slack_channel_override": "https://hooks.slack.com/services/test/test",
    }
    resp = client.post("/api/projects", json=create_payload, headers=auth_headers)
    assert resp.status_code == 200
    created = resp.json()
    proj_id = created["project_id"]
    pub_key = created["public_key"]
    assert pub_key.startswith("pk_live_")

    # Internal cache sync endpoint
    gateway_headers = {"Authorization": "Bearer test-gateway-secret-888"}
    resp = client.get("/internal/v1/projects/cache", headers=gateway_headers)
    assert resp.status_code == 200
    cache_data = resp.json()
    assert "projects" in cache_data
    assert pub_key in cache_data["projects"]
    assert cache_data["projects"][pub_key]["project_id"] == proj_id

    # Rotate credentials
    resp = client.post(f"/api/projects/{proj_id}/keys/rotate", headers=auth_headers)
    assert resp.status_code == 200
    rotated_data = resp.json()
    new_pub_key = rotated_data["public_key"]
    assert new_pub_key != pub_key

    # Delete project
    resp = client.delete(f"/api/projects/{proj_id}", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["status"] == "deleted"


def test_edge_cache_invalidation_and_auth(monkeypatch):
    from v2.edge_gateway.config import get_gateway_config
    cfg = get_gateway_config()
    cfg.enforce_auth_whitelist = True
    cfg.internal_gateway_secret = "test-edge-secret-777"
    client = TestClient(edge_app)

    # 1. Update edge memory cache with new dynamic project key
    test_key = "pk_live_custom_dynamic_key_42"
    update_cached_project(test_key, {"project_id": "proj_custom_42", "name": "Dynamic Service"})

    assert test_key in get_all_cached_keys()
    assert get_cached_project(test_key)["project_id"] == "proj_custom_42"

    # 2. Ingest telemetry using the dynamic key on Edge Gateway
    payload = {
        "event_id": "e2e-project-cache-test",
        "exception": {
            "values": [
                {
                    "type": "RuntimeError",
                    "value": "Dynamic key test",
                    "stacktrace": {"frames": [{"filename": "main.py", "lineno": 10}]},
                }
            ]
        },
    }
    resp = client.post(
        "/api/proj_custom_42/store/",
        json=payload,
        headers={"X-Sentry-Auth": f"Sentry sentry_key={test_key}"},
    )
    assert resp.status_code == 202
    assert resp.json()["status"] == "accepted"

    # 3. Invalidate/Revoke key via webhook
    revoke_headers = {"Authorization": "Bearer test-edge-secret-777"}
    resp = client.post(
        "/internal/v1/cache/keys/invalidate",
        json={"action": "revoke", "public_key": test_key},
        headers=revoke_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "revoked"

    # 4. Now that key is revoked, Edge Gateway rejects unauthorized request
    resp = client.post(
        "/api/proj_custom_42/store/",
        json=payload,
        headers={"X-Sentry-Auth": f"Sentry sentry_key={test_key}"},
    )
    assert resp.status_code == 401
