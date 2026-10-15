import hashlib
import json
import logging
import os
import sqlite3
import time
from pathlib import Path
import sys

import httpx

_CURRENT_DIR = str(Path(__file__).resolve().parent)
if _CURRENT_DIR not in sys.path:
    sys.path.insert(0, _CURRENT_DIR)

try:
    from v2.edge_gateway.config import get_gateway_config
except ImportError:
    from config import get_gateway_config

logger = logging.getLogger("edge_gateway.forwarder")

DEFAULT_DLQ_DB = os.getenv("EDGE_DLQ_DB_PATH", str(Path(_CURRENT_DIR) / "edge_dlq.db"))


def init_dlq_db(db_path: str = DEFAULT_DLQ_DB) -> None:
    """Initialize dead-letter queue table for failed event delivery."""
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS edge_dlq (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at REAL NOT NULL,
                attempts INTEGER DEFAULT 1,
                last_attempt_at REAL NOT NULL,
                project_id TEXT,
                envelope_json TEXT NOT NULL
            );
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_dlq_attempts ON edge_dlq(attempts);")


def enqueue_dlq(envelope: dict, db_path: str = DEFAULT_DLQ_DB) -> None:
    """Store failed incident envelope in local DLQ for asynchronous retry."""
    init_dlq_db(db_path)
    now = time.time()
    try:
        with sqlite3.connect(db_path) as conn:
            conn.execute(
                """
                INSERT INTO edge_dlq (created_at, attempts, last_attempt_at, project_id, envelope_json)
                VALUES (?, 1, ?, ?, ?);
                """,
                (now, now, envelope.get("project_id"), json.dumps(envelope)),
            )
        logger.info(
            "Spooled failed incident for project '%s' to local edge DLQ",
            envelope.get("project_id"),
        )
    except Exception as exc:
        logger.error("Failed to write to edge DLQ: %s", exc)


def drain_dlq(max_batch: int = 10, db_path: str = DEFAULT_DLQ_DB) -> int:
    """Retry queued incidents from DLQ to Server B. Returns count of successfully drained events."""
    init_dlq_db(db_path)
    config = get_gateway_config()
    headers = {
        "Authorization": f"Bearer {config.internal_gateway_secret}",
        "X-Gateway-Node": "edge-gateway-node-01",
        "Content-Type": "application/json",
    }

    with sqlite3.connect(db_path) as conn:
        cursor = conn.execute(
            "SELECT id, attempts, envelope_json FROM edge_dlq WHERE attempts < 5 ORDER BY id ASC LIMIT ?;",
            (max_batch,),
        )
        rows = cursor.fetchall()

    if not rows:
        return 0

    drained = 0
    now = time.time()
    for row_id, attempts, envelope_json in rows:
        try:
            envelope = json.loads(envelope_json)
            with httpx.Client(timeout=4.0) as client:
                resp = client.post(config.internal_core_url, json=envelope, headers=headers)
                if resp.status_code in (200, 201, 202):
                    with sqlite3.connect(db_path) as conn:
                        conn.execute("DELETE FROM edge_dlq WHERE id = ?;", (row_id,))
                    drained += 1
                else:
                    with sqlite3.connect(db_path) as conn:
                        conn.execute(
                            "UPDATE edge_dlq SET attempts = attempts + 1, last_attempt_at = ? WHERE id = ?;",
                            (now, row_id),
                        )
        except Exception:
            with sqlite3.connect(db_path) as conn:
                conn.execute(
                    "UPDATE edge_dlq SET attempts = attempts + 1, last_attempt_at = ? WHERE id = ?;",
                    (now, row_id),
                )

    if drained > 0:
        logger.info("Successfully drained %d events from edge DLQ to Server B", drained)
    return drained


def forward_to_server_b(
    project_id: str,
    environment: str,
    client_ip: str,
    sanitized_payload: dict,
    db_path: str = DEFAULT_DLQ_DB,
) -> bool:
    """Deliver sanitized payload across the secure boundary to Server B internal ingress with DLQ fallback."""
    config = get_gateway_config()

    # Deterministic, privacy-preserving cryptographic hash of client IP
    client_ip_hash = hashlib.sha256(client_ip.encode("utf-8")).hexdigest()[:16]

    envelope = {
        "gateway_received_at": time.time(),
        "project_id": project_id,
        "environment": environment,
        "client_ip_hash": client_ip_hash,
        "sanitized_payload": sanitized_payload,
    }

    headers = {
        "Authorization": f"Bearer {config.internal_gateway_secret}",
        "X-Gateway-Node": "edge-gateway-node-01",
        "Content-Type": "application/json",
    }

    try:
        with httpx.Client(timeout=4.0) as client:
            resp = client.post(config.internal_core_url, json=envelope, headers=headers)
            if resp.status_code in (200, 201, 202):
                logger.info(
                    "Successfully delivered incident (project: %s) to Server B (HTTP %d)",
                    project_id,
                    resp.status_code,
                )
                # Opportunity drain on successful connection
                try:
                    drain_dlq(max_batch=3, db_path=db_path)
                except Exception:
                    pass
                return True

            logger.warning(
                "Server B rejected forwarded incident: HTTP %d %s (spooling to DLQ)",
                resp.status_code,
                resp.text,
            )
            enqueue_dlq(envelope, db_path=db_path)
            return False
    except Exception as exc:
        logger.error(
            "Failed to reach Server B at %s: %s (spooling to DLQ)",
            config.internal_core_url,
            exc,
        )
        enqueue_dlq(envelope, db_path=db_path)
        return False

