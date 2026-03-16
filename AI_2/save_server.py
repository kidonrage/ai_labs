"""Simple MCP save server for the educational composition example."""

from __future__ import annotations

import logging
from pathlib import Path

from mcp.server.fastmcp import FastMCP


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
LOGGER = logging.getLogger("save_server")

SERVER = FastMCP("save-server")


def _build_output_path(filename: str) -> Path:
    """Build a safe output path in the current working directory.

    Args:
        filename: User-provided file name.

    Returns:
        A path inside the current working directory.
    """
    safe_name = Path(filename).name.strip()
    if not safe_name:
        raise ValueError("filename must not be empty")
    return Path.cwd() / safe_name


@SERVER.tool()
def save_to_file(filename: str, content: str) -> str:
    """Save text content into a file in the current directory.

    Args:
        filename: Name of the file to create or overwrite.
        content: Text content that should be saved.

    Returns:
        A status message describing the save operation.
    """
    LOGGER.info("Tool called: save_to_file filename=%r content=%r", filename, content)
    output_path = _build_output_path(filename)
    with open(output_path, "w", encoding="utf-8") as file:
        file.write(content)
    result = f"Saved content to {output_path.name}"
    LOGGER.info("Tool result: save_to_file result=%r", result)
    return result


def main() -> None:
    """Start the save MCP server with stdio transport.

    Args:
        None.

    Returns:
        None.
    """
    LOGGER.info("Starting save server")
    SERVER.run(transport="stdio")


if __name__ == "__main__":
    main()
