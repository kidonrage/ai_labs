"""Simple MCP orchestrator server for the educational composition example."""

from __future__ import annotations

import logging
import sys
from pathlib import Path
from typing import Any

from mcp import ClientSession
from mcp.client.stdio import StdioServerParameters, stdio_client
from mcp.server.fastmcp import FastMCP
from mcp.types import CallToolResult, TextContent


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
LOGGER = logging.getLogger("pipeline_server")

SERVER = FastMCP("pipeline-server")
BASE_DIR = Path(__file__).resolve().parent


def _build_server_parameters(script_name: str) -> StdioServerParameters:
    """Build stdio client parameters for a local MCP server script.

    Args:
        script_name: File name of the target server script.

    Returns:
        Parameters used by the MCP stdio client.
    """
    script_path = BASE_DIR / script_name
    return StdioServerParameters(
        command=sys.executable,
        args=[str(script_path)],
        cwd=str(BASE_DIR),
    )


def _extract_text_result(result: CallToolResult) -> str:
    """Extract plain text from an MCP tool result.

    Args:
        result: Raw result returned by the MCP client session.

    Returns:
        Plain text content from the tool response.
    """
    if result.structuredContent is not None:
        if isinstance(result.structuredContent, dict) and "result" in result.structuredContent:
            return str(result.structuredContent["result"])
        return str(result.structuredContent)

    text_parts: list[str] = []
    for item in result.content:
        if isinstance(item, TextContent):
            text_parts.append(item.text)

    return "\n".join(text_parts)


async def _call_text_tool(script_name: str, tool_name: str, arguments: dict[str, Any]) -> str:
    """Call a text-producing tool on another local MCP server.

    Args:
        script_name: File name of the target server script.
        tool_name: Name of the tool to call on that server.
        arguments: Tool arguments passed to the remote server.

    Returns:
        Plain text extracted from the remote tool result.
    """
    LOGGER.info(
        "Calling remote server script=%r tool=%r arguments=%r",
        script_name,
        tool_name,
        arguments,
    )
    server_parameters = _build_server_parameters(script_name)
    async with stdio_client(server_parameters) as (read_stream, write_stream):
        async with ClientSession(read_stream, write_stream) as session:
            await session.initialize()
            result = await session.call_tool(tool_name, arguments=arguments)

    text_result = _extract_text_result(result)
    LOGGER.info(
        "Remote tool finished script=%r tool=%r result=%r",
        script_name,
        tool_name,
        text_result,
    )
    return text_result


@SERVER.tool()
async def run_pipeline(query: str, filename: str) -> dict[str, str]:
    """Run the search, summarize, and save servers in sequence.

    Args:
        query: Search term passed to the search server.
        filename: File name passed to the save server.

    Returns:
        A dictionary with the query, raw data, summary, and save status.
    """
    LOGGER.info("Tool called: run_pipeline query=%r filename=%r", query, filename)

    raw_data = await _call_text_tool("search_server.py", "search", {"query": query})
    summary = await _call_text_tool("summarize_server.py", "summarize", {"text": raw_data})
    save_status = await _call_text_tool(
        "save_server.py",
        "save_to_file",
        {"filename": filename, "content": summary},
    )

    result = {
        "query": query,
        "raw_data": raw_data,
        "summary": summary,
        "save_status": save_status,
    }
    LOGGER.info("Tool result: run_pipeline result=%r", result)
    return result


def main() -> None:
    """Start the pipeline MCP server with stdio transport.

    Args:
        None.

    Returns:
        None.
    """
    LOGGER.info("Starting pipeline server")
    SERVER.run(transport="stdio")


if __name__ == "__main__":
    main()
