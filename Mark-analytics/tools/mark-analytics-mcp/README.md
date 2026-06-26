# mark-analytics-mcp

A small [Model Context Protocol](https://modelcontextprotocol.io) server that
exposes the **Mark Analytics** REST API as five read-only tools to any
MCP-compatible AI client (Claude Desktop, Cursor, Codex, custom Anthropic /
OpenAI agents, etc.).

> Spec source: `docs/aistart360/08-world-monitor-feature-parity.md` §5 Track D.
>
> This is a **standalone** Python package — it is NOT part of the Mark Analytics
> FastAPI backend. It is a thin client that calls the public REST API on the
> user's behalf using their own API token.

## What it does

The server registers five tools. Their names match the spec exactly:

| Tool | Backing endpoint | Purpose |
|------|------------------|---------|
| `search_companies` | `GET /api/v1/companies` | Free-text + facet search across KZ companies |
| `get_company` | `GET /api/v1/companies/{id}` (or `?bin=`) | Fetch one company by UUID or 12-digit BIN |
| `get_recent_tenders` | `GET /api/v1/tenders/recent` | Recently published public-procurement tenders |
| `industry_overview` | `GET /api/v1/analytics/industries/{code}` | Aggregate stats for an OKED industry |
| `region_overview` | `GET /api/v1/regions/{kato}` | Aggregate stats for a KATO region |

All tools are read-only. Tool errors come back as structured
`{error, status_code, hint}` envelopes — they never raise — so MCP clients can
render them nicely to the user.

### Degraded endpoints (today)

Some backing endpoints are still in Phase 0 / Phase 1 of the platform roadmap.
The tools degrade gracefully rather than failing:

| Tool | Degraded condition | Returned envelope |
|------|--------------------|-------------------|
| `get_recent_tenders` | `/api/v1/tenders/recent` is a Phase 0 stub returning `[]` | `{degraded: true, reason: "...Phase 0 stub..."}` |
| `industry_overview` | `/api/v1/analytics/industries/{code}` 404s; we fall back to `/analytics/industry-distribution` | `{degraded: true, summary: {...}, reason: "...fallback..."}` |
| `region_overview` | `/api/v1/regions/{kato}` 404s; we fall back to `/geo/companies/cluster-stats` | `{degraded: true, ...}` |

`search_companies` and `get_company` hit endpoints that are live today and have
no documented degraded path.

## Install

The package is not on PyPI yet. Once published:

```bash
pipx install mark-analytics-mcp
```

For local development from this repo:

```bash
cd tools/mark-analytics-mcp
pip install -e ".[dev]"
```

After install, `mark-analytics-mcp` is on `$PATH`. Run it manually:

```bash
MK_TOKEN=your-token mark-analytics-mcp --transport stdio
```

(`--transport stdio` is the default; HTTP is planned but not implemented.)

## Configuration

Two environment variables:

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `MK_BASE_URL` | no | `https://api.mark-analytics.kz` | Override for staging / self-hosted instances |
| `MK_TOKEN` | optional | _unset_ | Bearer token. Optional for public reads; required for tier-gated endpoints |

When `MK_TOKEN` is set, every outgoing request includes
`Authorization: Bearer ${MK_TOKEN}`. Calls count against your existing API
quota (`users.requests_used`) — there is no separate MCP rate limit.

## Claude Desktop

Add an entry to your Claude Desktop config. On macOS the file is at
`~/Library/Application Support/Claude/claude_desktop_config.json`; on Windows
it lives under `%APPDATA%\Claude\claude_desktop_config.json`.

```json
{
  "mcpServers": {
    "mark-analytics": {
      "command": "mark-analytics-mcp",
      "args": ["--transport", "stdio"],
      "env": {
        "MK_TOKEN": "sk_live_your_token_here",
        "MK_BASE_URL": "https://api.mark-analytics.kz"
      }
    }
  }
}
```

Restart Claude Desktop. You should see the five tools listed under the
hammer / tools icon. Try:

> Find me five IT companies in Almaty with more than 50 employees, then show
> me the profile of the largest one.

## Cursor

Cursor follows the same shape under **Settings → MCP**:

```json
{
  "mcpServers": {
    "mark-analytics": {
      "command": "mark-analytics-mcp",
      "args": ["--transport", "stdio"],
      "env": { "MK_TOKEN": "sk_live_..." }
    }
  }
}
```

## Codex / generic Anthropic agent

Any client that supports stdio MCP can use the same `command` + `args` shape.
If your client expects an absolute path to the binary, run `which mark-analytics-mcp`
after `pipx install` to find it.

## Tests

```bash
cd tools/mark-analytics-mcp
pytest
ruff check .
```

The test suite mocks `httpx` via `respx` — no network calls and no live API
required. There is one happy-path and one error-path test per tool, plus a
smoke test that the MCP server registers all five tools.

## License

Proprietary. Internal Mark Analytics use. The MCP protocol it implements is an
open spec from Anthropic; the protocol itself is unencumbered.
