"""Simple MCP server that returns the current git branch name."""

from __future__ import annotations

import logging
import subprocess
from pathlib import Path

from mcp.server.fastmcp import FastMCP


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
LOGGER = logging.getLogger("git_branch_server")

SERVER = FastMCP("git-branch-server")
PROJECT_ROOT = Path(__file__).resolve().parent
GIT_BRANCH_COMMAND = ["git", "branch", "--show-current"]
GIT_BRANCH_FALLBACK_COMMAND = ["git", "rev-parse", "--abbrev-ref", "HEAD"]


def _run_git_command(command: list[str]) -> subprocess.CompletedProcess[str]:
    """Run a git command from the project root without invoking a shell."""
    return subprocess.run(
        command,
        cwd=PROJECT_ROOT,
        capture_output=True,
        text=True,
        check=False,
        timeout=5,
    )


def _build_git_error(result: subprocess.CompletedProcess[str]) -> dict[str, str]:
    """Convert a failed git process into a small structured error."""
    stderr = (result.stderr or "").strip()
    if "not a git repository" in stderr.lower():
        return {"error": "Not a git repository"}
    if stderr:
        return {"error": stderr}
    return {"error": "Git command failed"}


def _build_process_error(error: Exception) -> dict[str, str]:
    """Convert local process failures into a structured tool response."""
    if isinstance(error, FileNotFoundError):
        return {"error": "Git is not installed"}
    if isinstance(error, subprocess.TimeoutExpired):
        return {"error": "Git command timed out"}
    return {"error": "Git command failed"}


@SERVER.tool()
def get_git_branch() -> dict[str, str]:
    """Return the current project git branch as structured MCP output."""
    LOGGER.info("Tool called: get_git_branch")
    try:
        result = _run_git_command(GIT_BRANCH_COMMAND)
    except (FileNotFoundError, subprocess.TimeoutExpired) as error_info:
        error = _build_process_error(error_info)
        LOGGER.warning("Tool result: get_git_branch result=%r", error)
        return error

    if result.returncode != 0:
        error = _build_git_error(result)
        LOGGER.warning("Tool result: get_git_branch result=%r", error)
        return error

    branch = result.stdout.strip()
    if branch:
        response = {"branch": branch}
        LOGGER.info("Tool result: get_git_branch result=%r", response)
        return response

    try:
        fallback = _run_git_command(GIT_BRANCH_FALLBACK_COMMAND)
    except (FileNotFoundError, subprocess.TimeoutExpired) as error_info:
        error = _build_process_error(error_info)
        LOGGER.warning("Tool result: get_git_branch result=%r", error)
        return error

    if fallback.returncode != 0:
        error = _build_git_error(fallback)
        LOGGER.warning("Tool result: get_git_branch result=%r", error)
        return error

    fallback_branch = fallback.stdout.strip()
    if fallback_branch and fallback_branch != "HEAD":
        response = {"branch": fallback_branch}
        LOGGER.info("Tool result: get_git_branch result=%r", response)
        return response

    error = {"error": "Unable to determine current branch"}
    LOGGER.warning("Tool result: get_git_branch result=%r", error)
    return error


def main() -> None:
    """Start the git branch MCP server with stdio transport."""
    LOGGER.info("Starting git branch server")
    SERVER.run(transport="stdio")


if __name__ == "__main__":
    main()
