"""Configuration management and environment variable loading for the Ichnoscope pipeline.

Safe to import with no environment variables set; reads environment lazily via load_settings / get_settings.
"""

import functools
import os
from collections.abc import Mapping
from pathlib import Path

from pydantic import BaseModel, ConfigDict, PrivateAttr, SecretStr


class ConfigError(Exception):
    """Raised when configuration values are missing, invalid, or inconsistent."""


class LLMProvider(BaseModel):
    """Configuration for an OpenAI-compatible LLM provider endpoint."""

    model_config = ConfigDict(frozen=True)

    name: str
    base_url: str
    api_key: SecretStr | None = None
    model: str


# Provider specifications table. Verify base URLs against each provider's current docs.
PROVIDER_SPECS: dict[str, dict[str, str | bool | None]] = {
    "gemini": {
        "key_env": "GEMINI_API_KEY",
        "model_env": "GEMINI_MODEL",
        "base_url_env": "GEMINI_BASE_URL",
        "default_base_url": "https://generativelanguage.googleapis.com/v1beta/openai/",
        "needs_key": True,
    },
    "groq": {
        "key_env": "GROQ_API_KEY",
        "model_env": "GROQ_MODEL",
        "base_url_env": "GROQ_BASE_URL",
        "default_base_url": "https://api.groq.com/openai/v1",
        "needs_key": True,
    },
    "openrouter": {
        "key_env": "OPENROUTER_API_KEY",
        "model_env": "OPENROUTER_MODEL",
        "base_url_env": "OPENROUTER_BASE_URL",
        "default_base_url": "https://openrouter.ai/api/v1",
        "needs_key": True,
    },
    "pollinations": {
        "key_env": "POLLINATIONS_API_KEY",
        "model_env": "POLLINATIONS_MODEL",
        "base_url_env": "POLLINATIONS_BASE_URL",
        "default_base_url": None,  # Must come from the env
        "needs_key": False,
    },
    "ollama": {
        "key_env": None,
        "model_env": "OLLAMA_MODEL",
        "base_url_env": "OLLAMA_BASE_URL",
        "default_base_url": "http://localhost:11434/v1",
        "needs_key": False,
    },
}

DEFAULT_LLM_CHAIN: tuple[str, ...] = ("gemini", "groq", "openrouter", "pollinations", "ollama")


def _parse_bool(var_name: str, value: str | None, default: bool) -> bool:
    """Parse boolean env var: true/1/yes/on vs false/0/no/off."""
    if value is None:
        return default
    trimmed = value.strip().lower()
    if not trimmed:
        return default
    if trimmed in {"true", "1", "yes", "on"}:
        return True
    if trimmed in {"false", "0", "no", "off"}:
        return False
    raise ConfigError(f"{var_name} must be a boolean (true/1/yes/on or false/0/no/off), got '{value}'")


def _parse_int(var_name: str, value: str | None, default: int, min_val: int = 0) -> int:
    """Parse integer env var with minimum value constraint."""
    if value is None:
        return default
    trimmed = value.strip()
    if not trimmed:
        return default
    try:
        parsed = int(trimmed)
    except ValueError as err:
        raise ConfigError(f"{var_name} must be an integer, got '{value}'") from err
    if parsed < min_val:
        raise ConfigError(f"{var_name} must be at least {min_val}, got {parsed}")
    return parsed


def _parse_str(value: str | None) -> str | None:
    """Trim string and treat empty string as missing."""
    if value is None:
        return None
    trimmed = value.strip()
    return trimmed if trimmed else None


def _parse_secret(value: str | None) -> SecretStr | None:
    """Trim secret string and return SecretStr, or None if missing."""
    s = _parse_str(value)
    return SecretStr(s) if s is not None else None


class Settings(BaseModel):
    """Immutable application settings loaded from environment or mapping."""

    model_config = ConfigDict(frozen=True)

    # GitHub and Sentry
    github_token: SecretStr | None = None
    github_repository: str | None = None
    github_app_id: str | None = None
    github_app_name: str | None = None
    github_app_private_key_path: str | None = None
    sentry_client_secret: SecretStr | None = None

    # Behavior
    path_prefix_strip: str = ""
    fallback_assignee: str | None = None
    slack_webhook_url: SecretStr | None = None
    dry_run: bool = True
    window_hours: int = 24
    admin_token: SecretStr | None = None
    internal_gateway_secret: SecretStr | None = None
    automation_mode: str = "semi_autonomous"
    use_stub_github: bool = False
    use_stub_llm: bool = False

    # Storage & Database
    turso_database_url: str | None = None
    turso_auth_token: SecretStr | None = None

    # Severity thresholds
    p1_users: int = 50
    p1_events: int = 100
    p2_users: int = 10
    p2_events: int = 20

    # LLM chain order
    llm_chain: tuple[str, ...] = DEFAULT_LLM_CHAIN

    # Private mapping of environment variables for LLM provider resolution
    _raw_env: dict[str, str] = PrivateAttr(default_factory=dict)

    @property
    def github_owner(self) -> str | None:
        if self.github_repository is None:
            return None
        parts = self.github_repository.split("/")
        if len(parts) != 2 or not parts[0] or not parts[1]:
            raise ConfigError(f"GITHUB_REPOSITORY must be formatted as 'owner/repo', got '{self.github_repository}'")
        return parts[0]

    @property
    def github_repo_name(self) -> str | None:
        if self.github_repository is None:
            return None
        parts = self.github_repository.split("/")
        if len(parts) != 2 or not parts[0] or not parts[1]:
            raise ConfigError(f"GITHUB_REPOSITORY must be formatted as 'owner/repo', got '{self.github_repository}'")
        return parts[1]

    def llm_providers(self) -> list[LLMProvider]:
        """Return usable LLM providers in LLM_CHAIN priority order."""
        providers: list[LLMProvider] = []
        for name in self.llm_chain:
            spec = PROVIDER_SPECS[name]
            model_val = _parse_str(self._raw_env.get(str(spec["model_env"])))
            if not model_val:
                continue

            base_url_env = str(spec["base_url_env"])
            base_url = _parse_str(self._raw_env.get(base_url_env)) or (
                spec["default_base_url"] if isinstance(spec["default_base_url"], str) else None
            )
            if not base_url:
                continue

            key_env = spec["key_env"]
            api_key: SecretStr | None = None
            if key_env is not None:
                api_key = _parse_secret(self._raw_env.get(str(key_env)))
                if spec["needs_key"] and api_key is None:
                    continue

            providers.append(
                LLMProvider(
                    name=name,
                    base_url=base_url,
                    api_key=api_key,
                    model=model_val,
                )
            )
        return providers

    def llm_skipped(self) -> dict[str, str]:
        """Return skipped LLM providers and their reason, for diagnostics and UI."""
        skipped: dict[str, str] = {}
        for name in self.llm_chain:
            spec = PROVIDER_SPECS[name]
            model_env = str(spec["model_env"])
            model_val = _parse_str(self._raw_env.get(model_env))
            if not model_val:
                skipped[name] = f"missing {model_env}"
                continue

            base_url_env = str(spec["base_url_env"])
            base_url = _parse_str(self._raw_env.get(base_url_env)) or (
                spec["default_base_url"] if isinstance(spec["default_base_url"], str) else None
            )
            if not base_url:
                skipped[name] = "no base URL"
                continue

            key_env = spec["key_env"]
            if key_env is not None and spec["needs_key"]:
                api_key = _parse_secret(self._raw_env.get(str(key_env)))
                if api_key is None:
                    skipped[name] = f"missing {key_env}"
                    continue
        return skipped

    def missing_for_pipeline(self) -> list[str]:
        """Return names of environment variables missing for the active pipeline configuration."""
        missing: list[str] = []
        if not self.use_stub_github:
            if self.github_token is None:
                missing.append("GITHUB_TOKEN")
            if self.github_repository is None:
                missing.append("GITHUB_REPOSITORY")
        if not self.use_stub_llm and not self.llm_providers():
            missing.append("LLM_CHAIN (no usable provider)")
        return missing

    def safe_summary(self) -> dict:
        """Return a sanitized, JSON-safe summary of settings safe for dashboards/logging."""
        return {
            "github_token": "configured" if self.github_token is not None else "missing",
            "github_repository": self.github_repository,
            "github_owner": self.github_owner,
            "github_repo_name": self.github_repo_name,
            "sentry_client_secret": "configured" if self.sentry_client_secret is not None else "missing",
            "slack_webhook_url": "configured" if self.slack_webhook_url is not None else "missing",
            "admin_token": "configured" if self.admin_token is not None else "missing",
            "internal_gateway_secret": "configured" if self.internal_gateway_secret is not None else "missing",
            "automation_mode": self.automation_mode,
            "fallback_assignee": self.fallback_assignee,
            "path_prefix_strip": self.path_prefix_strip,
            "dry_run": self.dry_run,
            "window_hours": self.window_hours,
            "use_stub_github": self.use_stub_github,
            "use_stub_llm": self.use_stub_llm,
            "p1_users": self.p1_users,
            "p1_events": self.p1_events,
            "p2_users": self.p2_users,
            "p2_events": self.p2_events,
            "turso_database": "configured" if self.turso_database_url else "local_sqlite",
            "usable_providers": [p.name for p in self.llm_providers()],
        }


def load_settings(env: Mapping[str, str]) -> Settings:
    """Build a frozen Settings object from an environment mapping."""
    merged_env = dict(env)
    try:
        from ichnoscope.db import get_system_settings
        db_settings = get_system_settings()
        for k, v in db_settings.items():
            if not env.get(k):
                merged_env[k] = v
    except Exception:
        pass
    env = merged_env

    # GitHub and Sentry
    github_token = _parse_secret(env.get("GITHUB_TOKEN"))
    github_repository = _parse_str(env.get("GITHUB_REPOSITORY"))
    github_app_id = _parse_str(env.get("GITHUB_APP_ID"))
    github_app_name = _parse_str(env.get("GITHUB_APP_NAME")) or "ichnois-connection"
    github_app_private_key_path = _parse_str(env.get("GITHUB_APP_PRIVATE_KEY_PATH"))
    sentry_client_secret = _parse_secret(env.get("SENTRY_CLIENT_SECRET"))

    # Database & Storage (Turso libSQL or Local SQLite)
    turso_database_url = _parse_str(env.get("TURSO_DATABASE_URL") or env.get("TURSO_DB_URL") or env.get("LIBSQL_URL"))
    turso_auth_token = _parse_secret(env.get("TURSO_AUTH_TOKEN") or env.get("TURSO_TOKEN") or env.get("LIBSQL_AUTH_TOKEN"))

    # Validate GITHUB_REPOSITORY format if set
    if github_repository is not None:
        parts = github_repository.split("/")
        if len(parts) != 2 or not parts[0] or not parts[1]:
            raise ConfigError(f"GITHUB_REPOSITORY must be formatted as 'owner/repo', got '{github_repository}'")

    # Behavior
    raw_path_prefix = _parse_str(env.get("PATH_PREFIX_STRIP")) or ""
    path_prefix_strip = raw_path_prefix if not raw_path_prefix or raw_path_prefix.endswith("/") else f"{raw_path_prefix}/"
    fallback_assignee = _parse_str(env.get("FALLBACK_ASSIGNEE"))
    slack_webhook_url = _parse_secret(env.get("SLACK_WEBHOOK_URL"))
    admin_token = _parse_secret(env.get("ADMIN_TOKEN") or env.get("ICHNOSCOPE_ADMIN_TOKEN"))
    internal_gateway_secret = _parse_secret(
        env.get("INTERNAL_GATEWAY_SECRET") or env.get("INTERNAL_GATEWAY_TOKEN")
    )
    raw_mode = (_parse_str(env.get("AUTOMATION_MODE")) or "semi_autonomous").lower().replace("-", "_")
    if raw_mode in {"manual", "full_manual"}:
        automation_mode = "full_manual"
    elif raw_mode in {"full", "full_auto", "fully_autonomous", "autonomous"}:
        automation_mode = "fully_autonomous"
    else:
        automation_mode = "semi_autonomous"
    dry_run = _parse_bool("DRY_RUN", env.get("DRY_RUN"), default=True)
    window_hours = _parse_int("WINDOW_HOURS", env.get("WINDOW_HOURS"), default=24, min_val=1)
    use_stub_github = _parse_bool("USE_STUB_GITHUB", env.get("USE_STUB_GITHUB"), default=False)
    use_stub_llm = _parse_bool("USE_STUB_LLM", env.get("USE_STUB_LLM"), default=False)

    # Thresholds
    p1_users = _parse_int("P1_USERS", env.get("P1_USERS"), default=50, min_val=0)
    p1_events = _parse_int("P1_EVENTS", env.get("P1_EVENTS"), default=100, min_val=0)
    p2_users = _parse_int("P2_USERS", env.get("P2_USERS"), default=10, min_val=0)
    p2_events = _parse_int("P2_EVENTS", env.get("P2_EVENTS"), default=20, min_val=0)

    if p2_users > p1_users:
        raise ConfigError(f"P2_USERS ({p2_users}) cannot be greater than P1_USERS ({p1_users})")
    if p2_events > p1_events:
        raise ConfigError(f"P2_EVENTS ({p2_events}) cannot be greater than P1_EVENTS ({p1_events})")

    # LLM chain parsing
    raw_chain = _parse_str(env.get("LLM_CHAIN"))
    if raw_chain:
        chain_list: list[str] = []
        for item in raw_chain.split(","):
            cleaned = item.strip().lower()
            if not cleaned:
                continue
            if cleaned not in PROVIDER_SPECS:
                raise ConfigError(f"Unknown provider '{cleaned}' in LLM_CHAIN; must be one of {list(PROVIDER_SPECS.keys())}")
            chain_list.append(cleaned)
        llm_chain = tuple(chain_list)
    else:
        llm_chain = DEFAULT_LLM_CHAIN

    settings = Settings(
        github_token=github_token,
        github_repository=github_repository,
        github_app_id=github_app_id,
        github_app_name=github_app_name,
        github_app_private_key_path=github_app_private_key_path,
        sentry_client_secret=sentry_client_secret,
        path_prefix_strip=path_prefix_strip,
        fallback_assignee=fallback_assignee,
        slack_webhook_url=slack_webhook_url,
        admin_token=admin_token,
        internal_gateway_secret=internal_gateway_secret,
        automation_mode=automation_mode,
        dry_run=dry_run,
        window_hours=window_hours,
        use_stub_github=use_stub_github,
        use_stub_llm=use_stub_llm,
        p1_users=p1_users,
        p1_events=p1_events,
        p2_users=p2_users,
        p2_events=p2_events,
        turso_database_url=turso_database_url,
        turso_auth_token=turso_auth_token,
        llm_chain=llm_chain,
    )
    object.__setattr__(settings, "_raw_env", dict(env))
    return settings


@functools.lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Load settings lazily from process environment and optional .env file."""
    try:
        from dotenv import load_dotenv

        load_dotenv()
        root_dir = Path(__file__).resolve().parents[2]
        load_dotenv(root_dir / "backend" / ".env")
        load_dotenv(root_dir / ".env")
    except ImportError:
        pass
    return load_settings(os.environ)
