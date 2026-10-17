import pytest
from fastapi.testclient import TestClient
from ichnoscope.main import app
from ichnoscope.projects import create_project, connect_github_project, disconnect_github_project, get_project

client = TestClient(app)

def test_github_project_link_and_unlink(tmp_path):
    db_file = tmp_path / "test_proj.db"
    proj = create_project("Test Connect Project", db_path=db_file)
    assert proj.github_installation_id is None
    assert proj.github_repo is None

    # Connect
    updated = connect_github_project(proj.project_id, "987654", "acme/repo-web", db_path=db_file)
    assert updated.github_installation_id == "987654"
    assert updated.github_repo == "acme/repo-web"
    assert updated.github_repo_override == "acme/repo-web"

    # Verify retrieval
    fetched = get_project(proj.project_id, db_path=db_file)
    assert fetched.github_installation_id == "987654"
    assert fetched.github_repo == "acme/repo-web"

    # Disconnect
    unlinked = disconnect_github_project(proj.project_id, db_path=db_file)
    assert unlinked.github_installation_id is None
    assert unlinked.github_repo is None

def test_api_install_url():
    resp = client.get("/api/projects/proj_default/github/install-url")
    assert resp.status_code == 200
    data = resp.json()
    assert "install_url" in data
    assert "https://github.com/apps/" in data["install_url"]
    assert "proj_default" in data["install_url"]
