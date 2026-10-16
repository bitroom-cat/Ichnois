"""Multi-tenant Workspace & User Management Service for Ichnoscope."""

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


class WorkspaceRecord(BaseModel):
    workspace_id: str
    name: str
    owner_id: str
    created_at: float = Field(default_factory=time.time)


class WorkspaceMember(BaseModel):
    user_id: str
    email: str
    display_name: str | None = None
    role: str = "viewer"
    created_at: float = Field(default_factory=time.time)


def ensure_user_workspace(
    user_id: str,
    email: str,
    display_name: str | None = None,
    db_path: Path | str | None = None,
) -> dict[str, Any]:
    """Ensure user profile, personal multi-tenant workspace, and isolated default project exist."""
    init_db(db_path)
    now = time.time()
    clean_uid = user_id.strip()
    clean_email = email.strip()
    calc_name = display_name or clean_email.split("@")[0]

    with get_db(db_path) as conn:
        # 1. Upsert user profile
        conn.execute(
            """
            INSERT INTO user_profiles (user_id, email, display_name, created_at, last_login)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
                email = excluded.email,
                display_name = coalesce(excluded.display_name, user_profiles.display_name),
                last_login = excluded.last_login;
            """,
            (clean_uid, clean_email, calc_name, now, now),
        )

        # 2. Check if user already owns or belongs to a workspace
        cur = conn.execute(
            """
            SELECT workspace_id, name, owner_id FROM workspaces
            WHERE owner_id = ?
            ORDER BY created_at ASC
            LIMIT 1;
            """,
            (clean_uid,),
        )
        row = cur.fetchone()
        if row:
            ws_id, ws_name, ws_owner = row[0], row[1], row[2]
            m_cur = conn.execute("SELECT count(*) FROM team_members WHERE workspace_id = ? AND user_id = ?;", (ws_id, clean_uid))
            if m_cur.fetchone()[0] == 0:
                conn.execute(
                    """
                    INSERT INTO team_members (id, workspace_id, project_id, user_id, role, created_at)
                    VALUES (?, ?, ?, ?, 'owner', ?);
                    """,
                    (f"mem_{uuid.uuid4().hex[:12]}", ws_id, "root", clean_uid, now),
                )
            return {"workspace_id": ws_id, "name": ws_name, "owner_id": ws_owner}

        # 3. Create a unique personal workspace
        ws_id = f"ws_{clean_uid.replace('-', '')[:12]}"
        ws_name = f"{calc_name}'s Workspace"
        conn.execute(
            """
            INSERT INTO workspaces (workspace_id, name, owner_id, created_at)
            VALUES (?, ?, ?, ?);
            """,
            (ws_id, ws_name, clean_uid, now),
        )

        # 4. Create an isolated default project for this specific workspace
        default_pid = f"proj_default_{clean_uid.replace('-', '')[:8]}"
        default_pkey = f"pk_live_{clean_uid.replace('-', '')[:8]}_{secrets.token_hex(8)}"
        default_skey = f"sk_live_{secrets.token_hex(32)}"
        conn.execute(
            """
            INSERT INTO project_keys (
                project_id, workspace_id, owner_id, name, public_key, secret_key,
                rate_limit_min, environment, description, is_active, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, 120, 'production', 'Default Workspace Application', 1, ?, ?);
            """,
            (default_pid, ws_id, clean_uid, "Default Application", default_pkey, default_skey, now, now),
        )

        # 5. Add user as owner in team_members
        member_id = f"mem_{uuid.uuid4().hex[:12]}"
        conn.execute(
            """
            INSERT INTO team_members (id, workspace_id, project_id, user_id, role, created_at)
            VALUES (?, ?, ?, ?, 'owner', ?);
            """,
            (member_id, ws_id, default_pid, clean_uid, now),
        )

        logger.info("Initialized workspace '%s' (%s) with default project '%s' for user '%s'", ws_name, ws_id, default_pid, clean_uid)
        return {"workspace_id": ws_id, "name": ws_name, "owner_id": clean_uid}


def get_user_workspace_id(user_id: str, db_path: Path | str | None = None) -> str:
    """Return the primary workspace_id for a user."""
    init_db(db_path)
    with get_db(db_path) as conn:
        cur = conn.execute("SELECT workspace_id FROM workspaces WHERE owner_id = ? LIMIT 1;", (user_id,))
        row = cur.fetchone()
        if row:
            return row[0]

        cur2 = conn.execute("SELECT workspace_id FROM team_members WHERE user_id = ? LIMIT 1;", (user_id,))
        row2 = cur2.fetchone()
        if row2 and row2[0]:
            return row2[0]

    return f"ws_{user_id.replace('-', '')[:12]}"


def list_workspace_members(workspace_id: str, db_path: Path | str | None = None) -> list[dict[str, Any]]:
    """Return authorized members for a workspace."""
    init_db(db_path)
    with get_db(db_path) as conn:
        cur = conn.execute(
            """
            SELECT tm.user_id, tm.role, tm.created_at, up.email, up.display_name
            FROM team_members tm
            LEFT JOIN user_profiles up ON tm.user_id = up.user_id
            WHERE tm.workspace_id = ?
            ORDER BY tm.created_at ASC;
            """,
            (workspace_id,),
        )
        rows = cur.fetchall()

    return [
        {
            "user_id": r[0],
            "role": r[1],
            "created_at": r[2],
            "email": r[3] or "user@ichnoscope.internal",
            "display_name": r[4] or (r[3].split("@")[0] if r[3] else "Team Member"),
        }
        for r in rows
    ]


def list_user_workspaces(user_id: str, db_path: Path | str | None = None) -> list[dict[str, Any]]:
    """List all workspaces the user owns or belongs to."""
    init_db(db_path)
    with get_db(db_path) as conn:
        cur = conn.execute(
            """
            SELECT DISTINCT w.workspace_id, w.name, w.owner_id, w.created_at
            FROM workspaces w
            LEFT JOIN team_members tm ON w.workspace_id = tm.workspace_id
            WHERE w.owner_id = ? OR tm.user_id = ?
            ORDER BY w.created_at ASC;
            """,
            (user_id, user_id),
        )
        rows = cur.fetchall()

    return [
        {
            "workspace_id": r[0],
            "name": r[1],
            "owner_id": r[2],
            "created_at": r[3],
        }
        for r in rows
    ]
