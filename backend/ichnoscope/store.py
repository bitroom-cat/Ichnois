"""Persistence layer storing incident RunState records and pipeline execution logs."""

import json
import time
from pathlib import Path
from typing import Any

from ichnoscope.db import get_db, init_db
from ichnoscope.models import RunState

_METRICS_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}


def invalidate_metrics_cache() -> None:
    """Clear in-memory cached workspace metrics."""
    global _METRICS_CACHE
    _METRICS_CACHE.clear()


def save_run(
    run_id: str,
    state: RunState,
    db_path: Path | str | None = None,
    now: float | None = None,
) -> None:
    """Insert or update a RunState record in the database."""
    path = init_db(db_path)
    ts = now if now is not None else time.time()

    proj_id = (
        getattr(state, "project_id", None)
        or (state.payload.get("project_id") if isinstance(state.payload, dict) else None)
        or "checkout-service"
    )
    if not getattr(state, "project_id", None):
        state.project_id = proj_id

    state_json = json.dumps(state.model_dump(mode="json"))

    with get_db(db_path) as conn:
        ws_id = None
        if proj_id:
            try:
                ws_cur = conn.execute("SELECT workspace_id FROM project_keys WHERE project_id = ? LIMIT 1;", (proj_id,))
                ws_row = ws_cur.fetchone()
                if ws_row and ws_row[0]:
                    ws_id = ws_row[0]
            except Exception:
                pass

        cursor = conn.execute("SELECT created_at FROM runs WHERE id = ?;", (run_id,))
        row = cursor.fetchone()
        raw_payload = json.dumps(state.payload)
        if row:
            conn.execute(
                """
                UPDATE runs
                SET fingerprint = ?, status = ?, severity = ?, is_regression = ?,
                    issue_url = ?, draft_title = ?, draft_body = ?, raw_payload = ?,
                    project_id = ?, workspace_id = ?, state_json = ?, updated_at = ?
                WHERE id = ?;
                """,
                (
                    state.fingerprint,
                    state.status,
                    state.severity,
                    1 if state.is_regression else 0,
                    state.issue_url,
                    state.draft_title_override,
                    state.draft_body_override,
                    raw_payload,
                    proj_id,
                    ws_id,
                    state_json,
                    ts,
                    run_id,
                ),
            )
        else:
            conn.execute(
                """
                INSERT INTO runs (
                    id, fingerprint, status, severity, is_regression, issue_url,
                    draft_title, draft_body, raw_payload, project_id, workspace_id, state_json, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
                """,
                (
                    run_id,
                    state.fingerprint,
                    state.status,
                    state.severity,
                    1 if state.is_regression else 0,
                    state.issue_url,
                    state.draft_title_override,
                    state.draft_body_override,
                    raw_payload,
                    proj_id,
                    ws_id,
                    state_json,
                    ts,
                    ts,
                ),
            )
        invalidate_metrics_cache()


def get_run(run_id: str, db_path: Path | str | None = None) -> RunState | None:
    """Retrieve RunState by run ID, restoring logs from log store."""
    path = init_db(db_path)
    with get_db(db_path) as conn:
        cursor = conn.execute("SELECT state_json, project_id FROM runs WHERE id = ?;", (run_id,))
        row = cursor.fetchone()
        if not row:
            return None
        data = json.loads(row[0])
        col_proj_id = row[1] if len(row) > 1 else None
        if not data.get("project_id"):
            data["project_id"] = col_proj_id or "checkout-service"
        state = RunState.model_validate(data)
        if not state.project_id:
            state.project_id = col_proj_id or "checkout-service"

        # Merge stored log entries if not already embedded
        log_rows = conn.execute(
            "SELECT step, level, message FROM run_logs WHERE run_id = ? ORDER BY id ASC;",
            (run_id,),
        ).fetchall()
        if log_rows and not state.logs:
            rebuilt_logs = [f"[{r[1]}] {r[0]}: {r[2]}" for r in log_rows]
            state.logs = rebuilt_logs

        return state


def list_runs(
    db_path: Path | str | None = None,
    limit: int = 50,
    status: str | None = None,
    project_id: str | None = None,
    allowed_project_ids: list[str] | set[str] | None = None,
) -> list[tuple[str, RunState]]:
    """List most recently updated runs up to limit, optionally filtered by status and project_id."""
    init_db(db_path)
    with get_db(db_path) as conn:
        query = "SELECT id, state_json, project_id FROM runs"
        params: list[Any] = []
        wheres: list[str] = []
        if status:
            wheres.append("status = ?")
            params.append(status)
        if allowed_project_ids is not None:
            if not allowed_project_ids:
                return []
            if project_id and project_id not in ("ALL_PROJECTS", "all", "ALL"):
                if project_id not in allowed_project_ids:
                    return []
                wheres.append("project_id = ?")
                params.append(project_id)
            else:
                placeholders = ",".join("?" for _ in allowed_project_ids)
                wheres.append(f"project_id IN ({placeholders})")
                params.extend(list(allowed_project_ids))
        elif project_id and project_id not in ("ALL_PROJECTS", "all", "ALL"):
            wheres.append("project_id = ?")
            params.append(project_id)
        if wheres:
            query += " WHERE " + " AND ".join(wheres)
        query += " ORDER BY updated_at DESC LIMIT ?;"
        params.append(limit)

        cursor = conn.execute(query, tuple(params))
        results: list[tuple[str, RunState]] = []
        for r_id, raw_json, col_proj_id in cursor.fetchall():
            try:
                data = json.loads(raw_json)
                if not data.get("project_id"):
                    data["project_id"] = col_proj_id or "checkout-service"
                state = RunState.model_validate(data)
                if not state.project_id:
                    state.project_id = col_proj_id or "checkout-service"
                results.append((r_id, state))
            except Exception:  # noqa: BLE001, S112
                continue
        return results


def record_gate_review(
    run_id: str,
    gate: str,
    action: str,
    reviewer: str,
    notes: str | None = None,
    db_path: Path | str | None = None,
    now: float | None = None,
) -> None:
    """Persist a Gate 1 or Gate 2 audit record."""
    init_db(db_path)
    ts = now if now is not None else time.time()
    with get_db(db_path) as conn:
        conn.execute(
            """
            INSERT INTO gate_reviews (run_id, gate, action, reviewer, notes, created_at)
            VALUES (?, ?, ?, ?, ?, ?);
            """,
            (run_id, gate, action, reviewer, notes, ts),
        )


def list_gate_reviews(
    run_id: str,
    db_path: Path | str | None = None,
) -> list[dict[str, Any]]:
    """Return gate review history for a run."""
    init_db(db_path)
    with get_db(db_path) as conn:
        cursor = conn.execute(
            """
            SELECT gate, action, reviewer, notes, created_at
            FROM gate_reviews
            WHERE run_id = ?
            ORDER BY id ASC;
            """,
            (run_id,),
        )
        return [
            {
                "gate": row[0],
                "action": row[1],
                "reviewer": row[2],
                "notes": row[3],
                "created_at": row[4],
            }
            for row in cursor.fetchall()
        ]


def list_policies(db_path: Path | str | None = None) -> list[dict[str, Any]]:
    """Return automation policies, newest first."""
    init_db(db_path)
    with get_db(db_path) as conn:
        cursor = conn.execute(
            """
            SELECT id, name, is_active, rule_json, created_at, updated_at
            FROM automation_policies
            ORDER BY updated_at DESC;
            """
        )
        items: list[dict[str, Any]] = []
        for row in cursor.fetchall():
            try:
                rule = json.loads(row[3]) if row[3] else {}
            except json.JSONDecodeError:
                rule = {}
            items.append(
                {
                    "id": row[0],
                    "name": row[1],
                    "is_active": bool(row[2]),
                    "rule": rule,
                    "created_at": row[4],
                    "updated_at": row[5],
                }
            )
        return items


def upsert_policy(
    policy_id: str,
    name: str,
    rule: dict[str, Any],
    *,
    is_active: bool = True,
    db_path: Path | str | None = None,
) -> dict[str, Any]:
    """Insert or replace an automation policy document."""
    init_db(db_path)
    ts = time.time()
    rule_json = json.dumps(rule)
    with get_db(db_path) as conn:
        cursor = conn.execute("SELECT created_at FROM automation_policies WHERE id = ?;", (policy_id,))
        row = cursor.fetchone()
        created_at = row[0] if row else ts
        if row:
            conn.execute(
                """
                UPDATE automation_policies
                SET name = ?, is_active = ?, rule_json = ?, updated_at = ?
                WHERE id = ?;
                """,
                (name, 1 if is_active else 0, rule_json, ts, policy_id),
            )
        else:
            conn.execute(
                """
                INSERT INTO automation_policies (id, name, is_active, rule_json, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?);
                """,
                (policy_id, name, 1 if is_active else 0, rule_json, created_at, ts),
            )
    return {
        "id": policy_id,
        "name": name,
        "is_active": is_active,
        "rule": rule,
        "created_at": created_at,
        "updated_at": ts,
    }


_DEFAULT_POLICY_CACHED: dict[str, Any] | None = None


def ensure_default_policy(
    default_mode: str = "semi_autonomous",
    db_path: Path | str | None = None,
) -> dict[str, Any]:
    """Seed the organization default policy if none exist."""
    global _DEFAULT_POLICY_CACHED
    if _DEFAULT_POLICY_CACHED is not None and db_path is None:
        return _DEFAULT_POLICY_CACHED
    policies = list_policies(db_path=db_path)
    if policies:
        _DEFAULT_POLICY_CACHED = policies[0]
        return policies[0]
    res = upsert_policy(
        "org-default",
        "Organization Default",
        {
            "default_mode": default_mode,
            "rules": [
                {
                    "name": "Production Critical Escalation",
                    "condition": {"environment": "production", "severity": "P1-Critical"},
                    "action": {"gate1": "auto_approve", "gate2": "auto_publish", "slack_alert": True},
                },
                {
                    "name": "Staging Filter",
                    "condition": {"environment": "staging"},
                    "action": {"gate1": "require_manual", "gate2": "require_manual"},
                },
                {
                    "name": "Noise Suppressor",
                    "condition": {"exception_type": ["NotFoundHttpException", "ChunkLoadError"]},
                    "action": {"gate1": "auto_dismiss"},
                },
            ],
        },
        db_path=db_path,
    )


def record_log(
    run_id: str,
    step: str,
    message: str,
    level: str = "INFO",
    db_path: Path | str | None = None,
    now: float | None = None,
) -> None:
    """Record an individual diagnostic log entry for a run."""
    path = init_db(db_path)
    ts = now if now is not None else time.time()
    with get_db(db_path) as conn:
        conn.execute(
            """
            INSERT INTO run_logs (run_id, step, level, message, timestamp)
            VALUES (?, ?, ?, ?, ?);
            """,
            (run_id, step, level, message, ts),
        )


def get_run_logs(
    run_id: str,
    db_path: Path | str | None = None,
) -> list[dict]:
    """Retrieve detailed log entries for a run in chronological order."""
    path = init_db(db_path)
    with get_db(db_path) as conn:
        cursor = conn.execute(
            """
            SELECT step, level, message, timestamp FROM run_logs
            WHERE run_id = ?
            ORDER BY id ASC;
            """,
            (run_id,),
        )
        return [
            {
                "step": row[0],
                "level": row[1],
                "message": row[2],
                "timestamp": row[3],
            }
            for row in cursor.fetchall()
        ]


def get_workspace_metrics(
    project_id: str | None = None,
    allowed_project_ids: list[str] | set[str] | None = None,
    db_path: Path | str | None = None,
) -> dict[str, Any]:
    """Calculate aggregated incident metrics for the fleet or a specific microservice project."""
    is_scoped = bool(project_id and project_id not in ("ALL_PROJECTS", "all", "ALL"))
    target_project = project_id if is_scoped else None

    # Check in-memory cache (valid for 8 seconds)
    cache_key = f"{target_project or 'all'}:{tuple(sorted(allowed_project_ids)) if allowed_project_ids is not None else 'fleet'}"
    now = time.time()
    if cache_key in _METRICS_CACHE:
        cached_ts, cached_val = _METRICS_CACHE[cache_key]
        if now - cached_ts < 8.0:
            return cached_val

    if allowed_project_ids is not None and not allowed_project_ids:
        res = {
            "total_runs": 0,
            "staged_raw_count": 0,
            "staged_draft_count": 0,
            "published_count": 0,
            "dismissed_count": 0,
            "active_projects_count": 0,
            "avg_triage_latency_ms": 245.0,
            "project_id": target_project or "ALL_PROJECTS",
        }
        _METRICS_CACHE[cache_key] = (now, res)
        return res

    init_db(db_path)
    with get_db(db_path) as conn:
        wheres: list[str] = []
        params: list[Any] = []

        if is_scoped:
            if allowed_project_ids is not None and target_project not in allowed_project_ids:
                res = {
                    "total_runs": 0,
                    "staged_raw_count": 0,
                    "staged_draft_count": 0,
                    "published_count": 0,
                    "dismissed_count": 0,
                    "active_projects_count": len(allowed_project_ids),
                    "avg_triage_latency_ms": 245.0,
                    "project_id": target_project,
                }
                _METRICS_CACHE[cache_key] = (now, res)
                return res
            wheres.append("(project_id = ? OR (project_id IS NULL AND ? IN ('proj_default', 'checkout-service')))")
            params.extend([target_project, target_project])
        elif allowed_project_ids is not None:
            placeholders = ",".join("?" for _ in allowed_project_ids)
            wheres.append(f"project_id IN ({placeholders})")
            params.extend(list(allowed_project_ids))

        where_clause = f"WHERE {' AND '.join(wheres)}" if wheres else ""

        cursor = conn.execute(
            f"""
            SELECT status, count(*)
            FROM runs
            {where_clause}
            GROUP BY status;
            """,
            tuple(params),
        )
        status_counts = {row[0]: row[1] for row in cursor.fetchall()}
        total_runs = sum(status_counts.values())

        if allowed_project_ids is not None:
            active_projects_count = len(allowed_project_ids)
        else:
            try:
                from ichnoscope.projects import list_projects
                active_projects_count = len([p for p in list_projects() if p.is_active])
            except Exception:
                active_projects_count = 1

    res = {
        "total_runs": total_runs,
        "staged_raw_count": status_counts.get("staged_raw", 0),
        "staged_draft_count": status_counts.get("staged_draft", 0),
        "published_count": status_counts.get("published", 0),
        "dismissed_count": status_counts.get("dismissed", 0),
        "active_projects_count": active_projects_count,
        "avg_triage_latency_ms": 245.0,
        "project_id": target_project or "ALL_PROJECTS",
    }
    _METRICS_CACHE[cache_key] = (now, res)
    return res
