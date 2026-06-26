"""Tool registry — wires each tool module into a single MCP server.

Every tool exposes:
  - ``NAME``          — string, matches the spec exactly.
  - ``DESCRIPTION``   — short human description used by MCP clients.
  - ``INPUT_SCHEMA``  — JSON Schema dict (from the Pydantic input model).
  - ``run(client, arguments)`` — async callable returning a JSON-serializable dict.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from mcp import types
from mcp.server import Server

from ..client import MarkClient
from . import (
    get_company,
    industry_overview,
    recent_tenders,
    region_overview,
    search_companies,
)

ToolModule = Any  # one of the modules below
ToolRunner = Callable[[MarkClient, dict[str, Any]], Awaitable[dict[str, Any]]]

_TOOL_MODULES: list[ToolModule] = [
    search_companies,
    get_company,
    recent_tenders,
    industry_overview,
    region_overview,
]


def tool_names() -> list[str]:
    return [m.NAME for m in _TOOL_MODULES]


def register_all(server: Server, client: MarkClient) -> None:
    """Attach list_tools + call_tool handlers to ``server`` for our 5 tools."""

    name_to_module: dict[str, ToolModule] = {m.NAME: m for m in _TOOL_MODULES}

    @server.list_tools()
    async def _list_tools() -> list[types.Tool]:
        return [
            types.Tool(
                name=m.NAME,
                description=m.DESCRIPTION,
                inputSchema=m.INPUT_SCHEMA,
            )
            for m in _TOOL_MODULES
        ]

    @server.call_tool()
    async def _call_tool(name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        module = name_to_module.get(name)
        if module is None:
            return {
                "error": f"Unknown tool: {name}",
                "status_code": 404,
                "hint": f"Available tools: {', '.join(name_to_module)}",
            }
        return await module.run(client, arguments or {})


__all__ = ["register_all", "tool_names"]
