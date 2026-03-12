from __future__ import annotations

import json
from typing import Any

from .config import SUMMARY_RECENT_LIMIT
from .models import TaskDefinition, TaskRun, default_summary_cache


def compact_text(value: Any, limit: int = 240) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        text = value.strip()
    else:
        text = json.dumps(value, ensure_ascii=False, sort_keys=True)
    if len(text) <= limit:
        return text
    return text[: limit - 3] + "..."


def build_summary_fragment(run: TaskRun) -> str:
    if run.status == "success":
        body = compact_text(run.result_text or run.result_payload)
        return f"{run.finished_at} success {body}".strip()
    body = compact_text(run.error_message)
    return f"{run.finished_at} error {body}".strip()


def build_task_summary(
    task: TaskDefinition,
    task_runs: list[TaskRun],
    recent_limit: int = SUMMARY_RECENT_LIMIT,
) -> dict[str, Any]:
    recent_runs = sorted(task_runs, key=lambda item: item.finished_at, reverse=True)
    summary = default_summary_cache(task.id)
    summary["total_runs"] = len(task_runs)
    summary["success_runs"] = sum(1 for item in task_runs if item.status == "success")
    summary["error_runs"] = sum(1 for item in task_runs if item.status == "error")

    last_success = next((item for item in recent_runs if item.status == "success"), None)
    last_error = next((item for item in recent_runs if item.status == "error"), None)
    summary["last_success_at"] = last_success.finished_at if last_success else None
    summary["last_error_at"] = last_error.finished_at if last_error else None
    summary["last_result_text"] = last_success.result_text if last_success else ""
    summary["last_error_message"] = last_error.error_message if last_error else ""

    recent_results = [
        {
            "run_id": item.run_id,
            "finished_at": item.finished_at,
            "result_text": item.result_text,
        }
        for item in recent_runs
        if item.status == "success"
    ][:recent_limit]
    recent_errors = [
        {
            "run_id": item.run_id,
            "finished_at": item.finished_at,
            "error_message": item.error_message,
        }
        for item in recent_runs
        if item.status == "error"
    ][:recent_limit]
    recent_fragments = [item.summary_fragment for item in recent_runs[:recent_limit] if item.summary_fragment]

    summary["recent_results"] = recent_results
    summary["recent_errors"] = recent_errors
    summary["recent_fragments"] = recent_fragments

    if task.summary_mode == "rolling":
        summary["rolling_text"] = "\n".join(reversed(recent_fragments))
    else:
        parts = []
        if last_success and last_success.result_text:
            parts.append(last_success.result_text)
        if last_error and (not last_success or last_error.finished_at > last_success.finished_at):
            parts.append(f"Last error: {last_error.error_message}")
        summary["rolling_text"] = "\n".join(parts).strip()

    return summary


def build_tasks_overview(tasks: list[TaskDefinition]) -> dict[str, Any]:
    enabled_tasks = [task for task in tasks if task.enabled]
    next_runs = sorted(
        (
            {
                "task_id": task.id,
                "title": task.title,
                "next_run_at": task.next_run_at,
            }
            for task in enabled_tasks
            if task.next_run_at
        ),
        key=lambda item: item["next_run_at"],
    )[:5]
    last_results = []
    for task in tasks:
        cache = task.summary_cache if isinstance(task.summary_cache, dict) else {}
        result_text = str(cache.get("last_result_text") or "").strip()
        if not result_text:
            continue
        last_results.append(
            {
                "task_id": task.id,
                "title": task.title,
                "last_result_text": result_text,
                "last_success_at": cache.get("last_success_at"),
            }
        )
    last_results.sort(key=lambda item: item.get("last_success_at") or "", reverse=True)

    return {
        "total_tasks": len(tasks),
        "enabled_tasks": len(enabled_tasks),
        "disabled_tasks": len(tasks) - len(enabled_tasks),
        "tasks_with_errors": sum(1 for task in tasks if task.last_status == "error"),
        "running_tasks": sum(1 for task in tasks if task.last_status == "running"),
        "next_runs": next_runs,
        "last_results": last_results[:5],
    }
