import pytest
from unittest.mock import patch
from fastapi.testclient import TestClient
from ichnoscope.main import app
from ichnoscope.projects import list_projects, ensure_default_project
from ichnoscope.store import save_run, get_workspace_metrics, list_runs
from ichnoscope.models import RunState

client = TestClient(app)

def test_default_microservices_seeded(tmp_path):
    db_file = tmp_path / "test_seed.db"
    ensure_default_project(db_path=db_file)
    projects = list_projects(db_path=db_file)
    project_ids = {p.project_id for p in projects}
    assert "checkout-service" in project_ids
    assert "auth-service" in project_ids
    assert "inventory-service" in project_ids
    assert "edge-gateway" in project_ids
    assert "proj_default" in project_ids

def test_workspace_metrics_calculation(tmp_path):
    db_file = tmp_path / "test_metrics.db"
    ensure_default_project(db_path=db_file)

    # Save a run for checkout-service
    r1 = RunState(status="staged_raw", project_id="checkout-service", payload={"event_id": "e1"})
    save_run("run_chk_1", r1, db_path=db_file)

    # Save a run for auth-service
    r2 = RunState(status="staged_draft", project_id="auth-service", payload={"event_id": "e2"})
    save_run("run_auth_1", r2, db_path=db_file)

    # Global metrics
    global_metrics = get_workspace_metrics(project_id=None, db_path=db_file)
    assert global_metrics["total_runs"] >= 2
    assert global_metrics["staged_raw_count"] >= 1
    assert global_metrics["staged_draft_count"] >= 1
    assert global_metrics["project_id"] == "ALL_PROJECTS"

    # Scoped metrics for checkout-service
    chk_metrics = get_workspace_metrics(project_id="checkout-service", db_path=db_file)
    assert chk_metrics["total_runs"] == 1
    assert chk_metrics["staged_raw_count"] == 1
    assert chk_metrics["staged_draft_count"] == 0
    assert chk_metrics["project_id"] == "checkout-service"

def test_api_workspace_metrics_endpoint():
    resp = client.get("/api/workspace/metrics")
    assert resp.status_code == 200
    data = resp.json()
    assert "total_runs" in data
    assert "staged_raw_count" in data
    assert "active_projects_count" in data

def test_api_project_scoped_ingress():
    with patch("ichnoscope.main.ingest_incident") as mock_ingest:
        mock_state = RunState(status="staged_raw", project_id="checkout-service", payload={"event_id": "test_evt"})
        mock_ingest.return_value = ("run_test_123", mock_state, False)
        resp = client.post("/api/checkout-service/store/", json={"event_id": "test_evt", "message": "Crash in checkout"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["project_id"] == "checkout-service"
        assert data["id"] == "run_test_123"
        mock_ingest.assert_called_once()
