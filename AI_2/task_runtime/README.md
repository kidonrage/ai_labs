# Task Runtime

Local Python subsystem for delayed and periodic MCP-backed jobs.

## Components

- `task_runtime.scheduler`: polling scheduler with JSON storage
- `task_runtime.task_mcp_server`: MCP server for managing tasks
- `local_runtime/start_local_stack.py`: launcher for local background processes

## Start

```bash
python3 local_runtime/start_local_stack.py
```

## MCP tools

- `schedule_task`
- `update_task`
- `list_tasks`
- `get_task`
- `delete_task`
- `run_task_now`
- `list_task_runs`
- `get_task_summary`
- `get_tasks_overview`

## Storage

- `task_runtime/storage/tasks.json`
- `task_runtime/storage/runs.json`

Both files are updated atomically and backed up to `*.bak`.
