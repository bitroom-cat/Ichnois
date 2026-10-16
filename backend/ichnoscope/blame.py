"""GitHub GraphQL blame inspection and fallback commit analysis correlating incidents with code changes."""

import logging
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

import httpx

from ichnoscope.config import Settings
from ichnoscope.models import Culprit, Incident

logger = logging.getLogger(__name__)

GITHUB_GQL_ENDPOINT: str = "https://api.github.com/graphql"
GITHUB_REST_API: str = "https://api.github.com"
MAX_DIFF_CHARS: int = 6_000

GQL_BLAME_QUERY = """
query($owner: String!, $name: String!, $ref: String!, $path: String!) {
  repository(owner: $owner, name: $name) {
    object(expression: $ref) {
      ... on Commit {
        blame(path: $path) {
          ranges {
            startingLine
            endingLine
            commit {
              oid
              message
              committedDate
              author {
                name
                email
                user {
                  login
                }
              }
              associatedPullRequests(first: 1) {
                nodes {
                  number
                  author {
                    login
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
"""


@dataclass(frozen=True)
class BlameResult:
    """Diagnostic outcome of correlating a failing line with version history."""

    culprit: Culprit | None
    other_commits: list[Culprit]
    source: Literal["blame", "fallback", "stub", "none"]
    error: str | None = None


def commit_at_line(ranges: Sequence[dict[str, Any]], line: int) -> dict[str, Any] | None:
    """Find the commit associated with a line from blame ranges."""
    for rg in ranges:
        starting = rg.get("startingLine")
        ending = rg.get("endingLine")
        if starting is not None and ending is not None and starting <= line <= ending:
            return rg.get("commit")
    return None


def _parse_github_date(date_str: str | None) -> datetime:
    """Parse ISO8601 timestamp from GitHub API into UTC datetime."""
    if not date_str:
        return datetime.now(timezone.utc)
    try:
        clean = date_str.replace("Z", "+00:00")
        dt = datetime.fromisoformat(clean)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except (ValueError, TypeError):
        return datetime.now(timezone.utc)


def _fetch_file_diff(
    client: httpx.Client,
    owner: str,
    repo: str,
    sha: str,
    file_path: str,
    token: str | None,
) -> str:
    """Fetch file patch from commit REST endpoint, truncated to budget."""
    url = f"{GITHUB_REST_API}/repos/{owner}/{repo}/commits/{sha}"
    headers = {"Accept": "application/vnd.github.v3+json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    try:
        resp = client.get(url, headers=headers, timeout=15.0)
        if resp.status_code == 200:
            data = resp.json()
            for f in data.get("files", []):
                filename = f.get("filename", "")
                if filename == file_path or file_path.endswith(filename) or filename.endswith(file_path):
                    patch = f.get("patch", "")
                    if len(patch) > MAX_DIFF_CHARS:
                        return patch[:MAX_DIFF_CHARS] + "\n... [truncated]"
                    return patch
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to fetch file diff for %s:%s: %s", sha, file_path, exc)
    return ""


def _fetch_recent_commits(
    client: httpx.Client,
    owner: str,
    repo: str,
    file_path: str,
    token: str | None,
    limit: int = 3,
) -> list[dict[str, Any]]:
    """Fetch recent commits on a file via REST as fallback."""
    url = f"{GITHUB_REST_API}/repos/{owner}/{repo}/commits"
    headers = {"Accept": "application/vnd.github.v3+json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    params = {"path": file_path, "per_page": limit}

    try:
        resp = client.get(url, headers=headers, params=params, timeout=15.0)
        if resp.status_code == 200:
            data = resp.json()
            if isinstance(data, list):
                return data
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to fetch recent commits for %s: %s", file_path, exc)
    return []


def _build_stub_result(incident: Incident, settings: Settings) -> BlameResult:
    """Generate deterministic stub Culprit when USE_STUB_GITHUB is enabled."""
    occurred = incident.occurred_at
    stub_culprit = Culprit(
        sha="d3e5f60718293a4b5c6d7e8f9012345a14b9f2c7",
        author_login=settings.fallback_assignee or "octocat",
        author_name="Stub Developer",
        message=f"Refactor and update {incident.file_path}",
        committed_at=occurred - timedelta(hours=1),
        pr_number=42,
        diff=(
            f"--- a/{incident.file_path}\n"
            f"+++ b/{incident.file_path}\n"
            f"@@ -{incident.line_number},3 +{incident.line_number},3 @@\n"
            "-    old_implementation()\n"
            "+    new_implementation()\n"
        ),
        within_window=True,
        confidence="high",
    )
    return BlameResult(
        culprit=stub_culprit,
        other_commits=[],
        source="stub",
        error=None,
    )


def find_culprit(
    incident: Incident,
    *,
    settings: Settings | None = None,
    client: httpx.Client | None = None,
    repo_override: str | None = None,
    token_override: str | None = None,
    project_id: str | None = None,
) -> BlameResult:
    """Identify suspect commit correlating the failing line at release SHA with git history."""
    if settings is None:
        from ichnoscope.config import get_settings

        settings = get_settings()

    # 1. Stub mode
    if settings.use_stub_github:
        return _build_stub_result(incident, settings)

    # Dynamic project / GitHub App installation token lookup
    if project_id and not (token_override and repo_override):
        try:
            from ichnoscope.projects import get_project
            from ichnoscope.github_app import get_github_app_service
            proj = get_project(project_id)
            if proj and proj.github_installation_id and proj.github_repo:
                repo_override = proj.github_repo
                token_override = get_github_app_service().get_installation_token(proj.github_installation_id)
        except Exception as exc:
            logger.warning("Could not resolve dynamic GitHub App installation for project %s: %s", project_id, exc)

    owner = settings.github_owner
    repo = settings.github_repo_name
    if repo_override and "/" in repo_override:
        parts = repo_override.split("/", 1)
        owner, repo = parts[0], parts[1]

    token = token_override or (settings.github_token.get_secret_value() if settings.github_token else None)

    if not owner or not repo:
        return BlameResult(
            culprit=None,
            other_commits=[],
            source="none",
            error="GitHub repository not configured in settings",
        )

    http_client = client or httpx.Client()
    close_client = client is None

    try:
        ref = incident.release_sha or "HEAD"
        window_start = incident.occurred_at - timedelta(hours=settings.window_hours)

        # 2. Try GraphQL blame query at release_sha
        gql_headers = {
            "Accept": "application/vnd.github.v3+json",
        }
        if token:
            gql_headers["Authorization"] = f"Bearer {token}"

        ranges: list[dict[str, Any]] = []
        gql_error: str | None = None

        try:
            resp = http_client.post(
                GITHUB_GQL_ENDPOINT,
                headers=gql_headers,
                json={
                    "query": GQL_BLAME_QUERY,
                    "variables": {
                        "owner": owner,
                        "name": repo,
                        "ref": ref,
                        "path": incident.file_path,
                    },
                },
                timeout=20.0,
            )
            if resp.status_code == 200:
                body = resp.json()
                data = body.get("data") or {}
                repo_obj = data.get("repository") or {}
                commit_obj = repo_obj.get("object") or {}
                blame_obj = commit_obj.get("blame") or {}
                ranges = blame_obj.get("ranges") or []
            else:
                gql_error = f"GraphQL HTTP {resp.status_code}"
        except Exception as exc:  # noqa: BLE001
            gql_error = f"GraphQL error: {type(exc).__name__}"

        # 3. If blame ranges returned, look up line
        blamed_commit = commit_at_line(ranges, incident.line_number) if ranges else None
        if blamed_commit:
            sha = str(blamed_commit.get("oid") or "")
            msg = str(blamed_commit.get("message") or "")
            committed_at = _parse_github_date(blamed_commit.get("committedDate"))
            author_data = blamed_commit.get("author") or {}
            author_name = str(author_data.get("name") or "")

            author_login: str | None = None
            prs = blamed_commit.get("associatedPullRequests", {}).get("nodes", [])
            pr_number: int | None = None
            if prs and isinstance(prs, list) and len(prs) > 0:
                pr = prs[0]
                pr_number = pr.get("number")
                pr_author = pr.get("author") or {}
                author_login = pr_author.get("login")

            if not author_login and author_data.get("user"):
                author_login = author_data["user"].get("login")

            diff = _fetch_file_diff(http_client, owner, repo, sha, incident.file_path, token)
            within_window = committed_at >= window_start

            culprit = Culprit(
                sha=sha,
                author_login=author_login,
                author_name=author_name,
                message=msg,
                committed_at=committed_at,
                pr_number=pr_number,
                diff=diff,
                within_window=within_window,
                confidence="high",
            )
            return BlameResult(
                culprit=culprit,
                other_commits=[],
                source="blame",
                error=None,
            )

        # 4. Fallback to 3 latest commits on file (low confidence)
        recent_commits = _fetch_recent_commits(http_client, owner, repo, incident.file_path, token, limit=3)
        if recent_commits:
            culprits: list[Culprit] = []
            for item in recent_commits:
                c_sha = item.get("sha", "")
                commit_info = item.get("commit", {})
                c_msg = commit_info.get("message", "")
                c_author_info = commit_info.get("author", {})
                c_author_name = c_author_info.get("name", "")
                c_date = _parse_github_date(c_author_info.get("date"))

                c_login: str | None = None
                if item.get("author") and isinstance(item["author"], dict):
                    c_login = item["author"].get("login")

                c_diff = ""
                if not culprits:
                    c_diff = _fetch_file_diff(http_client, owner, repo, c_sha, incident.file_path, token)

                culprits.append(
                    Culprit(
                        sha=c_sha,
                        author_login=c_login,
                        author_name=c_author_name,
                        message=c_msg,
                        committed_at=c_date,
                        pr_number=None,
                        diff=c_diff,
                        within_window=c_date >= window_start,
                        confidence="low",
                    )
                )

            primary = culprits[0]
            others = culprits[1:]
            return BlameResult(
                culprit=primary,
                other_commits=others,
                source="fallback",
                error=gql_error or "Blame line not found in release commit",
            )

        return BlameResult(
            culprit=None,
            other_commits=[],
            source="none",
            error=gql_error or "No commit ranges or recent commits available for file",
        )
    finally:
        if close_client:
            http_client.close()
