from __future__ import annotations

import subprocess
import sys
from pathlib import Path

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from task_runtime.config import LOG_PATH, PROJECT_DIR, TASK_MCP_PID_PATH
    from task_runtime.json_store import ensure_storage_layout
    from task_runtime.scheduler import SCHEDULER_PID_PATH, pid_is_running
else:
    from .config import LOG_PATH, PROJECT_DIR, TASK_MCP_PID_PATH
    from .json_store import ensure_storage_layout
    from .scheduler import SCHEDULER_PID_PATH, pid_is_running


def _is_running(pid_path: Path) -> bool:
    if not pid_path.exists():
        return False
    try:
        pid = int(pid_path.read_text(encoding="utf-8").strip())
    except (OSError, ValueError):
        return False
    return pid_is_running(pid)


def _start_process(args: list[str]) -> int:
    process = subprocess.Popen(
        args,
        cwd=str(PROJECT_DIR),
        start_new_session=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    return process.pid


def main() -> None:
    ensure_storage_layout()
    started = {}
    if not _is_running(SCHEDULER_PID_PATH):
        started["scheduler"] = _start_process([sys.executable, "-m", "task_runtime.scheduler"])
    if not _is_running(TASK_MCP_PID_PATH):
        started["task_mcp_server"] = _start_process(
            [sys.executable, "-m", "task_runtime.task_mcp_server", "--transport", "streamable-http"]
        )
    if not started:
        print("local stack already running")
        return
    print("started local task runtime:")
    for name, pid in started.items():
        print(f"- {name}: pid {pid}")
    print(f"log file: {LOG_PATH}")


if __name__ == "__main__":
    main()
