"""Database initialization, schema management, and unified SQLite / Turso libSQL client."""

import base64
from contextlib import contextmanager
import logging
import os
from pathlib import Path
import sqlite3
from typing import Any, Iterator

import httpx

logger = logging.getLogger(__name__)

DEFAULT_RUNS_DB: str = "ichnoscope_runs.db"


class TursoCursor:
    """Cursor-like wrapper over Turso HTTP pipeline query results."""

    def __init__(self, rows: list[tuple], rowcount: int = -1):
        self._rows = rows
        self._idx = 0
        self.rowcount = rowcount

    def fetchone(self) -> tuple | None:
        if self._idx < len(self._rows):
            r = self._rows[self._idx]
            self._idx += 1
            return r
        return None

    def fetchall(self) -> list[tuple]:
        rem = self._rows[self._idx :]
        self._idx = len(self._rows)
        return rem


_TURSO_CLIENT: httpx.Client | None = None


def get_turso_client() -> httpx.Client:
    """Return a shared, persistent HTTP client for Turso pipeline requests with keep-alive connection pooling."""
    global _TURSO_CLIENT
    if _TURSO_CLIENT is None or _TURSO_CLIENT.is_closed:
        _TURSO_CLIENT = httpx.Client(
            timeout=10.0,
            limits=httpx.Limits(max_keepalive_connections=30, max_connections=60, keepalive_expiry=120.0),
        )
    return _TURSO_CLIENT


class TursoConnection:
    """Lightweight, thread-safe HTTP pipeline connection to Turso / libSQL database."""

    def __init__(self, url: str, token: str):
        normalized = url
        if normalized.startswith("libsql://"):
            normalized = "https://" + normalized[len("libsql://") :]
        elif not normalized.startswith("http"):
            normalized = f"https://{normalized}"
        self.endpoint = normalized.rstrip("/") + "/v2/pipeline"
        self.token = token
        self._client = get_turso_client()

    def execute(self, sql: str, params: tuple | list = ()) -> TursoCursor:
        args = []
        for p in params:
            if p is None:
                args.append({"type": "null"})
            elif isinstance(p, bool):
                args.append({"type": "integer", "value": "1" if p else "0"})
            elif isinstance(p, int):
                args.append({"type": "integer", "value": str(p)})
            elif isinstance(p, float):
                args.append({"type": "float", "value": p})
            elif isinstance(p, bytes):
                args.append({"type": "blob", "base64": base64.b64encode(p).decode("ascii")})
            else:
                args.append({"type": "text", "value": str(p)})

        payload = {
            "requests": [
                {
                    "type": "execute",
                    "stmt": {
                        "sql": sql,
                        "args": args,
                    },
                },
                {"type": "close"},
            ]
        }
        res = self._client.post(
            self.endpoint,
            headers={
                "Authorization": f"Bearer {self.token}",
                "Content-Type": "application/json",
            },
            json=payload,
        )
        res.raise_for_status()
        data = res.json()
        results = data.get("results", [])
        if not results:
            return TursoCursor([])

        first = results[0]
        if first.get("type") == "error":
            err_msg = str(first.get("error", {}).get("message", "Unknown Turso Error"))
            if "UNIQUE" in err_msg or "PRIMARY KEY" in err_msg:
                raise sqlite3.IntegrityError(err_msg)
            raise RuntimeError(f"Turso Error: {err_msg}")

        resp = first.get("response", {})
        result = resp.get("result", {})
        raw_rows = result.get("rows", [])
        rows = []
        for r in raw_rows:
            parsed_cols = []
            for col in r:
                c_type = col.get("type")
                val = col.get("value")
                if c_type == "null" or val is None:
                    parsed_cols.append(None)
                elif c_type == "integer":
                    try:
                        parsed_cols.append(int(val))
                    except (ValueError, TypeError):
                        parsed_cols.append(val)
                elif c_type == "float":
                    try:
                        parsed_cols.append(float(val))
                    except (ValueError, TypeError):
                        parsed_cols.append(val)
                else:
                    parsed_cols.append(val)
            rows.append(tuple(parsed_cols))
        affected = result.get("affected_row_count", 0)
        return TursoCursor(rows, rowcount=affected)

    def execute_batch(self, stmts: list[str]) -> None:
        """Execute multiple SQL statements in a single pipeline HTTP round-trip."""
        requests = [{"type": "execute", "stmt": {"sql": s, "args": []}} for s in stmts if s.strip()]
        if not requests:
            return
        requests.append({"type": "close"})
        try:
            res = self._client.post(
                self.endpoint,
                headers={
                    "Authorization": f"Bearer {self.token}",
                    "Content-Type": "application/json",
                },
                json={"requests": requests},
            )
            res.raise_for_status()
        except Exception as exc:
            logger.debug("Turso batch execution non-fatal error: %s", exc)

    def commit(self) -> None:
        pass

    def close(self) -> None:
        # Keep connection open in pool for fast reuse
        pass

    def __enter__(self) -> "TursoConnection":
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        pass


def get_db_path(custom_path: str | Path | None = None) -> Path:
    """Return database file path, creating parent directories if needed."""
    target = custom_path or DEFAULT_RUNS_DB
    path = Path(target)
    if not path.is_absolute() and target == "ichnoscope_runs.db":
        root_dir = Path(__file__).resolve().parents[2]
        path = root_dir / target
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


@contextmanager
def get_db(db_path: str | Path | None = None) -> Iterator[Any]:
    """Yield database connection: Turso if credentials exist, otherwise local SQLite."""
    turso_url = os.environ.get("TURSO_DATABASE_URL") or os.environ.get("TURSO_DB_URL") or os.environ.get("LIBSQL_URL")
    turso_token = os.environ.get("TURSO_AUTH_TOKEN") or os.environ.get("TURSO_TOKEN") or os.environ.get("LIBSQL_AUTH_TOKEN")
    if turso_url and turso_token and db_path is None and DEFAULT_RUNS_DB == "ichnoscope_runs.db":
        with TursoConnection(turso_url.strip(), turso_token.strip()) as conn:
            yield conn
    else:
        path = get_db_path(db_path)
        with sqlite3.connect(path) as conn:
            yield conn


_INITIALIZED_DBS: set[str] = set()


def init_db(db_path: str | Path | None = None, force: bool = False) -> Path | str:
    """Initialize database tables for runs, execution logs, and incident deduplication once per process."""
    global _INITIALIZED_DBS
    turso_url = os.environ.get("TURSO_DATABASE_URL") or os.environ.get("TURSO_DB_URL") or os.environ.get("LIBSQL_URL")
    turso_token = os.environ.get("TURSO_AUTH_TOKEN") or os.environ.get("TURSO_TOKEN") or os.environ.get("LIBSQL_AUTH_TOKEN")

    cache_key = f"turso:{turso_url}" if (turso_url and turso_token and db_path is None) else str(db_path or "local")
    if not force and cache_key in _INITIALIZED_DBS:
        return turso_url if (turso_url and turso_token and db_path is None) else get_db_path(db_path)
    turso_token = os.environ.get("TURSO_AUTH_TOKEN") or os.environ.get("TURSO_TOKEN") or os.environ.get("LIBSQL_AUTH_TOKEN")

    tables = [
        """
        CREATE TABLE IF NOT EXISTS workspaces (
            workspace_id TEXT PRIMARY KEY,
            name         TEXT NOT NULL,
            owner_id     TEXT NOT NULL,
            created_at   REAL NOT NULL
        );
        """,
        """
        CREATE TABLE IF NOT EXISTS runs (
            id TEXT PRIMARY KEY,
            fingerprint TEXT NOT NULL,
            status TEXT NOT NULL,
            severity TEXT,
            is_regression INTEGER DEFAULT 0,
            issue_url TEXT,
            draft_title TEXT,
            draft_body TEXT,
            raw_payload TEXT,
            project_id TEXT,
            workspace_id TEXT,
            state_json TEXT NOT NULL,
            created_at REAL NOT NULL,
            updated_at REAL NOT NULL
        );
        """,
        """
        CREATE TABLE IF NOT EXISTS run_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id TEXT NOT NULL,
            step TEXT NOT NULL,
            level TEXT NOT NULL,
            message TEXT NOT NULL,
            timestamp REAL NOT NULL
        );
        """,
        """
        CREATE TABLE IF NOT EXISTS seen (
            fp              TEXT PRIMARY KEY,
            issue_number    INTEGER,
            count           INTEGER NOT NULL DEFAULT 1,
            first_seen      REAL NOT NULL,
            last_seen       REAL NOT NULL,
            last_comment_at REAL
        );
        """,
        """
        CREATE TABLE IF NOT EXISTS gate_reviews (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id TEXT NOT NULL,
            gate TEXT NOT NULL,
            action TEXT NOT NULL,
            reviewer TEXT NOT NULL,
            notes TEXT,
            created_at REAL NOT NULL
        );
        """,
        """
        CREATE TABLE IF NOT EXISTS automation_policies (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            is_active INTEGER DEFAULT 1,
            rule_json TEXT NOT NULL,
            created_at REAL NOT NULL,
            updated_at REAL NOT NULL
        );
        """,
        """
        CREATE TABLE IF NOT EXISTS project_keys (
            project_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            public_key TEXT UNIQUE NOT NULL,
            secret_key TEXT NOT NULL,
            rate_limit_min INTEGER DEFAULT 120,
            environment TEXT DEFAULT 'production',
            github_repo_override TEXT,
            slack_channel_override TEXT,
            github_installation_id TEXT,
            github_repo TEXT,
            description TEXT,
            webhook_url TEXT,
            fallback_assignee TEXT,
            path_prefix_strip TEXT,
            window_hours INTEGER DEFAULT 24,
            automation_mode_override TEXT,
            updated_at REAL,
            owner_id TEXT,
            workspace_id TEXT,
            is_active INTEGER DEFAULT 1,
            created_at REAL NOT NULL
        );
        """,
        """
        CREATE TABLE IF NOT EXISTS system_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at REAL NOT NULL
        );
        """,
        """
        CREATE TABLE IF NOT EXISTS user_profiles (
            user_id     TEXT PRIMARY KEY,
            email       TEXT NOT NULL,
            display_name TEXT,
            avatar_url  TEXT,
            created_at  REAL NOT NULL,
            last_login  REAL
        );
        """,
        """
        CREATE TABLE IF NOT EXISTS team_members (
            id          TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL,
            project_id  TEXT,
            user_id     TEXT NOT NULL,
            role        TEXT NOT NULL DEFAULT 'viewer',
            invited_by  TEXT,
            created_at  REAL NOT NULL
        );
        """,
        """
        CREATE TABLE IF NOT EXISTS team_audit_log (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id  TEXT NOT NULL,
            actor_id    TEXT NOT NULL,
            action      TEXT NOT NULL,
            target_id   TEXT,
            details     TEXT,
            created_at  REAL NOT NULL
        );
        """,
        "CREATE INDEX IF NOT EXISTS idx_runs_updated ON runs (updated_at DESC);",
        "CREATE INDEX IF NOT EXISTS idx_runs_status ON runs (status);",
        "CREATE INDEX IF NOT EXISTS idx_logs_run_id ON run_logs (run_id, timestamp);",
        "CREATE INDEX IF NOT EXISTS idx_gate_reviews_run ON gate_reviews (run_id, gate);",
        "CREATE INDEX IF NOT EXISTS idx_project_keys_public ON project_keys (public_key);",
        "CREATE INDEX IF NOT EXISTS idx_team_members_project ON team_members (project_id);",
        "CREATE INDEX IF NOT EXISTS idx_workspaces_owner ON workspaces (owner_id);",
        "CREATE INDEX IF NOT EXISTS idx_project_keys_ws ON project_keys (workspace_id);",
        "CREATE INDEX IF NOT EXISTS idx_runs_ws ON runs (workspace_id);",
        "CREATE INDEX IF NOT EXISTS idx_team_members_ws ON team_members (workspace_id, user_id);",
        "CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members (user_id);",
        "CREATE INDEX IF NOT EXISTS idx_team_audit_project ON team_audit_log (project_id, created_at DESC);",
    ]

    if turso_url and turso_token and db_path is None and DEFAULT_RUNS_DB == "ichnoscope_runs.db":
        with TursoConnection(turso_url.strip(), turso_token.strip()) as conn:
            conn.execute_batch(tables)
            migrate_to_v2(conn)
        _INITIALIZED_DBS.add(cache_key)
        return turso_url

    path = get_db_path(db_path)
    with sqlite3.connect(path) as conn:
        for stmt in tables:
            try:
                conn.execute(stmt)
            except Exception:
                pass
        migrate_to_v2(conn)
        for stmt in tables:
            if "INDEX" in stmt:
                try:
                    conn.execute(stmt)
                except Exception:
                    pass
        conn.commit()
    _INITIALIZED_DBS.add(cache_key)
    return path


def migrate_to_v2(conn: Any) -> None:
    """Add dual-gate columns and auxiliary tables without dropping existing run data."""
    desired_columns = {
        "severity": "TEXT",
        "is_regression": "INTEGER DEFAULT 0",
        "issue_url": "TEXT",
        "draft_title": "TEXT",
        "draft_body": "TEXT",
        "raw_payload": "TEXT",
        "project_id": "TEXT",
        "workspace_id": "TEXT",
    }
    existing: set[str] = set()
    try:
        cursor = conn.execute("PRAGMA table_info(runs);")
        rows = cursor.fetchall() if cursor is not None else []
        existing = {str(row[1]) for row in rows}
    except Exception:  # noqa: BLE001
        existing = set()

    for name, col_type in desired_columns.items():
        if name in existing:
            continue
        try:
            conn.execute(f"ALTER TABLE runs ADD COLUMN {name} {col_type};")
        except Exception as exc:  # noqa: BLE001
            logger.debug("Skipping ALTER TABLE for %s: %s", name, exc)
    try:
        conn.execute("CREATE INDEX IF NOT EXISTS idx_runs_project ON runs (project_id, status);")
    except Exception:
        pass

    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS gate_reviews (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id TEXT NOT NULL,
                gate TEXT NOT NULL,
                action TEXT NOT NULL,
                reviewer TEXT NOT NULL,
                notes TEXT,
                created_at REAL NOT NULL
            );
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS automation_policies (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                is_active INTEGER DEFAULT 1,
                rule_json TEXT NOT NULL,
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL
            );
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS project_keys (
                project_id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                public_key TEXT UNIQUE NOT NULL,
                secret_key TEXT NOT NULL,
                rate_limit_min INTEGER DEFAULT 120,
                environment TEXT DEFAULT 'production',
                github_repo_override TEXT,
                slack_channel_override TEXT,
                is_active INTEGER DEFAULT 1,
                created_at REAL NOT NULL
            );
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS workspaces (
                workspace_id TEXT PRIMARY KEY,
                name         TEXT NOT NULL,
                owner_id     TEXT NOT NULL,
                created_at   REAL NOT NULL
            );
            """
        )
        for col in [
            "github_repo_override",
            "slack_channel_override",
            "github_installation_id",
            "github_repo",
            "description",
            "webhook_url",
            "fallback_assignee",
            "path_prefix_strip",
            "window_hours",
            "automation_mode_override",
            "updated_at",
            "owner_id",
            "workspace_id",
        ]:
            try:
                conn.execute(f"ALTER TABLE project_keys ADD COLUMN {col} TEXT;")
            except Exception:
                pass
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS system_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at REAL NOT NULL
            );
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS user_profiles (
                user_id     TEXT PRIMARY KEY,
                email       TEXT NOT NULL,
                display_name TEXT,
                avatar_url  TEXT,
                created_at  REAL NOT NULL,
                last_login  REAL
            );
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS team_members (
                id          TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL,
                project_id  TEXT,
                user_id     TEXT NOT NULL,
                role        TEXT NOT NULL DEFAULT 'viewer',
                invited_by  TEXT,
                created_at  REAL NOT NULL
            );
            """
        )
        try:
            conn.execute("ALTER TABLE team_members ADD COLUMN workspace_id TEXT;")
        except Exception:
            pass
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS team_audit_log (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id  TEXT NOT NULL,
                actor_id    TEXT NOT NULL,
                action      TEXT NOT NULL,
                target_id   TEXT,
                details     TEXT,
                created_at  REAL NOT NULL
            );
            """
        )
        try:
            conn.execute("CREATE INDEX IF NOT EXISTS idx_team_members_project ON team_members (project_id);")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members (user_id);")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_team_audit_project ON team_audit_log (project_id, created_at DESC);")
        except Exception:
            pass
    except Exception as exc:  # noqa: BLE001
        logger.debug("Auxiliary table create skipped: %s", exc)


def save_system_setting(key: str, value: str, db_path: Path | str | None = None) -> None:
    """Persist system setting to SQLite/Turso database."""
    init_db(db_path)
    import time
    now = time.time()
    with get_db(db_path) as conn:
        cursor = conn.execute("SELECT key FROM system_settings WHERE key = ?;", (key,))
        if cursor.fetchone():
            conn.execute("UPDATE system_settings SET value = ?, updated_at = ? WHERE key = ?;", (value, now, key))
        else:
            conn.execute("INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?);", (key, value, now))


def get_system_settings(db_path: Path | str | None = None) -> dict[str, str]:
    """Retrieve all persisted system settings from SQLite/Turso database."""
    init_db(db_path)
    with get_db(db_path) as conn:
        cursor = conn.execute("SELECT key, value FROM system_settings;")
        rows = cursor.fetchall()
        return {r[0]: r[1] for r in rows}

