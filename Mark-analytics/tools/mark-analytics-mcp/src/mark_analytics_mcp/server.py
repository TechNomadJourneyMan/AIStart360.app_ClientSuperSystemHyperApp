"""MCP server bootstrap — wires the 5 read-only tools onto a stdio transport."""

from __future__ import annotations

from mcp.server import Server
from mcp.server.stdio import stdio_server

from . import __version__
from .client import MarkClient
from .tools import register_all

SERVER_NAME = "mark-analytics"


def build_server(client: MarkClient | None = None) -> tuple[Server, MarkClient]:
    """Build a configured MCP :class:`Server` plus the underlying :class:`MarkClient`.

    Factored out for testability — tests build the server without running it.
    Caller is responsible for closing the client (or letting the process exit
    handle it).
    """
    server: Server = Server(SERVER_NAME, version=__version__)
    api_client = client or MarkClient()
    register_all(server, api_client)
    return server, api_client


async def run_stdio() -> None:
    """Run the server over stdio (the transport Claude Desktop uses)."""
    server, client = build_server()
    try:
        async with stdio_server() as (read_stream, write_stream):
            await server.run(
                read_stream,
                write_stream,
                server.create_initialization_options(),
            )
    finally:
        await client.aclose()
