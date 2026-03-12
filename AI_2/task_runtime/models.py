from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from .config import DEFAULT_MAX_RUN_HISTORY


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso_now() -> str:
    return utc_now().isoformat()


def normalize_iso(value: str | None) -> str | None:
    if not value or not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value).astimezone(timezone.utc).isoformat()
    except ValueError:
        return None


def parse_iso(value: str | None) -> datetime | None:
    normalized = normalize_iso(value)
    if not normalized:
        return None
    return datetime.fromisoformat(normalized)


def normalize_status(value: str | None) -> str:
    allowed = {"idle", "success", "error", "running"}
    return value if value in allowed else "idle"


def normalize_schedule_type(value: str | None) -> str:
    return value if value in {"once", "interval"} else "once"


def normalize_summary_mode(value: str | None) -> str:
    return value if value in {"last", "rolling"} else "last"


def default_summary_cache(task_id: str) -> dict[str, Any]:
    return {
        "task_id": task_id,
        "total_runs": 0,
        "success_runs": 0,
        "error_runs": 0,
        "last_success_at": None,
        "last_error_at": None,
        "last_result_text": "",
        "last_error_message": "",
        "rolling_text": "",
        "recent_results": [],
        "recent_errors": [],
        "recent_fragments": [],
    }


@dataclass(slots=True)
class TaskDefinition:
    id: str
    title: str
    enabled: bool
    schedule_type: str
    run_at: str | None
    interval_seconds: int | None
    timezone: str
    target_server: str
    target_tool: str
    target_args: dict[str, Any]
    summary_mode: str
    created_at: str
    updated_at: str
    last_run_at: str | None = None
    next_run_at: str | None = None
    last_status: str = "idle"
    last_run_id: str | None = None
    max_run_history: int = DEFAULT_MAX_RUN_HISTORY
    summary_cache: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def create(
        cls,
        *,
        title: str,
        schedule_type: str,
        run_at: str | None,
        interval_seconds: int | None,
        timezone_name: str,
        target_server: str,
        target_tool: str,
        target_args: dict[str, Any] | None,
        summary_mode: str,
        enabled: bool = True,
        max_run_history: int = DEFAULT_MAX_RUN_HISTORY,
    ) -> "TaskDefinition":
        task_id = f"task_{uuid4().hex}"
        now = iso_now()
        return cls(
            id=task_id,
            title=title.strip(),
            enabled=bool(enabled),
            schedule_type=normalize_schedule_type(schedule_type),
            run_at=normalize_iso(run_at),
            interval_seconds=interval_seconds,
            timezone=timezone_name or "local",
            target_server=target_server.strip(),
            target_tool=target_tool.strip(),
            target_args=dict(target_args or {}),
            summary_mode=normalize_summary_mode(summary_mode),
            created_at=now,
            updated_at=now,
            max_run_history=max(1, int(max_run_history)),
            summary_cache=default_summary_cache(task_id),
        )

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "TaskDefinition":
        task_id = str(raw.get("id") or f"task_{uuid4().hex}")
        title = str(raw.get("title") or "").strip() or task_id
        target_server = str(raw.get("target_server") or "").strip()
        target_tool = str(raw.get("target_tool") or "").strip()
        target_args = raw.get("target_args") if isinstance(raw.get("target_args"), dict) else {}
        max_run_history = raw.get("max_run_history")
        try:
            max_run_history = max(1, int(max_run_history))
        except (TypeError, ValueError):
            max_run_history = DEFAULT_MAX_RUN_HISTORY
        interval_seconds = raw.get("interval_seconds")
        try:
            interval_seconds = int(interval_seconds) if interval_seconds is not None else None
        except (TypeError, ValueError):
            interval_seconds = None
        summary_cache = raw.get("summary_cache")
        if not isinstance(summary_cache, dict):
            summary_cache = default_summary_cache(task_id)
        else:
            summary_cache = {**default_summary_cache(task_id), **summary_cache}
        created_at = normalize_iso(raw.get("created_at")) or iso_now()
        updated_at = normalize_iso(raw.get("updated_at")) or created_at
        return cls(
            id=task_id,
            title=title,
            enabled=bool(raw.get("enabled", True)),
            schedule_type=normalize_schedule_type(raw.get("schedule_type")),
            run_at=normalize_iso(raw.get("run_at")),
            interval_seconds=interval_seconds,
            timezone=str(raw.get("timezone") or "local"),
            target_server=target_server,
            target_tool=target_tool,
            target_args=target_args,
            summary_mode=normalize_summary_mode(raw.get("summary_mode")),
            created_at=created_at,
            updated_at=updated_at,
            last_run_at=normalize_iso(raw.get("last_run_at")),
            next_run_at=normalize_iso(raw.get("next_run_at")),
            last_status=normalize_status(raw.get("last_status")),
            last_run_id=str(raw.get("last_run_id")) if raw.get("last_run_id") else None,
            max_run_history=max_run_history,
            summary_cache=summary_cache,
        )

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class TaskRun:
    run_id: str
    task_id: str
    scheduled_for: str
    started_at: str
    finished_at: str
    status: str
    attempt: int
    tool_server: str
    tool_name: str
    tool_args: dict[str, Any]
    result_payload: Any
    result_text: str
    error_message: str
    duration_ms: int
    summary_fragment: str

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "TaskRun":
        return cls(
            run_id=str(raw.get("run_id") or f"run_{uuid4().hex}"),
            task_id=str(raw.get("task_id") or ""),
            scheduled_for=normalize_iso(raw.get("scheduled_for")) or iso_now(),
            started_at=normalize_iso(raw.get("started_at")) or iso_now(),
            finished_at=normalize_iso(raw.get("finished_at")) or iso_now(),
            status="success" if raw.get("status") == "success" else "error",
            attempt=int(raw.get("attempt") or 1),
            tool_server=str(raw.get("tool_server") or ""),
            tool_name=str(raw.get("tool_name") or ""),
            tool_args=raw.get("tool_args") if isinstance(raw.get("tool_args"), dict) else {},
            result_payload=raw.get("result_payload"),
            result_text=str(raw.get("result_text") or ""),
            error_message=str(raw.get("error_message") or ""),
            duration_ms=int(raw.get("duration_ms") or 0),
            summary_fragment=str(raw.get("summary_fragment") or ""),
        )

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
