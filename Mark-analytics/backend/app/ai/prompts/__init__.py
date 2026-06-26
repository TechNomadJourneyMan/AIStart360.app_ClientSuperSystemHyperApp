"""Prompt template loader. Templates are plain Jinja2 (.j2) files in this package.

Usage:
    from app.ai.prompts import render
    text = render("extract_company", html=html, source="kompra")
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader, StrictUndefined, select_autoescape


@lru_cache(maxsize=1)
def _env() -> Environment:
    return Environment(
        loader=FileSystemLoader(str(Path(__file__).parent)),
        undefined=StrictUndefined,
        autoescape=select_autoescape(default=False),
        trim_blocks=True,
        lstrip_blocks=True,
    )


def render(template: str, **vars: Any) -> str:
    """Render template `<template>.j2` with the given vars. Raises if any var is missing."""
    tpl = _env().get_template(f"{template}.j2")
    return tpl.render(**vars)


def list_templates() -> list[str]:
    return [p.stem for p in Path(__file__).parent.glob("*.j2")]
