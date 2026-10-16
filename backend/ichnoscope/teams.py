"""Team and Role-Based Access Control (RBAC) management for Ichnoscope."""

import time
import uuid
import logging
from typing import Optional, List, Dict, Any
from pathlib import Path

from ichnoscope.db import get_db, init_db

logger = logging.getLogger(__name__)

VALID_ROLES = {"owner", "admin", "member", "viewer"}
ROLE_HIERARCHY = {
    "owner": 4,
    "admin": 3,
    "member": 2,
    "viewer": 1,
}


def has_permission(user_role: Optional[str], required_role: str) -> bool:
    """Check if a user role meets or exceeds the required role level."""
    if not user_role:
        return False
    return ROLE_HIERARCHY.get(user_role, 0) >= ROLE_HIERARCHY.get(required_role, 0)


def upsert_user_profile(
    user_id: str,
    email: str,
    display_name: Optional[str] = None,
    avatar_url: Optional[str] = None,
    db_path: Optional[Path | str] = None,
) -> None:
    """Create or update a user profile from Supabase JWT claims."""
    init_db(db_path)
    now = time.time()
    with get_db(db_path) as conn:
        cursor = conn.execute("SELECT user_id FROM user_profiles WHERE user_id = ?;", (user_id,))
        row = cursor.fetchone()
        if row:
            conn.execute(
                """
                UPDATE user_profiles
                SET email = ?, display_name = COALESCE(?, display_name),
                    avatar_url = COALESCE(?, avatar_url), last_login = ?
                WHERE user_id = ?;
                """,
                (email, display_name, avatar_url, now, user_id),
            )
        else:
            conn.execute(
                """
                INSERT INTO user_profiles (user_id, email, display_name, avatar_url, created_at, last_login)
                VALUES (?, ?, ?, ?, ?, ?);
                """,
                (user_id, email, display_name, avatar_url, now, now),
            )


def log_team_action(
    project_id: str,
    actor_id: str,
    action: str,
    target_id: Optional[str] = None,
    details: Optional[str] = None,
    db_path: Optional[Path | str] = None,
) -> None:
    """Record an audit trail event for team membership or role changes."""
    init_db(db_path)
    now = time.time()
    try:
        with get_db(db_path) as conn:
            conn.execute(
                """
                INSERT INTO team_audit_log (project_id, actor_id, action, target_id, details, created_at)
                VALUES (?, ?, ?, ?, ?, ?);
                """,
                (project_id, actor_id, action, target_id, details, now),
            )
    except Exception as exc:
        logger.warning("Failed to record team audit log: %s", exc)


def add_team_member(
    project_id: str,
    user_id: str,
    role: str = "viewer",
    invited_by: Optional[str] = None,
    db_path: Optional[Path | str] = None,
) -> Dict[str, Any]:
    """Add or update a user's membership in a project team."""
    init_db(db_path)
    role_normalized = role.lower()
    if role_normalized not in VALID_ROLES:
        role_normalized = "viewer"

    now = time.time()
    member_id = f"mem_{uuid.uuid4().hex[:12]}"

    with get_db(db_path) as conn:
        cursor = conn.execute(
            "SELECT id, role FROM team_members WHERE project_id = ? AND user_id = ?;",
            (project_id, user_id),
        )
        existing = cursor.fetchone()
        if existing:
            conn.execute(
                "UPDATE team_members SET role = ? WHERE project_id = ? AND user_id = ?;",
                (role_normalized, project_id, user_id),
            )
            member_id = existing[0]
        else:
            conn.execute(
                """
                INSERT INTO team_members (id, project_id, user_id, role, invited_by, created_at)
                VALUES (?, ?, ?, ?, ?, ?);
                """,
                (member_id, project_id, user_id, role_normalized, invited_by, now),
            )

    log_team_action(
        project_id=project_id,
        actor_id=invited_by or "system",
        action="add_member" if not existing else "update_member",
        target_id=user_id,
        details=f"role={role_normalized}",
        db_path=db_path,
    )

    return {
        "id": member_id,
        "project_id": project_id,
        "user_id": user_id,
        "role": role_normalized,
        "invited_by": invited_by,
        "created_at": now,
    }


def remove_team_member(
    project_id: str,
    user_id: str,
    actor_id: str = "system",
    db_path: Optional[Path | str] = None,
) -> bool:
    """Remove a user from a project team."""
    init_db(db_path)
    with get_db(db_path) as conn:
        cursor = conn.execute(
            "DELETE FROM team_members WHERE project_id = ? AND user_id = ?;",
            (project_id, user_id),
        )
        deleted = cursor.rowcount > 0 if hasattr(cursor, "rowcount") else True

    if deleted:
        log_team_action(
            project_id=project_id,
            actor_id=actor_id,
            action="remove_member",
            target_id=user_id,
            details="User removed from project",
            db_path=db_path,
        )
    return deleted


def update_member_role(
    project_id: str,
    user_id: str,
    new_role: str,
    actor_id: str = "system",
    db_path: Optional[Path | str] = None,
) -> Optional[Dict[str, Any]]:
    """Update a user's role in a project team."""
    role_normalized = new_role.lower()
    if role_normalized not in VALID_ROLES:
        raise ValueError(f"Invalid role '{new_role}'. Must be one of {sorted(VALID_ROLES)}")

    init_db(db_path)
    with get_db(db_path) as conn:
        cursor = conn.execute(
            "SELECT id, created_at FROM team_members WHERE project_id = ? AND user_id = ?;",
            (project_id, user_id),
        )
        row = cursor.fetchone()
        if not row:
            return None

        member_id, created_at = row[0], row[1]
        conn.execute(
            "UPDATE team_members SET role = ? WHERE project_id = ? AND user_id = ?;",
            (role_normalized, project_id, user_id),
        )

    log_team_action(
        project_id=project_id,
        actor_id=actor_id,
        action="update_role",
        target_id=user_id,
        details=f"new_role={role_normalized}",
        db_path=db_path,
    )

    return {
        "id": member_id,
        "project_id": project_id,
        "user_id": user_id,
        "role": role_normalized,
        "created_at": created_at,
    }


def get_user_role(
    user_id: str,
    project_id: str,
    db_path: Optional[Path | str] = None,
) -> Optional[str]:
    """Retrieve the role for a specific user within a project."""
    init_db(db_path)
    with get_db(db_path) as conn:
        cursor = conn.execute(
            "SELECT role FROM team_members WHERE project_id = ? AND user_id = ?;",
            (project_id, user_id),
        )
        row = cursor.fetchone()
        return row[0] if row else None


def get_project_members(
    project_id: str,
    db_path: Optional[Path | str] = None,
) -> List[Dict[str, Any]]:
    """List all team members for a given project with their user profile info."""
    init_db(db_path)
    with get_db(db_path) as conn:
        cursor = conn.execute(
            """
            SELECT m.id, m.project_id, m.user_id, m.role, m.invited_by, m.created_at,
                   u.email, u.display_name, u.avatar_url
            FROM team_members m
            LEFT JOIN user_profiles u ON m.user_id = u.user_id
            WHERE m.project_id = ?
            ORDER BY m.created_at ASC;
            """,
            (project_id,),
        )
        rows = cursor.fetchall()
        members = []
        for r in rows:
            members.append({
                "id": r[0],
                "project_id": r[1],
                "user_id": r[2],
                "role": r[3],
                "invited_by": r[4],
                "created_at": r[5],
                "email": r[6] or "",
                "display_name": r[7] or "",
                "avatar_url": r[8] or "",
            })
        return members


def get_user_projects(
    user_id: str,
    db_path: Optional[Path | str] = None,
) -> List[Dict[str, Any]]:
    """List all projects a user has membership in, along with their role."""
    init_db(db_path)
    with get_db(db_path) as conn:
        cursor = conn.execute(
            """
            SELECT p.project_id, p.name, p.environment, p.is_active, m.role, m.created_at
            FROM team_members m
            INNER JOIN project_keys p ON m.project_id = p.project_id
            WHERE m.user_id = ?
            ORDER BY p.name ASC;
            """,
            (user_id,),
        )
        rows = cursor.fetchall()
        projects = []
        for r in rows:
            projects.append({
                "project_id": r[0],
                "name": r[1],
                "environment": r[2],
                "is_active": bool(r[3]),
                "role": r[4],
                "joined_at": r[5],
            })
        return projects
