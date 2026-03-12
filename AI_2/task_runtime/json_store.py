from __future__ import annotations

import json
import os
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

import fcntl

from .config import (
    LOCK_PATH,
    LOG_PATH,
    RUNS_BAK_PATH,
    RUNS_PATH,
    RUNTIME_DIR,
    STORAGE_DIR,
    TASKS_BAK_PATH,
    TASKS_PATH,
    default_runs_document,
    default_tasks_document,
)
from .models import TaskDefinition, TaskRun


def ensure_storage_layout() -> None:
    STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    if not TASKS_PATH.exists():
        _write_atomic_json(TASKS_PATH, TASKS_BAK_PATH, default_tasks_document())
    if not RUNS_PATH.exists():
        _write_atomic_json(RUNS_PATH, RUNS_BAK_PATH, default_runs_document())
    if not LOG_PATH.exists():
        LOG_PATH.touch()
    if not LOCK_PATH.exists():
        LOCK_PATH.touch()


def _read_json_file(path: Path, fallback: dict) -> dict:
    try:
        with path.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
        if isinstance(payload, dict):
            return payload
    except (OSError, json.JSONDecodeError):
        pass
    return fallback


def _write_atomic_json(path: Path, backup_path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    serialized = json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    if path.exists():
        try:
            backup_path.write_text(path.read_text(encoding="utf-8"), encoding="utf-8")
        except OSError:
            pass
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    with tmp_path.open("w", encoding="utf-8") as handle:
        handle.write(serialized)
        handle.flush()
        os.fsync(handle.fileno())
    tmp_path.replace(path)


@contextmanager
def store_lock() -> Iterator[None]:
    ensure_storage_layout()
    with LOCK_PATH.open("a+", encoding="utf-8") as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def load_tasks_unlocked() -> list[TaskDefinition]:
    payload = _read_json_file(TASKS_PATH, default_tasks_document())
    if not isinstance(payload.get("tasks"), list):
        payload = _read_json_file(TASKS_BAK_PATH, default_tasks_document())
    return [
        TaskDefinition.from_dict(item)
        for item in payload.get("tasks", [])
        if isinstance(item, dict)
    ]


def load_runs_unlocked() -> list[TaskRun]:
    payload = _read_json_file(RUNS_PATH, default_runs_document())
    if not isinstance(payload.get("runs"), list):
        payload = _read_json_file(RUNS_BAK_PATH, default_runs_document())
    return [
        TaskRun.from_dict(item)
        for item in payload.get("runs", [])
        if isinstance(item, dict)
    ]


def save_tasks_unlocked(tasks: list[TaskDefinition]) -> None:
    _write_atomic_json(
        TASKS_PATH,
        TASKS_BAK_PATH,
        {"version": 1, "tasks": [item.to_dict() for item in tasks]},
    )


def save_runs_unlocked(runs: list[TaskRun]) -> None:
    _write_atomic_json(
        RUNS_PATH,
        RUNS_BAK_PATH,
        {"version": 1, "runs": [item.to_dict() for item in runs]},
    )


def load_tasks() -> list[TaskDefinition]:
    with store_lock():
        return load_tasks_unlocked()


def load_runs() -> list[TaskRun]:
    with store_lock():
        return load_runs_unlocked()


def find_task(tasks: list[TaskDefinition], task_id: str) -> TaskDefinition | None:
    return next((task for task in tasks if task.id == task_id), None)
