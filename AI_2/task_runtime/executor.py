from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import anyio
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from .config import PROJECT_DIR, REPO_ROOT


def _normalize_payload(value: Any) -> Any:
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if isinstance(value, list):
        return [_normalize_payload(item) for item in value]
    if isinstance(value, dict):
        return {str(key): _normalize_payload(item) for key, item in value.items()}
    if hasattr(value, "model_dump"):
        return _normalize_payload(value.model_dump(mode="json"))
    if hasattr(value, "__dict__"):
        return _normalize_payload(vars(value))
    return str(value)


def _result_to_text(result: Any) -> str:
    structured = getattr(result, "structuredContent", None)
    if structured:
        normalized = _normalize_payload(structured)
        if isinstance(normalized, dict) and isinstance(normalized.get("result"), str):
            return normalized["result"].strip()
        return json.dumps(normalized, ensure_ascii=False, sort_keys=True)
    content = getattr(result, "content", None)
    if isinstance(content, list):
        texts = []
        for item in content:
            text = getattr(item, "text", None)
            if isinstance(text, str) and text.strip():
                texts.append(text.strip())
        if texts:
            return "\n".join(texts)
    return ""


def discover_server_registry() -> dict[str, dict[str, Any]]:
    registry: dict[str, dict[str, Any]] = {}
    seen_paths = set()
    for root in (PROJECT_DIR, REPO_ROOT):
        if root in seen_paths or not root.exists():
            continue
        seen_paths.add(root)
        for config_path in root.rglob("mcp-config.json"):
            try:
                payload = json.loads(config_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            servers = payload.get("mcpServers")
            if not isinstance(servers, dict):
                continue
            for name, config in servers.items():
                if not isinstance(name, str) or not isinstance(config, dict):
                    continue
                registry[name] = {
                    "command": config.get("command"),
                    "args": config.get("args") if isinstance(config.get("args"), list) else [],
                    "cwd": str(config_path.parent),
                    "env": config.get("env") if isinstance(config.get("env"), dict) else None,
                    "config_path": str(config_path),
                }
    return registry


async def _call_tool_async(server_name: str, tool_name: str, tool_args: dict[str, Any]) -> dict[str, Any]:
    registry = discover_server_registry()
    server_config = registry.get(server_name)
    if not server_config:
        raise ValueError(f"Unknown target_server: {server_name}")
    command = server_config.get("command")
    if not isinstance(command, str) or not command.strip():
        raise ValueError(f"Server {server_name} has no command")
    args = [str(item) for item in server_config.get("args") or []]
    cwd = server_config.get("cwd")
    env = server_config.get("env")
    params = StdioServerParameters(
        command=command,
        args=args,
        cwd=Path(cwd) if isinstance(cwd, str) and cwd else None,
        env=env,
    )
    async with stdio_client(params) as streams:
        read_stream, write_stream = streams
        async with ClientSession(read_stream, write_stream) as session:
            await session.initialize()
            result = await session.call_tool(tool_name, tool_args)
    payload = _normalize_payload(getattr(result, "structuredContent", None))
    return {
        "is_error": bool(getattr(result, "isError", False)),
        "payload": payload,
        "text": _result_to_text(result),
    }


def call_mcp_tool(server_name: str, tool_name: str, tool_args: dict[str, Any]) -> dict[str, Any]:
    return anyio.run(_call_tool_async, server_name, tool_name, tool_args)
