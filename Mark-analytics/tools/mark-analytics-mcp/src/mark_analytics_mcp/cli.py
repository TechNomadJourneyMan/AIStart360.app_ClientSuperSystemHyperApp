"""Console entry point for the ``mark-analytics-mcp`` package.

Invoked by:
  - ``mark-analytics-mcp`` (after ``pipx install``)
  - Claude Desktop / Cursor / Codex MCP config (stdio transport).
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys

from . import __version__
from .server import run_stdio


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="mark-analytics-mcp",
        description=(
            "Mark Analytics MCP server. Exposes 5 read-only tools "
            "(search_companies, get_company, get_recent_tenders, "
            "industry_overview, region_overview) to any MCP-compatible AI client."
        ),
    )
    parser.add_argument(
        "--transport",
        choices=["stdio"],
        default="stdio",
        help="Transport protocol (only `stdio` for now; HTTP planned).",
    )
    parser.add_argument(
        "--version",
        action="version",
        version=f"mark-analytics-mcp {__version__}",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)

    if args.transport != "stdio":  # pragma: no cover — argparse pins this.
        parser.error(f"Unsupported transport: {args.transport}")

    # Friendly hint when no token is set — server still starts (public reads work).
    if not os.environ.get("MK_TOKEN"):
        print(
            "mark-analytics-mcp: MK_TOKEN not set — running in public-read mode. "
            "Set MK_TOKEN to access tier-gated endpoints.",
            file=sys.stderr,
        )

    try:
        asyncio.run(run_stdio())
    except KeyboardInterrupt:  # pragma: no cover
        return 130
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
