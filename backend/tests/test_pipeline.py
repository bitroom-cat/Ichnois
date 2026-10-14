"""Unit tests for backend/ichnoscope/pipeline.py."""

import json
from pathlib import Path

from ichnoscope.config import load_settings
from ichnoscope.pipeline import run_pipeline


FIXTURES_DIR = Path(__file__).resolve().parents[1] / "fixtures"


def _load_fixture() -> dict:
    fixture_path = FIXTURES_DIR / "bug1_keyerror_payment.json"
    return json.loads(fixture_path.read_text(encoding="utf-8"))


def test_pipeline_happy_path(tmp_path: Path):
    payload = _load_fixture()
    db_file = str(tmp_path / "pipeline1.db")

    # Configure stub modes for completely deterministic offline execution
    settings = load_settings({
        "USE_STUB_GITHUB": "true",
        "USE_STUB_LLM": "true",
        "DRY_RUN": "true",
        "GITHUB_REPOSITORY": "testowner/testrepo",
        "PATH_PREFIX_STRIP": "/app/",
    })

    state = run_pipeline(payload, run_id="run-happy-1", auto_publish=True, db_path=db_file, settings=settings)

    assert state.status == "published"
    assert state.incident is not None
    assert state.incident.exception_type == "KeyError"
    assert state.incident.file_path == "services/payment.py"
    assert state.incident.line_number == 84

    assert state.culprit is not None
    assert state.culprit.sha == "d3e5f60718293a4b5c6d7e8f9012345a14b9f2c7"

    assert state.explanation is not None
    assert state.explanation.domain == "backend"
    assert len(state.explanation.checklist) == 3

    assert state.severity in ("P1-Critical", "P2-High", "P3-Medium")
    assert state.issue_url is not None
    assert "https://github.com/testowner/testrepo/issues/" in state.issue_url
    assert len(state.logs) >= 5


def test_pipeline_duplicate_suppression(tmp_path: Path):
    payload = _load_fixture()
    db_file = str(tmp_path / "pipeline2.db")
    settings = load_settings({
        "USE_STUB_GITHUB": "true",
        "USE_STUB_LLM": "true",
        "DRY_RUN": "true",
        "GITHUB_REPOSITORY": "testowner/testrepo",
        "PATH_PREFIX_STRIP": "/app/",
    })

    # First run publishes
    first_state = run_pipeline(payload, run_id="run-dup-1", auto_publish=True, db_path=db_file, settings=settings)
    assert first_state.status == "published"

    # Second run with same payload is suppressed
    second_state = run_pipeline(payload, run_id="run-dup-2", auto_publish=True, db_path=db_file, settings=settings)
    assert second_state.status == "suppressed"


def test_pipeline_draft_ready_mode(tmp_path: Path):
    payload = _load_fixture()
    db_file = str(tmp_path / "pipeline3.db")
    settings = load_settings({
        "USE_STUB_GITHUB": "true",
        "USE_STUB_LLM": "true",
        "DRY_RUN": "true",
        "GITHUB_REPOSITORY": "testowner/testrepo",
    })

    state = run_pipeline(payload, run_id="run-draft-1", auto_publish=False, db_path=db_file, settings=settings)
    assert state.status in ("draft_ready", "staged_draft")
    assert state.incident is not None
    assert state.explanation is not None


def test_pipeline_invalid_payload():
    settings = load_settings({"DRY_RUN": "true"})
    state = run_pipeline({"invalid": "payload"}, run_id="run-fail-1", settings=settings)
    assert state.status == "failed"
    assert any("Failed to parse" in log for log in state.logs)
