"""Unit tests for backend/ichnoscope/dedupe.py."""

from datetime import datetime, timezone
from pathlib import Path

from ichnoscope.dedupe import (
    attach,
    bump,
    claim,
    delete_record,
    fingerprint,
    fingerprint_from_parts,
    lookup,
)
from ichnoscope.models import Incident


def _make_incident(**kwargs) -> Incident:
    base = {
        "incident_id": "test-inc-dedupe",
        "occurred_at": datetime(2026, 10, 4, 12, 0, 0, tzinfo=timezone.utc),
        "exception_type": "KeyError",
        "error_message": "'test'",
        "file_path": "services/auth.py",
        "line_number": 50,
        "stack_excerpt": "error line",
    }
    base.update(kwargs)
    return Incident(**base)


def test_fingerprint_stability():
    inc1 = _make_incident()
    inc2 = _make_incident()

    fp1 = fingerprint(inc1)
    fp2 = fingerprint(inc2)

    assert len(fp1) == 12
    assert fp1 == fp2
    assert fp1 == fingerprint_from_parts("KeyError", "services/auth.py", 50)

    # Different coordinates produce different fingerprints
    fp_diff_line = fingerprint(_make_incident(line_number=51))
    fp_diff_type = fingerprint(_make_incident(exception_type="ValueError"))
    fp_diff_path = fingerprint(_make_incident(file_path="services/other.py"))

    assert fp_diff_line != fp1
    assert fp_diff_type != fp1
    assert fp_diff_path != fp1


def test_claim_and_lookup(tmp_path: Path):
    db_file = tmp_path / "test_seen.db"
    fp = "abcd1234ef56"

    # Initially missing
    assert lookup(fp, db_path=db_file) is None

    # First claim succeeds
    assert claim(fp, db_path=db_file, now=1000.0) is True

    # Duplicate claim fails
    assert claim(fp, db_path=db_file, now=1010.0) is False

    row = lookup(fp, db_path=db_file)
    assert row is not None
    assert row.fp == fp
    assert row.count == 1
    assert row.first_seen == 1000.0
    assert row.last_seen == 1000.0
    assert row.issue_number is None


def test_bump_and_rate_limiting(tmp_path: Path):
    db_file = tmp_path / "test_seen.db"
    fp = "fe654321dcba"

    claim(fp, db_path=db_file, now=1000.0)

    # First repeat (last_comment_at was None) -> comment is due
    count, comment_due = bump(fp, db_path=db_file, now=1050.0)
    assert count == 2
    assert comment_due is True

    # Immediate next repeat (5 seconds later) -> suppressed
    count2, comment_due2 = bump(fp, db_path=db_file, now=1055.0)
    assert count2 == 3
    assert comment_due2 is False

    # Repeat after 15 minutes (900 seconds) -> comment is due again
    count3, comment_due3 = bump(fp, db_path=db_file, now=1050.0 + 901.0)
    assert count3 == 4
    assert comment_due3 is True


def test_attach_and_regression_delete(tmp_path: Path):
    db_file = tmp_path / "test_seen.db"
    fp = "112233445566"

    claim(fp, db_path=db_file, now=1000.0)
    attach(fp, issue_number=42, db_path=db_file)

    row = lookup(fp, db_path=db_file)
    assert row is not None
    assert row.issue_number == 42

    # Delete row when issue regresses
    assert delete_record(fp, db_path=db_file) is True
    assert lookup(fp, db_path=db_file) is None

    # Can now be re-claimed cleanly
    assert claim(fp, db_path=db_file, now=2000.0) is True


def test_stale_claim_reclamation(tmp_path: Path):
    db_file = tmp_path / "test_stale.db"
    fp = "998877665544"

    # Initial claim at t=1000
    assert claim(fp, db_path=db_file, now=1000.0) is True

    # Duplicate claim within 300s fails
    assert claim(fp, db_path=db_file, now=1200.0, stale_timeout_s=300.0) is False

    # Stale claim after 300s (e.g. t=1305) without attached issue is reclaimed!
    assert claim(fp, db_path=db_file, now=1305.0, stale_timeout_s=300.0) is True

    # If issue was attached, it is NOT reclaimed even after timeout (it's active)
    attach(fp, issue_number=101, db_path=db_file)
    assert claim(fp, db_path=db_file, now=2000.0, stale_timeout_s=300.0) is False

