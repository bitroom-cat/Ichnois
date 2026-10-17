"""Comprehensive verification for Multi-Tenant Workspace Isolation and Authorization."""

import time
import uuid
import jwt
import pytest
from fastapi.testclient import TestClient

from ichnoscope.main import app
from ichnoscope.projects import create_project, list_projects, get_project
from ichnoscope.workspaces import ensure_user_workspace
from ichnoscope.models import RunState


def _generate_mock_jwt(user_id: str, email: str) -> str:
    """Generate a test Supabase Bearer token for a given user."""
    payload = {
        "sub": user_id,
        "email": email,
        "role": "authenticated",
        "aud": "authenticated",
        "exp": int(time.time()) + 3600,
    }
    return jwt.encode(payload, "test-secret-non-verified", algorithm="HS256")


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def test_multi_tenant_workspace_isolation(client: TestClient) -> None:
    # 1. Setup two distinct users
    user1_id = f"usr_{uuid.uuid4().hex[:8]}"
    user1_email = "cometosatyam2@gmail.com"
    token1 = _generate_mock_jwt(user1_id, user1_email)

    user2_id = f"usr_{uuid.uuid4().hex[:8]}"
    user2_email = "iotbytehub@gmail.com"
    token2 = _generate_mock_jwt(user2_id, user2_email)

    headers1 = {"Authorization": f"Bearer {token1}"}
    headers2 = {"Authorization": f"Bearer {token2}"}

    # 2. Both users fetch their projects
    r1 = client.get("/api/projects", headers=headers1)
    assert r1.status_code == 200, r1.text
    p1_initial = r1.json()

    r2 = client.get("/api/projects", headers=headers2)
    assert r2.status_code == 200, r2.text
    p2_initial = r2.json()

    # Verify each has an initial project in their private workspace
    assert len(p1_initial) >= 1
    assert len(p2_initial) >= 1

    p1_ids = {p["project_id"] for p in p1_initial}
    p2_ids = {p["project_id"] for p in p2_initial}

    # Invariant 1: No project overlap between user 1 and user 2
    assert p1_ids.isdisjoint(p2_ids), f"Users shared initial projects! p1: {p1_ids}, p2: {p2_ids}"

    # 3. User 1 creates a new microservice project
    create_resp1 = client.post(
        "/api/projects",
        headers=headers1,
        json={
            "name": "CometoSatyam Payment Gateway",
            "environment": "production",
            "rate_limit_min": 100,
        },
    )
    assert create_resp1.status_code == 200, create_resp1.text
    created_p1 = create_resp1.json()
    p1_new_id = created_p1["project_id"]

    # 4. User 1 should see the new project
    r1_after = client.get("/api/projects", headers=headers1)
    assert r1_after.status_code == 200
    user1_project_ids = [p["project_id"] for p in r1_after.json()]
    assert p1_new_id in user1_project_ids

    # 5. User 2 MUST NEVER see User 1's new project
    r2_after = client.get("/api/projects", headers=headers2)
    assert r2_after.status_code == 200
    user2_project_ids = [p["project_id"] for p in r2_after.json()]
    assert p1_new_id not in user2_project_ids

    # 6. User 2 trying to GET User 1's project directly MUST return 404 Not Found
    direct_get = client.get(f"/api/projects/{p1_new_id}", headers=headers2)
    assert direct_get.status_code == 404

    # 7. User 2 trying to PATCH or DELETE User 1's project directly MUST return 404 Not Found
    direct_patch = client.patch(f"/api/projects/{p1_new_id}", headers=headers2, json={"name": "Hacked"})
    assert direct_patch.status_code == 404

    direct_delete = client.delete(f"/api/projects/{p1_new_id}", headers=headers2)
    assert direct_delete.status_code == 404

    # 8. Workspace metrics isolation: User 2's metrics must not count User 1's project
    m2 = client.get("/api/workspace/metrics", headers=headers2)
    assert m2.status_code == 200
    assert m2.json()["active_projects_count"] == len(user2_project_ids)

    # 9. Workspaces isolation: User 1 and User 2 list their workspaces
    ws1 = client.get("/api/workspaces", headers=headers1).json()
    ws2 = client.get("/api/workspaces", headers=headers2).json()
    assert len(ws1) == 1
    assert len(ws2) == 1
    assert ws1[0]["workspace_id"] != ws2[0]["workspace_id"]

    # 10. Incident / Run isolation: Save a run under User 1's project
    from ichnoscope.store import save_run
    from ichnoscope.models import RunState, Incident
    from datetime import datetime, timezone
    run1_id = f"run_{uuid.uuid4().hex[:10]}"
    state1 = RunState(
        fingerprint=f"fp_{uuid.uuid4().hex[:8]}",
        status="staged_draft",
        project_id=p1_new_id,
        payload={"project_id": p1_new_id},
        incident=Incident(
            incident_id="inc-123",
            occurred_at=datetime.now(timezone.utc),
            exception_type="ZeroDivisionError",
            error_message="division by zero in payment",
            file_path="src/pay.py",
            line_number=42,
            stack_excerpt="Traceback...",
            users_affected=10,
            event_count=20,
        ),
    )
    save_run(run1_id, state1)

    # User 1 should see their run
    runs1 = client.get("/api/runs", headers=headers1).json()
    assert any(r["id"] == run1_id for r in runs1)

    # User 2 MUST NEVER see User 1's run
    runs2 = client.get("/api/runs", headers=headers2).json()
    assert not any(r["id"] == run1_id for r in runs2)

    # User 2 attempting to view User 1's run details directly gets 404
    r2_direct_run = client.get(f"/api/runs/{run1_id}", headers=headers2)
    assert r2_direct_run.status_code == 404
