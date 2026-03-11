# Kanye Quote MCP Server

Minimal local MCP server. One tool. One outbound HTTP request. No third-party dependencies.

## Requirements

- Python 3.11+

## Tool

- `get_kanye_quote`: fetches `https://api.kanye.rest` and returns the `quote` field as plain text.

## Run

```bash
python3 /Users/aura/Desktop/AI_CHALLENGE/kanye_mcp/server.py
```

## Example MCP client config

```json
{
  "mcpServers": {
    "kanye": {
      "command": "python3",
      "args": ["/Users/aura/Desktop/AI_CHALLENGE/kanye_mcp/server.py"]
    }
  }
}
```

## Notes

- The server uses stdio transport and implements `initialize`, `ping`, `tools/list`, and `tools/call`.
- Any API failure is returned as a structured MCP error instead of silent garbage.
