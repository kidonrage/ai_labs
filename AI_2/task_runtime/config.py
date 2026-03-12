from __future__ import annotations

import os
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BASE_DIR.parent
REPO_ROOT = PROJECT_DIR.parent
STORAGE_DIR = BASE_DIR / "storage"
RUNTIME_DIR = BASE_DIR / "runtime"
TASKS_PATH = STORAGE_DIR / "tasks.json"
TASKS_BAK_PATH = STORAGE_DIR / "tasks.json.bak"
RUNS_PATH = STORAGE_DIR / "runs.json"
RUNS_BAK_PATH = STORAGE_DIR / "runs.json.bak"
LOCK_PATH = STORAGE_DIR / "store.lock"
LOG_PATH = BASE_DIR / "service.log"
TASK_RUNTIME_MCP_CONFIG_PATH = BASE_DIR / "mcp-config.json"
SCHEDULER_PID_PATH = RUNTIME_DIR / "task_scheduler.pid"
TASK_MCP_PID_PATH = RUNTIME_DIR / "task_mcp_server.pid"

TASK_SERVER_NAME = "task_runtime"
TASK_MCP_HOST = os.getenv("TASK_MCP_HOST", "127.0.0.1")
TASK_MCP_PORT = int(os.getenv("TASK_MCP_PORT", "8765"))
TASK_MCP_PATH = os.getenv("TASK_MCP_PATH", "/mcp")
SCHEDULER_POLL_SECONDS = max(1, int(os.getenv("TASK_SCHEDULER_POLL_SECONDS", "5")))
DEFAULT_MAX_RUN_HISTORY = max(1, int(os.getenv("TASK_MAX_RUN_HISTORY", "100")))
SUMMARY_RECENT_LIMIT = max(1, int(os.getenv("TASK_SUMMARY_RECENT_LIMIT", "5")))


def default_tasks_document() -> dict:
    return {"version": 1, "tasks": []}


def default_runs_document() -> dict:
    return {"version": 1, "runs": []}
