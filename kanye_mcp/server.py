#!/usr/bin/env python3
import json
import sys
import urllib.error
import urllib.request


SERVER_INFO = {
    "name": "kanye-quote-mcp",
    "version": "0.1.0",
}

TOOL_NAME = "get_kanye_quote"
QUOTE_URL = "https://api.kanye.rest"


class McpError(Exception):
    def __init__(self, code: int, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def read_message() -> dict | None:
    headers: dict[str, str] = {}

    while True:
        line = sys.stdin.buffer.readline()
        if not line:
            return None

        if line == b"\r\n":
            break

        decoded = line.decode("utf-8").strip()
        if not decoded:
            continue

        key, _, value = decoded.partition(":")
        headers[key.lower()] = value.strip()

    content_length = headers.get("content-length")
    if content_length is None:
        raise McpError(-32600, "Missing Content-Length header")

    try:
        size = int(content_length)
    except ValueError as exc:
        raise McpError(-32600, "Invalid Content-Length header") from exc

    body = sys.stdin.buffer.read(size)
    if len(body) != size:
        raise McpError(-32700, "Unexpected end of input")

    try:
        payload = json.loads(body.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise McpError(-32700, "Invalid JSON payload") from exc

    if not isinstance(payload, dict):
        raise McpError(-32600, "Top-level JSON value must be an object")

    return payload


def write_message(payload: dict) -> None:
    encoded = json.dumps(payload, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    sys.stdout.buffer.write(f"Content-Length: {len(encoded)}\r\n\r\n".encode("ascii"))
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()


def make_error_response(message_id, code: int, message: str) -> dict:
    return {
        "jsonrpc": "2.0",
        "id": message_id,
        "error": {
            "code": code,
            "message": message,
        },
    }


def fetch_quote() -> str:
    request = urllib.request.Request(
        QUOTE_URL,
        headers={
            "Accept": "application/json",
            "User-Agent": "kanye-quote-mcp/0.1.0",
        },
        method="GET",
    )

    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            status = getattr(response, "status", None)
            if status != 200:
                raise McpError(-32001, f"Quote API returned HTTP {status}")

            charset = response.headers.get_content_charset() or "utf-8"
            raw = response.read()
    except urllib.error.HTTPError as exc:
        raise McpError(-32001, f"Quote API returned HTTP {exc.code}") from exc
    except urllib.error.URLError as exc:
        raise McpError(-32002, f"Quote API request failed: {exc.reason}") from exc
    except TimeoutError as exc:
        raise McpError(-32003, "Quote API request timed out") from exc

    try:
        payload = json.loads(raw.decode(charset))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise McpError(-32004, "Quote API returned invalid JSON") from exc

    quote = payload.get("quote")
    if not isinstance(quote, str) or not quote.strip():
        raise McpError(-32005, "Quote API response did not contain a valid quote")

    return quote.strip()


def handle_initialize(message_id) -> dict:
    return {
        "jsonrpc": "2.0",
        "id": message_id,
        "result": {
            "protocolVersion": "2024-11-05",
            "capabilities": {
                "tools": {},
            },
            "serverInfo": SERVER_INFO,
        },
    }


def handle_tools_list(message_id) -> dict:
    return {
        "jsonrpc": "2.0",
        "id": message_id,
        "result": {
            "tools": [
                {
                    "name": TOOL_NAME,
                    "title": "Random Kanye West Quote",
                    "description": "Fetch a random Kanye West quote from api.kanye.rest.",
                    "inputSchema": {
                        "type": "object",
                        "properties": {},
                        "additionalProperties": False,
                    },
                }
            ]
        },
    }


def handle_tools_call(message_id, params: dict) -> dict:
    name = params.get("name")
    arguments = params.get("arguments", {})

    if name != TOOL_NAME:
        raise McpError(-32601, f"Unknown tool: {name}")

    if not isinstance(arguments, dict):
        raise McpError(-32602, "Tool arguments must be an object")

    if arguments:
        raise McpError(-32602, "This tool does not accept arguments")

    quote = fetch_quote()
    return {
        "jsonrpc": "2.0",
        "id": message_id,
        "result": {
            "content": [
                {
                    "type": "text",
                    "text": quote,
                }
            ],
            "isError": False,
        },
    }


def handle_ping(message_id) -> dict:
    return {
        "jsonrpc": "2.0",
        "id": message_id,
        "result": {},
    }


def dispatch(message: dict) -> dict | None:
    if message.get("jsonrpc") != "2.0":
        raise McpError(-32600, "Only JSON-RPC 2.0 is supported")

    method = message.get("method")
    message_id = message.get("id")
    params = message.get("params", {})

    if method is None:
        raise McpError(-32600, "Missing method")

    if not isinstance(params, dict):
        raise McpError(-32602, "Params must be an object")

    if method == "notifications/initialized":
        return None
    if method == "initialize":
        return handle_initialize(message_id)
    if method == "tools/list":
        return handle_tools_list(message_id)
    if method == "tools/call":
        return handle_tools_call(message_id, params)
    if method == "ping":
        return handle_ping(message_id)

    raise McpError(-32601, f"Method not found: {method}")


def main() -> int:
    while True:
        message = None
        try:
            message = read_message()
            if message is None:
                return 0

            response = dispatch(message)
            if response is not None and message.get("id") is not None:
                write_message(response)
        except McpError as exc:
            if isinstance(message, dict) and message.get("id") is not None:
                write_message(make_error_response(message.get("id"), exc.code, exc.message))
            else:
                write_message(make_error_response(None, exc.code, exc.message))
        except Exception:
            message_id = None
            if isinstance(message, dict):
                message_id = message.get("id")
            write_message(make_error_response(message_id, -32603, "Internal server error"))


if __name__ == "__main__":
    raise SystemExit(main())
