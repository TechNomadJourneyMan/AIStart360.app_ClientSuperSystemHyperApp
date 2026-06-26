"""Server-rendered web dashboard. Single-page, vanilla JS, talks to /api/v1/*.

Not the production frontend (that lives on Vercel) — this is a demo / dev UI
so the backend is testable in a browser without spinning up the Next.js app.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

TEMPLATES_DIR = Path(__file__).parent / "templates"
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))

router = APIRouter()


@router.get("/", response_class=HTMLResponse, include_in_schema=False)
async def dashboard(request: Request) -> HTMLResponse:
    return templates.TemplateResponse(request, "dashboard.html", {})


@router.get("/dashboard", response_class=HTMLResponse, include_in_schema=False)
async def dashboard_alias(request: Request) -> HTMLResponse:
    return templates.TemplateResponse(request, "dashboard.html", {})
