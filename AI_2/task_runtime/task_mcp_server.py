from __future__ import annotations

import argparse
import atexit
import os
import sys
from pathlib import Path
from typing import Any

from mcp.server.fastmcp import FastMCP

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from task_runtime.config import TASK_MCP_HOST, TASK_MCP_PATH, TASK_MCP_PID_PATH, TASK_MCP_PORT
    from task_runtime.json_store import (
        find_task,
        load_runs_unlocked,
        load_tasks_unlocked,
        save_tasks_unlocked,
        store_lock,
    )
    from task_runtime.models import TaskDefinition, iso_now, parse_iso
    from task_runtime.scheduler import compute_next_run_at, perform_task_run, pid_is_running
    from task_runtime.summary import build_task_summary, build_tasks_overview
else:
    from .config import TASK_MCP_HOST, TASK_MCP_PATH, TASK_MCP_PID_PATH, TASK_MCP_PORT
    from .json_store import (
        find_task,
        load_runs_unlocked,
        load_tasks_unlocked,
        save_tasks_unlocked,
        store_lock,
    )
    from .models import TaskDefinition, iso_now, parse_iso
    from .scheduler import compute_next_run_at, perform_task_run, pid_is_running
    from .summary import build_task_summary, build_tasks_overview


mcp = FastMCP("task-runtime")


def acquire_pid_file() -> None:
    TASK_MCP_PID_PATH.parent.mkdir(parents=True, exist_ok=True)
    if TASK_MCP_PID_PATH.exists():
        try:
            existing_pid = int(TASK_MCP_PID_PATH.read_text(encoding="utf-8").strip())
        except (OSError, ValueError):
            existing_pid = 0
        if existing_pid and pid_is_running(existing_pid):
            raise SystemExit(f"Task MCP server already running with pid {existing_pid}")
    TASK_MCP_PID_PATH.write_text(str(os.getpid()), encoding="utf-8")

    def _cleanup() -> None:
        try:
            if TASK_MCP_PID_PATH.exists() and TASK_MCP_PID_PATH.read_text(encoding="utf-8").strip() == str(os.getpid()):
                TASK_MCP_PID_PATH.unlink()
        except OSError:
            pass

    atexit.register(_cleanup)


def _serialize_task(task: TaskDefinition) -> dict[str, Any]:
    return task.to_dict()


def _ensure_task_exists(task_id: str) -> TaskDefinition:
    with store_lock():
        tasks = load_tasks_unlocked()
        task = find_task(tasks, task_id)
    if not task:
        raise ValueError(f"Task not found: {task_id}")
    return task


def _compute_initial_next_run(schedule_type: str, run_at: str | None, interval_seconds: int | None) -> str | None:
    if schedule_type == "once":
        if not run_at:
            raise ValueError("run_at is required for once task")
        if not parse_iso(run_at):
            raise ValueError("run_at must be ISO-8601")
        return run_at
    if not interval_seconds or interval_seconds <= 0:
        raise ValueError("interval_seconds must be > 0 for interval task")
    dummy = TaskDefinition.create(
        title="tmp",
        schedule_type="interval",
        run_at=None,
        interval_seconds=interval_seconds,
        timezone_name="local",
        target_server="tmp",
        target_tool="tmp",
        target_args={},
        summary_mode="last",
    )
    return compute_next_run_at(dummy)


@mcp.tool()
def schedule_task(
    title: str,
    schedule_type: str,
    target_server: str,
    target_tool: str,
    target_args: dict[str, Any] | None = None,
    run_at: str | None = None,
    interval_seconds: int | None = None,
    summary_mode: str = "last",
    timezone: str = "local",
    enabled: bool = True,
    max_run_history: int = 100,
) -> dict[str, Any]:
    if not target_server.strip():
        raise ValueError("target_server is required")
    if not target_tool.strip():
        raise ValueError("target_tool is required")
    task = TaskDefinition.create(
        title=title,
        schedule_type=schedule_type,
        run_at=run_at,
        interval_seconds=interval_seconds,
        timezone_name=timezone,
        target_server=target_server,
        target_tool=target_tool,
        target_args=target_args or {},
        summary_mode=summary_mode,
        enabled=enabled,
        max_run_history=max_run_history,
    )
    task.next_run_at = (
        _compute_initial_next_run(task.schedule_type, task.run_at, task.interval_seconds)
        if task.enabled
        else None
    )
    with store_lock():
        tasks = load_tasks_unlocked()
        tasks.append(task)
        save_tasks_unlocked(tasks)
    return {
        "task_id": task.id,
        "next_run_at": task.next_run_at,
        "task": _serialize_task(task),
    }


@mcp.tool()
def update_task(
    task_id: str,
    title: str | None = None,
    enabled: bool | None = None,
    schedule_type: str | None = None,
    run_at: str | None = None,
    interval_seconds: int | None = None,
    target_server: str | None = None,
    target_tool: str | None = None,
    target_args: dict[str, Any] | None = None,
    summary_mode: str | None = None,
) -> dict[str, Any]:
    with store_lock():
        tasks = load_tasks_unlocked()
        task = find_task(tasks, task_id)
        if not task:
            raise ValueError(f"Task not found: {task_id}")
        if title is not None and title.strip():
            task.title = title.strip()
        if enabled is not None:
            task.enabled = bool(enabled)
        if schedule_type is not None:
            if schedule_type not in {"once", "interval"}:
                raise ValueError("schedule_type must be once or interval")
            task.schedule_type = schedule_type
        if run_at is not None:
            if run_at and not parse_iso(run_at):
                raise ValueError("run_at must be ISO-8601")
            task.run_at = run_at
        if interval_seconds is not None:
            if interval_seconds <= 0:
                raise ValueError("interval_seconds must be > 0")
            task.interval_seconds = int(interval_seconds)
        if target_server is not None:
            if not target_server.strip():
                raise ValueError("target_server cannot be empty")
            task.target_server = target_server.strip()
        if target_tool is not None:
            if not target_tool.strip():
                raise ValueError("target_tool cannot be empty")
            task.target_tool = target_tool.strip()
        if target_args is not None:
            task.target_args = dict(target_args)
        if summary_mode is not None:
            task.summary_mode = summary_mode if summary_mode in {"last", "rolling"} else task.summary_mode
        task.updated_at = iso_now()
        task.next_run_at = None if not task.enabled else _compute_initial_next_run(
            task.schedule_type,
            task.run_at,
            task.interval_seconds,
        )
        save_tasks_unlocked(tasks)
        return {"task": _serialize_task(task)}


@mcp.tool()
def list_tasks() -> list[dict[str, Any]]:
    with store_lock():
        tasks = load_tasks_unlocked()
    tasks.sort(key=lambda item: ((item.next_run_at or "9999"), item.title))
    return [
        {
            "id": task.id,
            "title": task.title,
            "enabled": task.enabled,
            "schedule_type": task.schedule_type,
            "next_run_at": task.next_run_at,
            "last_status": task.last_status,
            "last_run_at": task.last_run_at,
        }
        for task in tasks
    ]


@mcp.tool()
def get_task(task_id: str) -> dict[str, Any]:
    return _serialize_task(_ensure_task_exists(task_id))


@mcp.tool()
def delete_task(task_id: str) -> dict[str, Any]:
    with store_lock():
        tasks = load_tasks_unlocked()
        task = find_task(tasks, task_id)
        if not task:
            raise ValueError(f"Task not found: {task_id}")
        task.enabled = False
        task.next_run_at = None
        task.updated_at = iso_now()
        save_tasks_unlocked(tasks)
        return {"task_id": task_id, "enabled": task.enabled}


@mcp.tool()
def run_task_now(task_id: str) -> dict[str, Any]:
    return perform_task_run(task_id, scheduled_for=iso_now(), trigger="manual")


@mcp.tool()
def list_task_runs(task_id: str, limit: int = 20) -> list[dict[str, Any]]:
    with store_lock():
        runs = load_runs_unlocked()
    task_runs = [run.to_dict() for run in runs if run.task_id == task_id]
    task_runs.sort(key=lambda item: item["finished_at"], reverse=True)
    return task_runs[: max(1, int(limit))]


@mcp.tool()
def get_task_summary(task_id: str) -> dict[str, Any]:
    with store_lock():
        tasks = load_tasks_unlocked()
        runs = load_runs_unlocked()
    task = find_task(tasks, task_id)
    if not task:
        raise ValueError(f"Task not found: {task_id}")
    task_runs = [run for run in runs if run.task_id == task_id]
    summary = build_task_summary(task, task_runs)
    return {
        "task_id": task_id,
        "title": task.title,
        "summary": summary,
    }


@mcp.tool()
def get_tasks_overview() -> dict[str, Any]:
    with store_lock():
        tasks = load_tasks_unlocked()
    return build_tasks_overview(tasks)


def main() -> None:
    parser = argparse.ArgumentParser(description="Run MCP server for task runtime.")
    parser.add_argument("--transport", choices=["stdio", "streamable-http"], default="streamable-http")
    parser.add_argument("--host", default=TASK_MCP_HOST)
    parser.add_argument("--port", type=int, default=TASK_MCP_PORT)
    args = parser.parse_args()
    acquire_pid_file()
    if args.transport == "streamable-http":
        mcp.settings.host = args.host
        mcp.settings.port = args.port
        mcp.settings.streamable_http_path = TASK_MCP_PATH
    mcp.run(transport=args.transport)


if __name__ == "__main__":
    main()
