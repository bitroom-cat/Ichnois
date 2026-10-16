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
    db_path: Path | str | None = None,
    custom_public_key: str | None = None,
    custom_project_id: str | None = None,
) -> ProjectRecord:
    """Register a new project with generated public/secret API keys."""
    init_db(db_path)
    now = time.time()
    project_id = custom_project_id or f"proj_{uuid.uuid4().hex[:12]}"
    public_key = custom_public_key or f"pk_live_{secrets.token_hex(16)}"
    secret_key = f"sk_live_{secrets.token_hex(32)}"

    with get_db(db_path) as conn:
        conn.execute(
            """
            INSERT INTO project_keys (
                project_id, name, public_key, secret_key,
                rate_limit_min, environment, github_repo_override,
                slack_channel_override, github_installation_id, github_repo, is_active, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?);
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
                now,
            ),
        )

    logger.info("Created project '%s' (id: %s, public_key: %s)", name, project_id, public_key[:10])
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
        is_active=True,
        created_at=now,
    )


def list_projects(db_path: Path | str | None = None) -> list[ProjectRecord]:
    """Retrieve all projects registered in the platform."""
    init_db(db_path)
    ensure_default_project(db_path)
    with get_db(db_path) as conn:
        cursor = conn.execute(
            """
            SELECT project_id, name, public_key, secret_key, rate_limit_min,
                   environment, github_repo_override, slack_channel_override,
                   is_active, created_at, github_installation_id, github_repo
            FROM project_keys
            ORDER BY created_at ASC;
            """
        )
        rows = cursor.fetchall()

    return [
        ProjectRecord(
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
        )
        for r in rows
    ]


def get_project(project_id: str, db_path: Path | str | None = None) -> ProjectRecord | None:
    """Retrieve project by project_id."""
    init_db(db_path)
    with get_db(db_path) as conn:
        cursor = conn.execute(
            """
            SELECT project_id, name, public_key, secret_key, rate_limit_min,
                   environment, github_repo_override, slack_channel_override,
                   is_active, created_at, github_installation_id, github_repo
            FROM project_keys
            WHERE project_id = ?;
            """,
            (project_id,),
        )
        r = cursor.fetchone()

    if not r:
        return None

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
    )


def get_project_by_public_key(public_key: str, db_path: Path | str | None = None) -> ProjectRecord | None:
    """Retrieve project by public key (used for authentication)."""
    init_db(db_path)
    with get_db(db_path) as conn:
        cursor = conn.execute(
            """
            SELECT project_id, name, public_key, secret_key, rate_limit_min,
                   environment, github_repo_override, slack_channel_override,
                   is_active, created_at, github_installation_id, github_repo
            FROM project_keys
            WHERE public_key = ? AND is_active = 1;
            """,
            (public_key,),
        )
        r = cursor.fetchone()

    if not r:
        return None

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
    )


def update_project(
    project_id: str,
    updates: dict[str, Any],
    db_path: Path | str | None = None,
) -> ProjectRecord | None:
    """Update mutable attributes on a project."""
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
    }
    filtered = {k: v for k, v in updates.items() if k in allowed_fields and v is not None}
    if not filtered:
        return get_project(project_id, db_path=db_path)

    set_clauses = [f"{k} = ?" for k in filtered.keys()]
    values = list(filtered.values())
    values.append(project_id)

    with get_db(db_path) as conn:
        conn.execute(
            f"UPDATE project_keys SET {', '.join(set_clauses)} WHERE project_id = ?;",
            tuple(values),
        )

    return get_project(project_id, db_path=db_path)


def delete_project(project_id: str, db_path: Path | str | None = None) -> bool:
    """Delete a project by project_id."""
    init_db(db_path)
    with get_db(db_path) as conn:
        cursor = conn.execute("DELETE FROM project_keys WHERE project_id = ?;", (project_id,))
        return cursor.rowcount > 0


def rotate_project_key(project_id: str, db_path: Path | str | None = None) -> ProjectRecord | None:
    """Rotate public and secret API keys for an existing project."""
    init_db(db_path)
    new_public_key = f"pk_live_{secrets.token_hex(16)}"
    new_secret_key = f"sk_live_{secrets.token_hex(32)}"
    with get_db(db_path) as conn:
        cursor = conn.execute(
            """
            UPDATE project_keys
            SET public_key = ?, secret_key = ?
            WHERE project_id = ?;
            """,
            (new_public_key, new_secret_key, project_id),
        )
        if cursor.rowcount == 0:
            return None
    logger.info("Rotated credentials for project '%s' (new public_key: %s)", project_id, new_public_key[:10])
    return get_project(project_id, db_path=db_path)


def ensure_default_project(db_path: Path | str | None = None) -> None:
    """Ensure default out-of-the-box project exists for smooth demo and backward compatibility."""
    init_db(db_path)
    with get_db(db_path) as conn:
        cursor = conn.execute("SELECT count(*) FROM project_keys;")
        count = cursor.fetchone()[0]
        if count == 0:
            now = time.time()
            conn.execute(
                """
                INSERT INTO project_keys (
                    project_id, name, public_key, secret_key,
                    rate_limit_min, environment, github_repo_override,
                    slack_channel_override, is_active, created_at
                )
                VALUES (
                    'proj_default', 'Default Application', 'sentry_public_key',
                    'sk_live_default_admin_secret_key_001', 120, 'production',
                    NULL, NULL, 1, ?
                );
                """,
                (now,),
            )
            logger.info("Initialized default application project (proj_default)")


def connect_github_project(
    project_id: str,
    installation_id: str | int,
    repo: str,
    db_path: Path | str | None = None,
) -> ProjectRecord | None:
    """Link a GitHub App installation and repository to a project."""
    return update_project(
        project_id,
        {
            "github_installation_id": str(installation_id),
            "github_repo": repo.strip(),
            "github_repo_override": repo.strip(),
        },
        db_path=db_path,
    )


def disconnect_github_project(
    project_id: str,
    db_path: Path | str | None = None,
) -> ProjectRecord | None:
    """Unlink GitHub integration from a project."""
    init_db(db_path)
    with get_db(db_path) as conn:
        conn.execute(
            """
            UPDATE project_keys
            SET github_installation_id = NULL, github_repo = NULL
            WHERE project_id = ?;
            """,
            (project_id,),
        )
    return get_project(project_id, db_path=db_path)
