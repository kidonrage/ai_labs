from __future__ import annotations

import argparse
import atexit
import logging
import os
import signal
import sys
import time
from datetime import timedelta
from pathlib import Path
from typing import Any
from uuid import uuid4

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from task_runtime.config import LOG_PATH, SCHEDULER_PID_PATH, SCHEDULER_POLL_SECONDS
    from task_runtime.executor import call_mcp_tool
    from task_runtime.json_store import (
        find_task,
        load_runs_unlocked,
        load_tasks_unlocked,
        save_runs_unlocked,
        save_tasks_unlocked,
        store_lock,
    )
    from task_runtime.models import TaskDefinition, TaskRun, iso_now, parse_iso, utc_now
    from task_runtime.summary import build_summary_fragment, build_task_summary
else:
    from .config import LOG_PATH, SCHEDULER_PID_PATH, SCHEDULER_POLL_SECONDS
    from .executor import call_mcp_tool
    from .json_store import (
        find_task,
        load_runs_unlocked,
        load_tasks_unlocked,
        save_runs_unlocked,
        save_tasks_unlocked,
        store_lock,
    )
    from .models import TaskDefinition, TaskRun, iso_now, parse_iso, utc_now
    from .summary import build_summary_fragment, build_task_summary


LOGGER = logging.getLogger("task_scheduler")


def configure_logging() -> None:
    logging.basicConfig(
        filename=str(LOG_PATH),
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )


def pid_is_running(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def acquire_pid_file(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        try:
            existing_pid = int(path.read_text(encoding="utf-8").strip())
        except (OSError, ValueError):
            existing_pid = 0
        if existing_pid and pid_is_running(existing_pid):
            raise SystemExit(f"Scheduler already running with pid {existing_pid}")
    path.write_text(str(os.getpid()), encoding="utf-8")

    def _cleanup() -> None:
        try:
            if path.exists() and path.read_text(encoding="utf-8").strip() == str(os.getpid()):
                path.unlink()
        except OSError:
            pass

    atexit.register(_cleanup)


def _has_successful_once_run(task: TaskDefinition, runs: list[TaskRun]) -> bool:
    return any(run.task_id == task.id and run.status == "success" for run in runs)


def compute_next_run_at(task: TaskDefinition, *, now=None) -> str | None:
    current_time = now or utc_now()
    if not task.enabled:
        return None
    if task.schedule_type == "once":
        return task.run_at
    interval_seconds = task.interval_seconds or 0
    if interval_seconds <= 0:
        return None
    return (current_time + timedelta(seconds=interval_seconds)).isoformat()


def repair_after_restart() -> None:
    synthetic_runs: list[TaskRun] = []
    with store_lock():
        tasks = load_tasks_unlocked()
        runs = load_runs_unlocked()
        now = utc_now()
        changed = False
        for task in tasks:
            if task.last_status == "running":
                task.last_status = "error"
                task.updated_at = iso_now()
                interrupted_run = TaskRun(
                    run_id=f"run_{uuid4().hex}",
                    task_id=task.id,
                    scheduled_for=task.next_run_at or iso_now(),
                    started_at=task.last_run_at or iso_now(),
                    finished_at=iso_now(),
                    status="error",
                    attempt=1,
                    tool_server=task.target_server,
                    tool_name=task.target_tool,
                    tool_args=task.target_args,
                    result_payload=None,
                    result_text="",
                    error_message="interrupted by restart",
                    duration_ms=0,
                    summary_fragment="",
                )
                interrupted_run.summary_fragment = build_summary_fragment(interrupted_run)
                task.last_run_id = interrupted_run.run_id
                task.last_run_at = interrupted_run.finished_at
                synthetic_runs.append(interrupted_run)
                changed = True
            if task.schedule_type == "once":
                task.next_run_at = None if _has_successful_once_run(task, runs + synthetic_runs) else task.run_at
            elif task.next_run_at and parse_iso(task.next_run_at) and parse_iso(task.next_run_at) <= now:
                task.next_run_at = compute_next_run_at(task, now=now)
                changed = True
            elif task.schedule_type == "interval" and not task.next_run_at:
                task.next_run_at = compute_next_run_at(task, now=now)
                changed = True
        if synthetic_runs:
            runs.extend(synthetic_runs)
        if synthetic_runs or changed:
            for task in tasks:
                task_runs = [run for run in runs if run.task_id == task.id]
                task.summary_cache = build_task_summary(task, task_runs)
            save_runs_unlocked(runs)
            save_tasks_unlocked(tasks)


def _task_due(task: TaskDefinition, now_ts) -> bool:
    if not task.enabled or task.last_status == "running" or not task.next_run_at:
        return False
    scheduled_for = parse_iso(task.next_run_at)
    if not scheduled_for:
        return False
    return scheduled_for <= now_ts


def perform_task_run(task_id: str, *, scheduled_for: str | None = None, trigger: str = "scheduler") -> dict[str, Any]:
    with store_lock():
        tasks = load_tasks_unlocked()
        task = find_task(tasks, task_id)
        if not task:
            raise ValueError(f"Task not found: {task_id}")
        if task.last_status == "running":
            raise ValueError(f"Task already running: {task_id}")
        task.last_status = "running"
        task.updated_at = iso_now()
        scheduled_iso = scheduled_for or task.next_run_at or iso_now()
        save_tasks_unlocked(tasks)

    started_at = utc_now()
    error_message = ""
    result_payload = None
    result_text = ""
    status = "success"
    try:
        call_result = call_mcp_tool(task.target_server, task.target_tool, task.target_args)
        result_payload = call_result["payload"]
        result_text = call_result["text"]
        if call_result["is_error"]:
            status = "error"
            error_message = result_text or "tool returned error"
    except Exception as exc:  # pragma: no cover - exercised through integration path
        status = "error"
        error_message = str(exc)

    finished_at = utc_now()
    run = TaskRun(
        run_id=f"run_{uuid4().hex}",
        task_id=task_id,
        scheduled_for=scheduled_iso,
        started_at=started_at.isoformat(),
        finished_at=finished_at.isoformat(),
        status=status,
        attempt=1,
        tool_server=task.target_server,
        tool_name=task.target_tool,
        tool_args=task.target_args,
        result_payload=result_payload,
        result_text=result_text,
        error_message=error_message,
        duration_ms=max(0, int((finished_at - started_at).total_seconds() * 1000)),
        summary_fragment="",
    )
    run.summary_fragment = build_summary_fragment(run)

    with store_lock():
        tasks = load_tasks_unlocked()
        runs = load_runs_unlocked()
        task = find_task(tasks, task_id)
        if not task:
            raise ValueError(f"Task removed during execution: {task_id}")
        runs.append(run)
        task_runs = [item for item in runs if item.task_id == task.id]
        if len(task_runs) > task.max_run_history:
            keep_ids = {item.run_id for item in sorted(task_runs, key=lambda item: item.finished_at, reverse=True)[: task.max_run_history]}
            runs = [item for item in runs if item.task_id != task.id or item.run_id in keep_ids]
            task_runs = [item for item in runs if item.task_id == task.id]
        task.last_run_at = run.finished_at
        task.last_run_id = run.run_id
        task.last_status = run.status
        task.updated_at = iso_now()
        if task.schedule_type == "once":
            task.next_run_at = None
        else:
            task.next_run_at = compute_next_run_at(task, now=finished_at)
        task.summary_cache = build_task_summary(task, task_runs)
        save_runs_unlocked(runs)
        save_tasks_unlocked(tasks)

    LOGGER.info("Task %s finished via %s with status=%s", task_id, trigger, status)
    return {
        "run": run.to_dict(),
        "task_id": task_id,
        "status": status,
    }


def scheduler_loop(poll_seconds: int = SCHEDULER_POLL_SECONDS) -> None:
    LOGGER.info("Task scheduler started with poll_seconds=%s", poll_seconds)
    repair_after_restart()
    while True:
        now_ts = utc_now()
        with store_lock():
            tasks = load_tasks_unlocked()
        due_tasks = [task for task in tasks if _task_due(task, now_ts)]
        for task in due_tasks:
            try:
                perform_task_run(task.id, scheduled_for=task.next_run_at, trigger="scheduler")
            except Exception as exc:  # pragma: no cover - defensive runtime path
                LOGGER.exception("Task %s failed in scheduler loop: %s", task.id, exc)
        time.sleep(poll_seconds)


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the JSON-backed task scheduler.")
    parser.add_argument("--poll-seconds", type=int, default=SCHEDULER_POLL_SECONDS)
    args = parser.parse_args()
    configure_logging()
    acquire_pid_file(SCHEDULER_PID_PATH)

    def _handle_signal(signum, _frame) -> None:
        LOGGER.info("Scheduler received signal %s", signum)
        raise SystemExit(0)

    signal.signal(signal.SIGTERM, _handle_signal)
    signal.signal(signal.SIGINT, _handle_signal)
    scheduler_loop(max(1, args.poll_seconds))


if __name__ == "__main__":
    main()
