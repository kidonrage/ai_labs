from __future__ import annotations

import json
import logging
import os
import tempfile
from pathlib import Path
from typing import Any


BASE_DIR = Path(__file__).resolve().parent
TASK_PATH = BASE_DIR / "task.json"
SUMMARY_PATH = BASE_DIR / "summary.json"

DEFAULT_INTERVAL_SECONDS = 10
DEFAULT_TASK = {
    "enabled": False,
    "interval_seconds": DEFAULT_INTERVAL_SECONDS,
}
DEFAULT_SUMMARY = {
    "enabled": False,
    "interval_seconds": DEFAULT_INTERVAL_SECONDS,
    "runs_total": 0,
    "last_run_at": None,
    "summary_text": "Фоновая задача ещё не запускалась.",
}


def _write_atomic_json(path: Path, payload: dict[str, Any]) -> None:
    serialized = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    fd, tmp_name = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=path.parent)
    tmp_path = Path(tmp_name)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write(serialized)
        handle.flush()
        os.fsync(handle.fileno())
    tmp_path.replace(path)


def _read_json(path: Path, fallback: dict[str, Any], logger: logging.Logger, label: str) -> dict[str, Any]:
    try:
        with path.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except FileNotFoundError:
        logger.info("%s not found. Recreating with defaults.", label)
        _write_atomic_json(path, fallback)
        return dict(fallback)
    except (OSError, json.JSONDecodeError):
        logger.exception("Failed to read %s. Recreating with defaults.", label)
        _write_atomic_json(path, fallback)
        return dict(fallback)

    if not isinstance(payload, dict):
        logger.error("%s has invalid format. Recreating with defaults.", label)
        _write_atomic_json(path, fallback)
        return dict(fallback)

    logger.info("Loaded %s: %s", label, payload)
    return payload


def ensure_storage_files(logger: logging.Logger) -> None:
    for path, default_payload, label in (
        (TASK_PATH, DEFAULT_TASK, "task.json"),
        (SUMMARY_PATH, DEFAULT_SUMMARY, "summary.json"),
    ):
        if path.exists():
            logger.info("%s already exists at %s", label, path)
            continue
        logger.info("Initializing %s at %s", label, path)
        _write_atomic_json(path, default_payload)


def load_task_config(logger: logging.Logger) -> dict[str, Any]:
    payload = _read_json(TASK_PATH, DEFAULT_TASK, logger, "task.json")
    enabled = bool(payload.get("enabled", DEFAULT_TASK["enabled"]))
    interval_seconds = int(payload.get("interval_seconds", DEFAULT_INTERVAL_SECONDS))
    if interval_seconds <= 0:
        logger.error("task.json contains invalid interval_seconds=%s. Falling back to %s.", interval_seconds, DEFAULT_INTERVAL_SECONDS)
        interval_seconds = DEFAULT_INTERVAL_SECONDS
    normalized = {
        "enabled": enabled,
        "interval_seconds": interval_seconds,
    }
    if normalized != payload:
        save_task_config(normalized, logger)
    return normalized


def load_summary(logger: logging.Logger) -> dict[str, Any]:
    payload = _read_json(SUMMARY_PATH, DEFAULT_SUMMARY, logger, "summary.json")
    interval_seconds = int(payload.get("interval_seconds", DEFAULT_INTERVAL_SECONDS))
    if interval_seconds <= 0:
        logger.error("summary.json contains invalid interval_seconds=%s. Falling back to %s.", interval_seconds, DEFAULT_INTERVAL_SECONDS)
        interval_seconds = DEFAULT_INTERVAL_SECONDS
    runs_total = int(payload.get("runs_total", 0))
    if runs_total < 0:
        logger.error("summary.json contains invalid runs_total=%s. Falling back to 0.", runs_total)
        runs_total = 0
    normalized = {
        "enabled": bool(payload.get("enabled", False)),
        "interval_seconds": interval_seconds,
        "runs_total": runs_total,
        "last_run_at": payload.get("last_run_at"),
        "summary_text": str(payload.get("summary_text", DEFAULT_SUMMARY["summary_text"])),
    }
    if normalized != payload:
        save_summary(normalized, logger)
    return normalized


def save_task_config(payload: dict[str, Any], logger: logging.Logger) -> None:
    try:
        _write_atomic_json(TASK_PATH, payload)
        logger.info("Updated task.json: %s", payload)
    except OSError:
        logger.exception("Failed to write task.json")
        raise


def save_summary(payload: dict[str, Any], logger: logging.Logger) -> None:
    try:
        _write_atomic_json(SUMMARY_PATH, payload)
        logger.info("Updated summary.json: %s", payload)
    except OSError:
        logger.exception("Failed to write summary.json")
        raise
