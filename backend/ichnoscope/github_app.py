"""GitHub App authentication and installation token manager.

Handles RS256 JWT generation using GitHub App private key (.pem)
and exchanges for scoped installation access tokens.
Supports local .pem files, Render /etc/secrets/ files, and GITHUB_APP_PRIVATE_KEY env vars.
"""

from __future__ import annotations

import base64
import logging
import os
import time
from pathlib import Path
from typing import Any

import httpx
import jwt
from cryptography.hazmat.primitives import serialization

logger = logging.getLogger(__name__)

GITHUB_API_BASE = "https://api.github.com"
GITHUB_API_VERSION = "2022-11-28"


class GitHubAppError(Exception):
    """Raised when GitHub App authentication or API calls fail."""


class GitHubAppService:
    """Manages GitHub App JWT signing, installation tokens, and repository queries."""

    def __init__(
        self,
        app_id: str | int | None = None,
        private_key_path: str | Path | None = None,
        private_key_bytes: bytes | None = None,
    ) -> None:
        if not app_id:
            try:
                from ichnoscope.config import get_settings
                self.app_id = str(get_settings().github_app_id or os.getenv("GITHUB_APP_ID") or "").strip()
            except Exception:
                self.app_id = str(os.getenv("GITHUB_APP_ID") or "").strip()
        else:
            self.app_id = str(app_id).strip()
        self._private_key_bytes: bytes | None = private_key_bytes
        self._private_key_path = Path(private_key_path) if private_key_path else None
        self._loaded_private_key: Any = None
        self._token_cache: dict[str, tuple[str, float]] = {}

    def _get_private_key_bytes(self) -> bytes:
        if self._private_key_bytes:
            return self._private_key_bytes

        # 1. Environment variable: raw or with literal \n
        env_raw_key = os.getenv("GITHUB_APP_PRIVATE_KEY")
        if env_raw_key and env_raw_key.strip():
            clean_key = env_raw_key.replace("\\n", "\n").replace("\n", "\n").strip()
            # If literal backslash-n exists, expand it
            if "\n" in clean_key and "\n" not in clean_key:
                clean_key = clean_key.replace("\n", chr(10))
            elif "\n" in clean_key:
                clean_key = clean_key.replace("\n", chr(10))
            self._private_key_bytes = clean_key.encode("utf-8")
            return self._private_key_bytes

        # 2. Environment variable: base64-encoded (safest for cloud dashboards)
        env_b64_key = os.getenv("GITHUB_APP_PRIVATE_KEY_BASE64")
        if env_b64_key and env_b64_key.strip():
            self._private_key_bytes = base64.b64decode(env_b64_key.strip())
            return self._private_key_bytes

        # 3. Look in configured path or project root search
        candidate_paths: list[Path] = []
        if self._private_key_path:
            candidate_paths.append(self._private_key_path)

        # Cloud secret mounts (Render /etc/secrets/)
        render_secret_dir = Path("/etc/secrets")
        if render_secret_dir.exists():
            candidate_paths.extend(list(render_secret_dir.glob("*.pem")))
            candidate_paths.extend(list(render_secret_dir.glob("*.key")))

        # Standard discovery locations in repo
        cwd = Path.cwd()
        candidate_paths.extend([
            cwd / "ichnois-connection.2026-10-16.private-key.pem",
            cwd / "backend" / "ichnois-connection.2026-10-16.private-key.pem",
        ])
        candidate_paths.extend(list(cwd.glob("*.private-key.pem")))

        for path in candidate_paths:
            if path.exists() and path.is_file():
                logger.info("Found GitHub App private key at %s", path)
                with open(path, "rb") as f:
                    self._private_key_bytes = f.read()
                    return self._private_key_bytes

        raise GitHubAppError(
            "GitHub App private key not found. Set GITHUB_APP_PRIVATE_KEY or GITHUB_APP_PRIVATE_KEY_BASE64 in your deployment environment variables, or upload the .pem file to /etc/secrets/."
        )

    def _get_loaded_private_key(self) -> Any:
        if self._loaded_private_key is None:
            raw_bytes = self._get_private_key_bytes()
            try:
                self._loaded_private_key = serialization.load_pem_private_key(
                    raw_bytes, password=None
                )
            except Exception as exc:
                raise GitHubAppError(f"Failed to parse private key PEM: {exc}") from exc
        return self._loaded_private_key

    def create_app_jwt(self, expire_seconds: int = 600) -> str:
        """Sign a RS256 JWT representing the GitHub App itself."""
        if not self.app_id:
            raise GitHubAppError("GITHUB_APP_ID is not configured.")

        key_bytes = self._get_private_key_bytes()
        now = int(time.time())
        payload = {
            "iat": now - 60,
            "exp": now + expire_seconds,
            "iss": self.app_id,
        }
        return jwt.encode(payload, key_bytes, algorithm="RS256")

    def get_installation_token(self, installation_id: str | int) -> str:
        """Exchange App JWT for an installation access token (cached until near expiry)."""
        inst_key = str(installation_id)
        now = time.time()

        if inst_key in self._token_cache:
            token, exp = self._token_cache[inst_key]
            if exp - now > 180:
                return token

        app_jwt = self.create_app_jwt()
        url = f"{GITHUB_API_BASE}/app/installations/{inst_key}/access_tokens"
        headers = {
            "Authorization": f"Bearer {app_jwt}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": GITHUB_API_VERSION,
        }

        try:
            with httpx.Client(timeout=15.0) as client:
                resp = client.post(url, headers=headers)
                if resp.status_code not in (200, 201):
                    raise GitHubAppError(
                        f"GitHub rejected installation token request ({resp.status_code}): {resp.text}"
                    )
                data = resp.json()
                token = data["token"]
                self._token_cache[inst_key] = (token, now + 3500)
                return token
        except httpx.HTTPError as exc:
            raise GitHubAppError(f"Network error contacting GitHub App API: {exc}") from exc

    def list_installation_repositories(self, installation_id: str | int) -> list[dict[str, Any]]:
        """List all repositories accessible to this installation."""
        token = self.get_installation_token(installation_id)
        url = f"{GITHUB_API_BASE}/installation/repositories"
        headers = {
            "Authorization": f"token {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": GITHUB_API_VERSION,
        }

        try:
            with httpx.Client(timeout=15.0) as client:
                resp = client.get(url, headers=headers)
                if resp.status_code != 200:
                    raise GitHubAppError(
                        f"Failed to list installation repositories ({resp.status_code}): {resp.text}"
                    )
                data = resp.json()
                repos = data.get("repositories", [])
                return [
                    {
                        "id": r["id"],
                        "name": r["name"],
                        "full_name": r["full_name"],
                        "private": r["private"],
                        "html_url": r["html_url"],
                        "description": r.get("description"),
                        "default_branch": r.get("default_branch", "main"),
                    }
                    for r in repos
                ]
        except httpx.HTTPError as exc:
            raise GitHubAppError(f"Failed to fetch repositories: {exc}") from exc

    def get_app_info(self) -> dict[str, Any]:
        """Fetch GitHub App metadata to verify authentication and App ID."""
        app_jwt = self.create_app_jwt()
        url = f"{GITHUB_API_BASE}/app"
        headers = {
            "Authorization": f"Bearer {app_jwt}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": GITHUB_API_VERSION,
        }
        with httpx.Client(timeout=10.0) as client:
            resp = client.get(url, headers=headers)
            if resp.status_code != 200:
                raise GitHubAppError(f"Could not verify GitHub App ({resp.status_code}): {resp.text}")
            return resp.json()


_service_instance: GitHubAppService | None = None


def get_github_app_service() -> GitHubAppService:
    """Return configured global GitHubAppService singleton."""
    global _service_instance
    if _service_instance is None:
        _service_instance = GitHubAppService()
    return _service_instance
