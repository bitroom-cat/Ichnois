"""Multi-project management and dynamic project key lifecycle service for Ichnoscope."""

from __future__ import annotations

import logging
from pathlib import Path
import secrets
import time
from typing import Any
import uuid

from pydantic import BaseModel, Field

from ichnoscope.db import get_db, init_db

logger = logging.getLogger(__name__)


class ProjectRecord(BaseModel):
    """Data transfer object representing a registered project and telemetry keys."""

    project_id: str
    name: str
    public_key: str
    secret_key: str
    rate_limit_min: int = 120
    environment: str = "production"
    github_repo_override: str | None = None
    slack_channel_override: str | None = None
    github_installation_id: str | None = None
    github_repo: str | None = None
    description: str | None = None
    webhook_url: str | None = None
    fallback_assignee: str | None = None
    path_prefix_strip: str | None = None
    window_hours: int = 24
    automation_mode_override: str | None = None
    updated_at: float | None = None
    owner_id: str | None = None
    workspace_id: str | None = None
    is_active: bool = True
    created_at: float = Field(default_factory=time.time)

    def to_safe_dict(self) -> dict[str, Any]:
        """Return safe representation with masked secret key."""
        d = self.model_dump()
        d["secret_key"] = f"{self.secret_key[:7]}...{self.secret_key[-4:]}"
        return d


def create_project(
    name: str,
    environment: str = "production",
    rate_limit_min: int = 120,
    github_repo_override: str | None = None,
    slack_channel_override: str | None = None,
    github_installation_id: str | None = None,
    github_repo: str | None = None,
    fallback_assignee: str | None = None,
    path_prefix_strip: str | None = None,
    window_hours: int = 24,
    automation_mode_override: str | None = None,
    db_path: Path | str | None = None,
    custom_public_key: str | None = None,
    custom_project_id: str | None = None,
    owner_id: str | None = None,
    workspace_id: str | None = None,
) -> ProjectRecord:
    """Register a new project with generated public/secret API keys bound to a workspace and owner."""
    init_db(db_path)
    now = time.time()
    project_id = custom_project_id or f"proj_{uuid.uuid4().hex[:12]}"
    public_key = custom_public_key or f"pk_live_{secrets.token_hex(16)}"
    secret_key = f"sk_live_{secrets.token_hex(32)}"

    calc_ws = workspace_id
    if not calc_ws and owner_id:
        from ichnoscope.workspaces import get_user_workspace_id
        calc_ws = get_user_workspace_id(owner_id, db_path=db_path)

    with get_db(db_path) as conn:
        conn.execute(
            """
            INSERT INTO project_keys (
                project_id, name, public_key, secret_key,
                rate_limit_min, environment, github_repo_override,
                slack_channel_override, github_installation_id, github_repo,
                fallback_assignee, path_prefix_strip, window_hours, automation_mode_override,
                is_active, created_at, owner_id, workspace_id
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?);
            """,
            (
                project_id,
                name,
                public_key,
                secret_key,
                rate_limit_min,
                environment,
                github_repo_override,
                slack_channel_override,
                github_installation_id,
                github_repo,
                fallback_assignee,
                path_prefix_strip,
                window_hours,
                automation_mode_override,
                now,
                owner_id,
                calc_ws,
            ),
        )

    invalidate_projects_cache()
    logger.info("Created project '%s' (id: %s, owner: %s, ws: %s)", name, project_id, owner_id, calc_ws)
    return ProjectRecord(
        project_id=project_id,
        name=name,
        public_key=public_key,
        secret_key=secret_key,
        rate_limit_min=rate_limit_min,
        environment=environment,
        github_repo_override=github_repo_override,
        slack_channel_override=slack_channel_override,
        github_installation_id=github_installation_id,
        github_repo=github_repo,
        fallback_assignee=fallback_assignee,
        path_prefix_strip=path_prefix_strip,
        window_hours=window_hours,
        automation_mode_override=automation_mode_override,
        owner_id=owner_id,
        workspace_id=calc_ws,
        is_active=True,
        created_at=now,
    )


def _row_to_project(r: tuple) -> ProjectRecord:
    return ProjectRecord(
        project_id=r[0],
        name=r[1],
        public_key=r[2],
        secret_key=r[3],
        rate_limit_min=r[4],
        environment=r[5],
        github_repo_override=r[6],
        slack_channel_override=r[7],
        is_active=bool(r[8]),
        created_at=r[9],
        github_installation_id=r[10] if len(r) > 10 else None,
        github_repo=r[11] if len(r) > 11 else None,
        description=r[12] if len(r) > 12 else None,
        webhook_url=r[13] if len(r) > 13 else None,
        updated_at=r[14] if len(r) > 14 else None,
        owner_id=r[15] if len(r) > 15 else None,
        workspace_id=r[16] if len(r) > 16 else None,
        fallback_assignee=r[17] if len(r) > 17 else None,
        path_prefix_strip=r[18] if len(r) > 18 else None,
        window_hours=int(r[19]) if len(r) > 19 and r[19] is not None else 24,
        automation_mode_override=r[20] if len(r) > 20 else None,
    )


PROJ_SELECT_COLS = """
    project_id, name, public_key, secret_key, rate_limit_min,
    environment, github_repo_override, slack_channel_override,
    is_active, created_at, github_installation_id, github_repo,
    description, webhook_url, updated_at, owner_id, workspace_id,
    fallback_assignee, path_prefix_strip, window_hours, automation_mode_override
"""


_PROJECTS_CACHE: dict[tuple, tuple[float, list[ProjectRecord]]] = {}


def invalidate_projects_cache() -> None:
    """Clear in-memory projects cache upon mutations."""
    global _PROJECTS_CACHE
    _PROJECTS_CACHE.clear()


def list_projects(
    db_path: Path | str | None = None,
    owner_id: str | None = None,
    workspace_id: str | None = None,
    is_admin: bool = False,
) -> list[ProjectRecord]:
    """Retrieve all projects strictly isolated by workspace or owner with short in-memory cache."""
    cache_key = (str(db_path or "default"), owner_id, workspace_id, is_admin)
    now = time.time()
    if cache_key in _PROJECTS_CACHE:
        cached_ts, cached_records = _PROJECTS_CACHE[cache_key]
        if now - cached_ts < 8.0:
            return cached_records

    init_db(db_path)
    with get_db(db_path) as conn:
        if workspace_id:
            cursor = conn.execute(
                f"""
                SELECT {PROJ_SELECT_COLS}
                FROM project_keys
                WHERE workspace_id = ?
                ORDER BY created_at ASC;
                """,
                (workspace_id,),
            )
        elif owner_id:
            cursor = conn.execute(
                f"""
                SELECT {PROJ_SELECT_COLS}
                FROM project_keys
                WHERE owner_id = ?
                ORDER BY created_at ASC;
                """,
                (owner_id,),
            )
        elif is_admin or (owner_id is None and workspace_id is None):
            ensure_default_project(db_path)
            cursor = conn.execute(
                f"""
                SELECT {PROJ_SELECT_COLS}
                FROM project_keys
                ORDER BY created_at ASC;
                """
            )
        else:
            return []

        rows = cursor.fetchall()

    result = [_row_to_project(r) for r in rows]
    _PROJECTS_CACHE[cache_key] = (now, result)
    return result


def get_project(
    project_id: str,
    db_path: Path | str | None = None,
    owner_id: str | None = None,
    workspace_id: str | None = None,
    is_admin: bool = False,
) -> ProjectRecord | None:
    """Retrieve project by project_id, ensuring caller has authorization."""
    init_db(db_path)
    with get_db(db_path) as conn:
        cursor = conn.execute(
            f"""
            SELECT {PROJ_SELECT_COLS}
            FROM project_keys
            WHERE project_id = ?;
            """,
            (project_id,),
        )
        r = cursor.fetchone()

    if not r:
        return None

    record = _row_to_project(r)

    # Authorization verification: project must strictly match caller's workspace or owner
    if not is_admin:
        allowed = False
        if workspace_id and record.workspace_id == workspace_id:
            allowed = True
        elif owner_id and record.owner_id == owner_id:
            allowed = True
        elif not workspace_id and not owner_id and db_path is not None:
            allowed = True
        if not allowed:
            return None

    return record


def get_project_by_public_key(public_key: str, db_path: Path | str | None = None) -> ProjectRecord | None:
    """Retrieve project by public key (used for authentication)."""
    init_db(db_path)
    with get_db(db_path) as conn:
        cursor = conn.execute(
            f"""
            SELECT {PROJ_SELECT_COLS}
            FROM project_keys
            WHERE public_key = ? AND is_active = 1;
            """,
            (public_key,),
        )
        r = cursor.fetchone()

    if not r:
        return None

    return _row_to_project(r)


def update_project(
    project_id: str,
    updates: dict[str, Any],
    db_path: Path | str | None = None,
    owner_id: str | None = None,
    workspace_id: str | None = None,
    is_admin: bool = False,
) -> ProjectRecord | None:
    """Update mutable attributes on a project, verifying authorization."""
    existing = get_project(project_id, db_path=db_path, owner_id=owner_id, workspace_id=workspace_id, is_admin=is_admin)
    if not existing:
        return None

    init_db(db_path)
    allowed_fields = {
        "name",
        "rate_limit_min",
        "environment",
        "github_repo_override",
        "slack_channel_override",
        "github_installation_id",
        "github_repo",
        "is_active",
        "description",
        "webhook_url",
        "fallback_assignee",
        "path_prefix_strip",
        "window_hours",
        "automation_mode_override",
    }
    filtered = {k: v for k, v in updates.items() if k in allowed_fields and v is not None}
    if not filtered:
        return existing

    filtered["updated_at"] = time.time()
    set_clauses = [f"{k} = ?" for k in filtered.keys()]
    values = list(filtered.values())
    values.append(project_id)

    with get_db(db_path) as conn:
        conn.execute(
            f"UPDATE project_keys SET {', '.join(set_clauses)} WHERE project_id = ?;",
            tuple(values),
        )

    invalidate_projects_cache()
    return get_project(project_id, db_path=db_path, owner_id=owner_id, workspace_id=workspace_id, is_admin=is_admin)


def delete_project(
    project_id: str,
    db_path: Path | str | None = None,
    owner_id: str | None = None,
    workspace_id: str | None = None,
    is_admin: bool = False,
) -> bool:
    """Delete a project by project_id, verifying user authorization."""
    existing = get_project(project_id, db_path=db_path, owner_id=owner_id, workspace_id=workspace_id, is_admin=is_admin)
    if not existing:
        return False

    init_db(db_path)
    with get_db(db_path) as conn:
        cursor = conn.execute("DELETE FROM project_keys WHERE project_id = ?;", (project_id,))
        if cursor.rowcount > 0:
            invalidate_projects_cache()
            return True
        return False


def rotate_project_key(
    project_id: str,
    db_path: Path | str | None = None,
    owner_id: str | None = None,
    workspace_id: str | None = None,
    is_admin: bool = False,
) -> ProjectRecord | None:
    """Rotate public and secret API keys for an existing project."""
    existing = get_project(project_id, db_path=db_path, owner_id=owner_id, workspace_id=workspace_id, is_admin=is_admin)
    if not existing:
        return None

    init_db(db_path)
    new_public_key = f"pk_live_{secrets.token_hex(16)}"
    new_secret_key = f"sk_live_{secrets.token_hex(32)}"
    with get_db(db_path) as conn:
        cursor = conn.execute(
            """
            UPDATE project_keys
            SET public_key = ?, secret_key = ?, updated_at = ?
            WHERE project_id = ?;
            """,
            (new_public_key, new_secret_key, time.time(), project_id),
        )
        if cursor.rowcount == 0:
            return None
    invalidate_projects_cache()
    logger.info("Rotated credentials for project '%s' (new public_key: %s)", project_id, new_public_key[:10])
    return get_project(project_id, db_path=db_path, owner_id=owner_id, workspace_id=workspace_id, is_admin=is_admin)


DEFAULT_PROJECT_ID: str = "proj_default"
DEFAULT_PROJECT_NAME: str = "Default Application"
_DEFAULT_PROJECTS_ENSURED: bool = False


def ensure_default_project(db_path: Path | str | None = None) -> None:
    """Ensure default projects and microservices exist if the database has 0 projects."""
    global _DEFAULT_PROJECTS_ENSURED
    if _DEFAULT_PROJECTS_ENSURED and db_path is None:
        return
    init_db(db_path)
    with get_db(db_path) as conn:
        cursor = conn.execute("SELECT count(*) FROM project_keys;")
        if cursor.fetchone()[0] == 0:
            now = time.time()
            seeds = [
                ("proj_default", "Default Application", "sentry_public_key", "sk_live_default_admin_secret_key_001", "Default production application"),
                ("checkout-service", "Checkout Service", "pk_live_checkout_001", "sk_live_checkout_001", "Checkout Microservice"),
                ("auth-service", "Auth & Identity Service", "pk_live_auth_001", "sk_live_auth_001", "Auth Microservice"),
                ("inventory-service", "Inventory Service", "pk_live_inventory_001", "sk_live_inventory_001", "Inventory Microservice"),
                ("edge-gateway", "Edge Gateway Service", "pk_live_edge_001", "sk_live_edge_001", "Edge Ingest Gateway"),
            ]
            for p_id, p_name, pub_k, sec_k, desc in seeds:
                conn.execute(
                    """
                    INSERT OR IGNORE INTO project_keys (
                        project_id, name, public_key, secret_key,
                        rate_limit_min, environment, description,
                        is_active, created_at, updated_at, owner_id
                    )
                    VALUES (?, ?, ?, ?, 120, 'production', ?, 1, ?, ?, NULL);
                    """,
                    (p_id, p_name, pub_k, sec_k, desc, now, now),
                )
            logger.info("Initialized default application projects and microservices")
    _DEFAULT_PROJECTS_ENSURED = True


def connect_github_project(
    project_id: str,
    installation_id: str | int,
    repo: str,
    fallback_assignee: str | None = None,
    db_path: Path | str | None = None,
    owner_id: str | None = None,
    workspace_id: str | None = None,
    is_admin: bool = False,
) -> ProjectRecord | None:
    """Link a GitHub App installation and repository to a project."""
    updates: dict[str, Any] = {
        "github_installation_id": str(installation_id),
        "github_repo": repo.strip(),
        "github_repo_override": repo.strip(),
    }
    if fallback_assignee:
        updates["fallback_assignee"] = fallback_assignee.strip()
    return update_project(
        project_id,
        updates,
        db_path=db_path,
        owner_id=owner_id,
        workspace_id=workspace_id,
        is_admin=is_admin,
    )


def disconnect_github_project(
    project_id: str,
    db_path: Path | str | None = None,
    owner_id: str | None = None,
    workspace_id: str | None = None,
    is_admin: bool = False,
) -> ProjectRecord | None:
    """Unlink GitHub integration from a project."""
    existing = get_project(project_id, db_path=db_path, owner_id=owner_id, workspace_id=workspace_id, is_admin=is_admin)
    if not existing:
        return None

    init_db(db_path)
    with get_db(db_path) as conn:
        conn.execute(
            """
            UPDATE project_keys
            SET github_installation_id = NULL, github_repo = NULL, github_repo_override = NULL, updated_at = ?
            WHERE project_id = ?;
            """,
            (time.time(), project_id),
        )
    return get_project(project_id, db_path=db_path, owner_id=owner_id, workspace_id=workspace_id, is_admin=is_admin)
