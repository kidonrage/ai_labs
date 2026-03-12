from __future__ import annotations

import logging
from typing import Any

from mcp.server.fastmcp import FastMCP

from storage import (
    DEFAULT_SUMMARY,
    ensure_storage_files,
    load_summary,
    load_task_config,
    save_summary,
    save_task_config,
)
from worker import PeriodicSummaryWorker


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
LOGGER = logging.getLogger("periodic_summary_server")

mcp = FastMCP("periodic-summary")
worker = PeriodicSummaryWorker(LOGGER)


def _sync_summary_enabled_state(enabled: bool, interval_seconds: int) -> None:
    summary = load_summary(LOGGER)
    summary["enabled"] = enabled
    summary["interval_seconds"] = interval_seconds
    if not enabled and summary["runs_total"] == 0:
        summary["summary_text"] = DEFAULT_SUMMARY["summary_text"]
    save_summary(summary, LOGGER)


def initialize_server_state() -> None:
    LOGGER.info("Starting MCP server")
    ensure_storage_files(LOGGER)
    task_config = load_task_config(LOGGER)
    load_summary(LOGGER)
    if task_config["enabled"]:
        LOGGER.info(
            "Restoring background worker after restart with interval_seconds=%s",
            task_config["interval_seconds"],
        )
        _sync_summary_enabled_state(True, task_config["interval_seconds"])
        worker.start(task_config["interval_seconds"])
    else:
        LOGGER.info("No enabled periodic task found on startup")


@mcp.tool()
def enable_periodic_summary(interval_seconds: int) -> dict[str, Any]:
    """Enable the periodic summary background task.

    Args:
        interval_seconds: int: How often the background task should run.
    """
    LOGGER.info("Tool called: enable_periodic_summary interval_seconds=%s", interval_seconds)
    if interval_seconds <= 0:
        raise ValueError("interval_seconds must be greater than 0")

    task_config = {
        "enabled": True,
        "interval_seconds": int(interval_seconds),
    }
    save_task_config(task_config, LOGGER)
    _sync_summary_enabled_state(True, task_config["interval_seconds"])
    worker.start(task_config["interval_seconds"])
    return {
        "status": "enabled",
        "interval_seconds": task_config["interval_seconds"],
    }


@mcp.tool()
def get_periodic_summary() -> dict[str, Any]:
    """Return the current saved periodic summary.

    Args:
        None.
    """
    LOGGER.info("Tool called: get_periodic_summary")
    return load_summary(LOGGER)


def main() -> None:
    initialize_server_state()
    try:
        mcp.run(transport="stdio")
    finally:
        LOGGER.info("Stopping MCP server")
        worker.stop()


if __name__ == "__main__":
    main()
