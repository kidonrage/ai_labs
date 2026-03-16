"""Simple MCP search server for the educational composition example."""

from __future__ import annotations

import logging

from mcp.server.fastmcp import FastMCP


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
LOGGER = logging.getLogger("search_server")

SERVER = FastMCP("search-server")

SEARCH_DATA: dict[str, str] = {
    "mcp": "MCP is a protocol that helps AI applications call tools and exchange structured context.",
    "fastmcp": "FastMCP is a lightweight Python interface for building MCP servers with minimal boilerplate.",
    "llm": "LLM means large language model, a system that can generate and transform text from prompts.",
    "pipeline": "A pipeline is a sequence of steps where the output from one step becomes the input for the next step.",
    "tool": "A tool is a function exposed by an MCP server so that a client can call it in a structured way.",
}


def _normalize_query(query: str) -> str:
    """Normalize a search query for dictionary lookup.

    Args:
        query: Raw search text from the caller.

    Returns:
        A trimmed lowercase query string.
    """
    return query.strip().lower()


@SERVER.tool()
def search(query: str) -> str:
    """Look up text in a local in-memory dictionary.

    Args:
        query: Search term to find in the built-in dictionary.

    Returns:
        Found text for the query or a readable not-found message.
    """
    LOGGER.info("Tool called: search query=%r", query)
    normalized_query = _normalize_query(query)
    result = SEARCH_DATA.get(normalized_query, f"No data found for query: {query}")
    LOGGER.info("Tool result: search result=%r", result)
    return result


def main() -> None:
    """Start the search MCP server with stdio transport.

    Args:
        None.

    Returns:
        None.
    """
    LOGGER.info("Starting search server")
    SERVER.run(transport="stdio")


if __name__ == "__main__":
    main()
