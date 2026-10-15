"""Incident deduplication, fingerprinting, and SQLite lifecycle state tracking."""

import hashlib
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path

from ichnoscope.db import get_db, init_db as db_init
from ichnoscope.models import Incident

DEFAULT_DB_FILE: str = "ichnoscope.db"
DEFAULT_COMMENT_INTERVAL_S: float = 900.0  # 15 minutes


@dataclass(frozen=True)
class SeenRow:
    """Persistent deduplication record representing an incident fingerprint in SQLite."""

    fp: str
    issue_number: int | None
    count: int
    first_seen: float
    last_seen: float
    last_comment_at: float | None


def fingerprint_from_parts(exception_type: str, file_path: str, line_number: int) -> str:
    """Generate deterministic 12-char hex fingerprint from incident coordinates."""
    raw = f"{exception_type.strip()}|{file_path.strip()}|{line_number}".encode()
    return hashlib.sha256(raw).hexdigest()[:12]


def fingerprint(incident: Incident) -> str:
    """Calculate stable fingerprint from Incident exception type, file path, and line."""
    return fingerprint_from_parts(
        incident.exception_type,
        incident.file_path,
        incident.line_number,
    )


def init_db(db_path: Path | str | None = None) -> Path | str:
    """Initialize deduplication database schema and return path/target."""
    return db_init(db_path)


def claim(
    fp: str,
    db_path: Path | str | None = None,
    now: float | None = None,
    stale_timeout_s: float = 300.0,
) -> bool:
    """Claim a fingerprint as a new incident; reclaims stale abandoned runs if issue_number is NULL and older than stale_timeout_s."""
    init_db(db_path)
    ts = now if now is not None else time.time()
    try:
        with get_db(db_path) as conn:
            # Check for existing stale claim without attached issue
            cursor = conn.execute(
                "SELECT first_seen, issue_number FROM seen WHERE fp = ?;",
                (fp,),
            )
            row = cursor.fetchone()
            if row:
                first_seen = float(row[0])
                issue_num = row[1]
                if issue_num is None and (ts - first_seen) > stale_timeout_s:
                    # Previous run crashed or was abandoned before issue creation; reclaim
                    conn.execute(
                        """
                        UPDATE seen
                        SET count = 1, first_seen = ?, last_seen = ?, last_comment_at = NULL
                        WHERE fp = ?;
                        """,
                        (ts, ts, fp),
                    )
                    return True
                return False

            conn.execute(
                """
                INSERT INTO seen (fp, count, first_seen, last_seen, last_comment_at)
                VALUES (?, 1, ?, ?, NULL);
                """,
                (fp, ts, ts),
            )
            return True
    except sqlite3.IntegrityError:
        return False



def lookup(fp: str, db_path: Path | str | None = None) -> SeenRow | None:
    """Look up an existing fingerprint record in SQLite."""
    init_db(db_path)
    with get_db(db_path) as conn:
        cursor = conn.execute(
            """
            SELECT fp, issue_number, count, first_seen, last_seen, last_comment_at
            FROM seen
            WHERE fp = ?;
            """,
            (fp,),
        )
        row = cursor.fetchone()
        if not row:
            return None
        return SeenRow(
            fp=row[0],
            issue_number=row[1],
            count=row[2],
            first_seen=row[3],
            last_seen=row[4],
            last_comment_at=row[5],
        )


def bump(
    fp: str,
    db_path: Path | str | None = None,
    now: float | None = None,
    interval_seconds: float = DEFAULT_COMMENT_INTERVAL_S,
) -> tuple[int, bool]:
    """Increment event count on repeat and report whether a new comment is due."""
    init_db(db_path)
    ts = now if now is not None else time.time()
    with get_db(db_path) as conn:
        cursor = conn.execute(
            "SELECT count, last_comment_at FROM seen WHERE fp = ?;",
            (fp,),
        )
        row = cursor.fetchone()
        if not row:
            # If not yet claimed, insert it
            conn.execute(
                "INSERT INTO seen (fp, count, first_seen, last_seen) VALUES (?, 1, ?, ?);",
                (fp, ts, ts),
            )
            return (1, False)

        cur_count = int(row[0])
        last_comment = float(row[1]) if row[1] is not None else None
        new_count = cur_count + 1
        comment_due = last_comment is None or (ts - last_comment >= interval_seconds)

        if comment_due:
            conn.execute(
                "UPDATE seen SET count = ?, last_seen = ?, last_comment_at = ? WHERE fp = ?;",
                (new_count, ts, ts, fp),
            )
        else:
            conn.execute(
                "UPDATE seen SET count = ?, last_seen = ? WHERE fp = ?;",
                (new_count, ts, fp),
            )

        return (new_count, comment_due)


def attach(fp: str, issue_number: int, db_path: Path | str | None = None) -> None:
    """Associate created GitHub issue number with fingerprint."""
    init_db(db_path)
    with get_db(db_path) as conn:
        conn.execute(
            "UPDATE seen SET issue_number = ? WHERE fp = ?;",
            (issue_number, fp),
        )


def delete_record(fp: str, db_path: Path | str | None = None) -> bool:
    """Delete a fingerprint record, used when a closed issue regresses."""
    init_db(db_path)
    with get_db(db_path) as conn:
        cursor = conn.execute("DELETE FROM seen WHERE fp = ?;", (fp,))
        return cursor.rowcount > 0
