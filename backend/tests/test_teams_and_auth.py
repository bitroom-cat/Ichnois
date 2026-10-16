"""Tests for Supabase JWT verification, role hierarchy, and team RBAC endpoints."""

import os
import time
import pytest
import jwt
from fastapi.testclient import TestClient

from ichnoscope.main import app
from ichnoscope.auth_middleware import decode_supabase_token, get_current_user
from ichnoscope.teams import (
    has_permission,
    upsert_user_profile,
    add_team_member,
    update_member_role,
    remove_team_member,
    get_project_members,
    get_user_projects,
    get_user_role,
)
from ichnoscope.projects import create_project

JWT_SECRET = "test-secret-key-11685354"


@pytest.fixture(autouse=True)
def setup_test_env(tmp_path, monkeypatch):
    test_db = tmp_path / "test_auth_runs.db"
    monkeypatch.setenv("RUNS_DB", str(test_db))
    monkeypatch.setenv("SUPABASE_JWT_SECRET", JWT_SECRET)
    monkeypatch.setenv("ADMIN_TOKEN", "legacy-admin-secret-token")
    monkeypatch.delenv("TURSO_DATABASE_URL", raising=False)
    monkeypatch.delenv("TURSO_AUTH_TOKEN", raising=False)


def generate_test_jwt(sub: str, email: str, role: str = "authenticated", exp_delta: int = 3600) -> str:
    payload = {
        "sub": sub,
        "email": email,
        "role": role,
        "aud": "authenticated",
        "iat": int(time.time()),
        "exp": int(time.time()) + exp_delta,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def test_decode_supabase_token_valid():
    token = generate_test_jwt("user-123", "alice@test.com")
    claims = decode_supabase_token(token)
    assert claims["sub"] == "user-123"
    assert claims["email"] == "alice@test.com"


def test_decode_supabase_token_expired():
    token = generate_test_jwt("user-expired", "bob@test.com", exp_delta=-100)
    with pytest.raises(Exception):
        decode_supabase_token(token)


def test_role_hierarchy():
    assert has_permission("owner", "viewer") is True
    assert has_permission("owner", "admin") is True
    assert has_permission("admin", "member") is True
    assert has_permission("member", "admin") is False
    assert has_permission("viewer", "member") is False
    assert has_permission(None, "viewer") is False


def test_team_crud_and_profiles(tmp_path):
    test_db = tmp_path / "team_test.db"

    # 1. Upsert profile
    upsert_user_profile(
        user_id="usr_001",
        email="sre@example.com",
        display_name="SRE Lead",
        db_path=test_db,
    )

    # 2. Add team member
    member = add_team_member(
        project_id="proj_alpha",
        user_id="usr_001",
        role="admin",
        invited_by="usr_owner",
        db_path=test_db,
    )
    assert member["role"] == "admin"
    assert member["user_id"] == "usr_001"

    # 3. Check role
    role = get_user_role("usr_001", "proj_alpha", db_path=test_db)
    assert role == "admin"

    # 4. List members
    members = get_project_members("proj_alpha", db_path=test_db)
    assert len(members) == 1
    assert members[0]["email"] == "sre@example.com"
    assert members[0]["display_name"] == "SRE Lead"

    # 5. Update role
    updated = update_member_role("proj_alpha", "usr_001", "owner", db_path=test_db)
    assert updated["role"] == "owner"

    # 6. Remove member
    deleted = remove_team_member("proj_alpha", "usr_001", db_path=test_db)
    assert deleted is True
    assert get_user_role("usr_001", "proj_alpha", db_path=test_db) is None


def test_fastapi_auth_middleware_with_jwt_and_legacy():
    client = TestClient(app)

    # 1. Request without token -> 401
    res_no_auth = client.get("/api/runs")
    assert res_no_auth.status_code == 401

    # 2. Request with legacy token -> 200
    res_legacy = client.get(
        "/api/runs",
        headers={"Authorization": "Bearer legacy-admin-secret-token"},
    )
    assert res_legacy.status_code == 200

    # 3. Request with valid Supabase JWT -> 200
    valid_jwt = generate_test_jwt("user-sre-99", "dev@ichnoscope.io")
    res_jwt = client.get(
        "/api/runs",
        headers={"Authorization": f"Bearer {valid_jwt}"},
    )
    assert res_jwt.status_code == 200

    # 4. Request with invalid token -> 401
    res_bad_jwt = client.get(
        "/api/runs",
        headers={"Authorization": "Bearer invalid.jwt.token"},
    )
    assert res_bad_jwt.status_code == 401


def test_api_team_endpoints():
    client = TestClient(app)
    headers = {"Authorization": "Bearer legacy-admin-secret-token"}

    # Create project first
    client.post(
        "/api/projects",
        json={"project_id": "proj_omega", "name": "Omega Service"},
        headers=headers,
    )

    # Add member via API
    add_res = client.post(
        "/api/projects/proj_omega/members",
        json={
            "user_id": "usr_omega_1",
            "email": "omega@company.com",
            "display_name": "Omega Lead",
            "role": "admin",
        },
        headers=headers,
    )
    assert add_res.status_code == 200
    assert add_res.json()["member"]["role"] == "admin"

    # List members via API
    list_res = client.get("/api/projects/proj_omega/members", headers=headers)
    assert list_res.status_code == 200
    assert list_res.json()["count"] == 1
    assert list_res.json()["members"][0]["user_id"] == "usr_omega_1"

    # Update member role via API
    patch_res = client.patch(
        "/api/projects/proj_omega/members/usr_omega_1",
        json={"role": "owner"},
        headers=headers,
    )
    assert patch_res.status_code == 200
    assert patch_res.json()["member"]["role"] == "owner"

    # Delete member via API
    del_res = client.delete(
        "/api/projects/proj_omega/members/usr_omega_1",
        headers=headers,
    )
    assert del_res.status_code == 200
    assert del_res.json()["status"] == "removed"
