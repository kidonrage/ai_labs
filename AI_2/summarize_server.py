"""Simple MCP summarize server for the educational composition example."""

from __future__ import annotations

import logging

from mcp.server.fastmcp import FastMCP


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
LOGGER = logging.getLogger("summarize_server")

SERVER = FastMCP("summarize-server")

SUMMARY_LIMIT = 80


def _trim_text(text: str, limit: int) -> str:
    """Trim text to a fixed length and add ellipsis when needed.

    Args:
        text: Source text that should be shortened.
        limit: Maximum number of characters before truncation.

    Returns:
        The original text when it fits, otherwise a shortened string.
    """
    clean_text = text.strip()
    if len(clean_text) <= limit:
        return clean_text
    return clean_text[:limit].rstrip() + "..."


@SERVER.tool()
def summarize(text: str) -> str:
    """Build a primitive summary by trimming long text.

    Args:
        text: Source text that should be summarized.

    Returns:
        A short summary string.
    """
    LOGGER.info("Tool called: summarize text=%r", text)
    result = _trim_text(text, SUMMARY_LIMIT)
    LOGGER.info("Tool result: summarize result=%r", result)
    return result


def main() -> None:
    """Start the summarize MCP server with stdio transport.

    Args:
        None.

    Returns:
        None.
    """
    LOGGER.info("Starting summarize server")
    SERVER.run(transport="stdio")


if __name__ == "__main__":
    main()
