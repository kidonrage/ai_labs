from __future__ import annotations

import logging
import threading
from datetime import datetime

from storage import load_summary, save_summary


def _format_runs_text(runs_total: int) -> str:
    if runs_total % 10 == 1 and runs_total % 100 != 11:
        suffix = "раз"
    elif runs_total % 10 in {2, 3, 4} and runs_total % 100 not in {12, 13, 14}:
        suffix = "раза"
    else:
        suffix = "раз"
    return f"Фоновая задача была выполнена {runs_total} {suffix}."


class PeriodicSummaryWorker:
    def __init__(self, logger: logging.Logger) -> None:
        self._logger = logger
        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self._stop_event: threading.Event | None = None
        self._interval_seconds: int | None = None

    def start(self, interval_seconds: int) -> None:
        with self._lock:
            self._stop_locked()
            self._interval_seconds = interval_seconds
            self._stop_event = threading.Event()
            self._thread = threading.Thread(
                target=self._run_loop,
                name="periodic-summary-worker",
                args=(interval_seconds, self._stop_event),
                daemon=True,
            )
            self._logger.info("Starting background worker with interval_seconds=%s", interval_seconds)
            self._thread.start()

    def stop(self) -> None:
        with self._lock:
            self._stop_locked()

    def _stop_locked(self) -> None:
        thread = self._thread
        stop_event = self._stop_event
        self._thread = None
        self._stop_event = None
        self._interval_seconds = None
        if stop_event is None:
            return
        self._logger.info("Stopping background worker")
        stop_event.set()
        if thread is not None and thread.is_alive():
            thread.join(timeout=2)

    def _run_loop(self, interval_seconds: int, stop_event: threading.Event) -> None:
        self._logger.info("Background worker thread started")
        while not stop_event.wait(interval_seconds):
            self._run_once(interval_seconds)
        self._logger.info("Background worker thread stopped")

    def _run_once(self, interval_seconds: int) -> None:
        self._logger.info("Periodic task fired")
        summary = load_summary(self._logger)
        last_run_at = datetime.now().replace(microsecond=0).isoformat()
        runs_total = summary["runs_total"] + 1
        updated_summary = {
            "enabled": True,
            "interval_seconds": interval_seconds,
            "runs_total": runs_total,
            "last_run_at": last_run_at,
            "summary_text": f"{_format_runs_text(runs_total)} Последний запуск: {last_run_at}",
        }
        save_summary(updated_summary, self._logger)

    @property
    def interval_seconds(self) -> int | None:
        return self._interval_seconds
