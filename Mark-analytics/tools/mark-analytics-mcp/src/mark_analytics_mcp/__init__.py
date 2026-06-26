"""mark-analytics-mcp — MCP server exposing Mark Analytics REST API as tools.

Per spec: ``docs/aistart360/08-world-monitor-feature-parity.md`` §5 Track D.

Standalone package so it can be ``pipx install``-ed without dragging the FastAPI app.
Five read-only tools wrap the Mark Analytics public REST API; auth via ``MK_TOKEN``.
"""

__version__ = "0.1.0"
