"""Educational example of MCP tool composition with FastMCP."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from mcp.server.fastmcp import FastMCP


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
LOGGER = logging.getLogger("simple_mcp_pipeline")

SERVER = FastMCP("simple-pipeline")

MOCK_SEARCH_DATA: dict[str, str] = {
    "mcp": "MCP is a protocol that helps tools and AI systems work together in a clear and structured way.",
    "fastmcp": "FastMCP is a simple way to build MCP servers in Python with minimal boilerplate code.",
    "llm": "LLM stands for large language model. It can generate text, answer questions, and help with automation.",
    "pipeline": "A pipeline is a sequence of steps where the output of one step becomes the input of the next step.",
    "tool": "A tool is a callable function exposed by an MCP server for structured use by a client.",
}

SUMMARY_LIMIT = 80


def _search_data(query: str) -> str:
    """Return mock search data for a query.

    Args:
        query: Text key used to search in the local mock dictionary.

    Returns:
        A found text value or a readable message when nothing matches.
    """
    normalized_query = query.strip().lower()
    LOGGER.info("Search step started with query=%r", normalized_query)

    if not normalized_query:
        result = "No data found for query: "
        LOGGER.info("Search step result=%r", result)
        return result

    result = MOCK_SEARCH_DATA.get(
        normalized_query,
        f"No data found for query: {query}",
    )
    LOGGER.info("Search step result=%r", result)
    return result


def _summarize_text(text: str) -> str:
    """Create a very small summary from text.

    Args:
        text: Source text that should be shortened.

    Returns:
        The original text if it is short enough, otherwise a trimmed version.
    """
    LOGGER.info("Summarize step started with text=%r", text)

    clean_text = text.strip()
    if len(clean_text) <= SUMMARY_LIMIT:
        summary = clean_text
    else:
        summary = clean_text[:SUMMARY_LIMIT].rstrip() + "..."

    LOGGER.info("Summarize step result=%r", summary)
    return summary


def _save_text_to_file(filename: str, content: str) -> str:
    """Save text content into a file in the current directory.

    Args:
        filename: Name of the file to create or overwrite.
        content: Text content that should be written into the file.

    Returns:
        A short status message describing where the file was saved.
    """
    LOGGER.info("Save step started with filename=%r", filename)

    safe_name = Path(filename).name.strip()
    if not safe_name:
        raise ValueError("filename must not be empty")

    file_path = Path.cwd() / safe_name
    with open(file_path, "w", encoding="utf-8") as file:
        file.write(content)

    status = f"Saved result to {file_path.name}"
    LOGGER.info("Save step result=%r", status)
    return status


@SERVER.tool()
def search(query: str) -> str:
    """Find mock data for a query.

    Args:
        query: Search text used to look up data in the local dictionary.

    Returns:
        A string with found mock data or a message that nothing was found.
    """
    LOGGER.info("Tool called: search query=%r", query)
    return _search_data(query)


@SERVER.tool()
def summarize(text: str) -> str:
    """Build a primitive summary for text.

    Args:
        text: Input text that should be shortened for display or saving.

    Returns:
        A short summary string.
    """
    LOGGER.info("Tool called: summarize text=%r", text)
    return _summarize_text(text)


@SERVER.tool()
def save_to_file(filename: str, content: str) -> str:
    """Save content into a file in the current directory.

    Args:
        filename: Name of the file to create or overwrite.
        content: Text content that should be written into the file.

    Returns:
        A status string describing the save result.
    """
    LOGGER.info("Tool called: save_to_file filename=%r content=%r", filename, content)
    return _save_text_to_file(filename, content)


@SERVER.tool()
def run_pipeline(query: str, filename: str) -> dict[str, Any]:
    """Run the full pipeline: search, summarize, and save.

    Args:
        query: Search text used to get mock data.
        filename: Name of the file where the summary should be saved.

    Returns:
        A dictionary with the query, raw data, summary, and save status.
    """
    LOGGER.info("Tool called: run_pipeline query=%r filename=%r", query, filename)

    raw_data = _search_data(query)
    summary = _summarize_text(raw_data)
    save_status = _save_text_to_file(filename, summary)

    result = {
        "query": query,
        "raw_data": raw_data,
        "summary": summary,
        "save_status": save_status,
    }
    LOGGER.info("Pipeline finished with result=%r", result)
    return result


def main() -> None:
    """Start the FastMCP server using stdio transport.

    Args:
        None.

    Returns:
        None.
    """
    LOGGER.info("Starting FastMCP server")
    SERVER.run(transport="stdio")


if __name__ == "__main__":
    main()
