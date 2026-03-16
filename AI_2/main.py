"""Entry point that prints how to run the educational MCP server example."""

from __future__ import annotations


def build_instructions() -> str:
    """Build a short usage guide for the local MCP server example.

    Args:
        None.

    Returns:
        A plain text instruction block.
    """
    return "\n".join(
        [
            "Educational FastMCP server composition example",
            "",
            "Run each server in a separate terminal:",
            "  python3 search_server.py",
            "  python3 summarize_server.py",
            "  python3 save_server.py",
            "  python3 pipeline_server.py",
            "",
            "The pipeline server demonstrates MCP server composition.",
            "It calls the other three servers over MCP stdio transport.",
        ]
    )


def main() -> None:
    """Print local run instructions for the MCP example.

    Args:
        None.

    Returns:
        None.
    """
    print(build_instructions())


if __name__ == "__main__":
    main()
