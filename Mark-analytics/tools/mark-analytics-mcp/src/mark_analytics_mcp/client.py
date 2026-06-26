"""Thin async httpx wrapper over the Mark Analytics REST API.

Reads:
  - ``MK_TOKEN`` — optional bearer token (required for write, optional for public read).
  - ``MK_BASE_URL`` — defaults to ``https://api.mark-analytics.kz``.

All tools share a single :class:`MarkClient` instance per server process.
Errors are returned as structured dicts so MCP clients can render them; we never
raise from tool entry points (see ``tools/*``).
"""

from __future__ import annotations

import os
from typing import Any

import httpx

DEFAULT_BASE_URL = "https://api.mark-analytics.kz"
DEFAULT_TIMEOUT_S = 15.0


class MarkClientError(Exception):
    """Raised internally; tools translate this into a structured error envelope."""

    def __init__(self, status_code: int, message: str, hint: str | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.message = message
        self.hint = hint


class MarkClient:
    """Minimal async HTTP client for the Mark Analytics public REST API.

    Construct once at server startup. Pass the same instance to every tool.
    """

    def __init__(
        self,
        base_url: str | None = None,
        token: str | None = None,
        timeout: float = DEFAULT_TIMEOUT_S,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.base_url = (base_url or os.environ.get("MK_BASE_URL") or DEFAULT_BASE_URL).rstrip("/")
        self.token = token if token is not None else os.environ.get("MK_TOKEN")
        headers = {
            "Accept": "application/json",
            "User-Agent": "mark-analytics-mcp/0.1.0",
        }
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        self._client = httpx.AsyncClient(
            base_url=self.base_url,
            headers=headers,
            timeout=timeout,
            transport=transport,
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def get(
        self,
        path: str,
        params: dict[str, Any] | None = None,
    ) -> dict[str, Any] | list[Any]:
        """GET a path and parse JSON. Raises :class:`MarkClientError` on non-2xx.

        ``params`` keys with ``None`` values are dropped (httpx would otherwise
        emit ``key=`` which our backend treats as a literal empty string).
        """
        clean_params: dict[str, Any] | None
        if params is None:
            clean_params = None
        else:
            clean_params = {k: v for k, v in params.items() if v is not None}

        try:
            response = await self._client.get(path, params=clean_params)
        except httpx.RequestError as exc:
            raise MarkClientError(
                status_code=0,
                message=f"Network error talking to {self.base_url}{path}: {exc!s}",
                hint="Check MK_BASE_URL and your network connectivity.",
            ) from exc

        if response.status_code == 401:
            raise MarkClientError(
                status_code=401,
                message="Unauthorized.",
                hint="Set MK_TOKEN to a valid Mark Analytics API token.",
            )
        if response.status_code == 403:
            raise MarkClientError(
                status_code=403,
                message="Forbidden — your plan does not include this endpoint.",
                hint="Upgrade to the Pro tier or contact support@mark-analytics.kz.",
            )
        if response.status_code == 404:
            raise MarkClientError(
                status_code=404,
                message=f"Not found: {path}",
                hint="Check the id/code you passed.",
            )
        if response.status_code >= 500:
            raise MarkClientError(
                status_code=response.status_code,
                message=f"Upstream error {response.status_code} from Mark Analytics.",
                hint="Try again later; if it persists, file a ticket.",
            )
        if response.status_code >= 400:
            # Try to surface the server's error payload.
            try:
                payload = response.json()
                detail = payload.get("detail") or payload.get("error") or str(payload)
            except ValueError:
                detail = response.text[:200]
            raise MarkClientError(
                status_code=response.status_code,
                message=f"Request failed: {detail}",
                hint=None,
            )

        try:
            return response.json()
        except ValueError as exc:
            raise MarkClientError(
                status_code=response.status_code,
                message="Response was not valid JSON.",
                hint="This is a server-side bug; please report it.",
            ) from exc
