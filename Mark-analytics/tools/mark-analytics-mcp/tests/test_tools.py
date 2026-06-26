"""Tool-level tests — one happy path + one error path per tool.

Also includes the MCP server smoke test (all 5 tools registered).
"""

from __future__ import annotations

import httpx
import pytest
import respx

from mark_analytics_mcp.client import MarkClient
from mark_analytics_mcp.server import build_server
from mark_analytics_mcp.tools import (
    get_company,
    industry_overview,
    recent_tenders,
    region_overview,
    search_companies,
    tool_names,
)

# ----------------------------------------------------------------------------
# search_companies
# ----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_search_companies_happy_path(client: MarkClient, mock_router: respx.Router) -> None:
    mock_router.get("/api/v1/companies").mock(
        return_value=httpx.Response(
            200,
            json={
                "items": [
                    {
                        "id": "11111111-1111-4111-8111-111111111111",
                        "name": "Kaspi.kz",
                        "bin": "100340004654",
                        "industry": "64",
                        "region": "750000000",
                    },
                ],
                "total": 1,
            },
        )
    )

    result = await search_companies.run(
        client,
        {"query": "kaspi", "region": "almaty", "limit": 5},
    )

    assert "error" not in result
    assert result["total"] == 1
    assert result["limit"] == 5
    assert result["items"][0]["name"] == "Kaspi.kz"


@pytest.mark.asyncio
async def test_search_companies_unauthorized(
    client: MarkClient, mock_router: respx.Router
) -> None:
    mock_router.get("/api/v1/companies").mock(
        return_value=httpx.Response(401, json={"detail": "missing token"})
    )

    result = await search_companies.run(client, {"query": "anything"})

    assert result["status_code"] == 401
    assert "Unauthorized" in result["error"]
    assert result["hint"]


@pytest.mark.asyncio
async def test_search_companies_invalid_args(client: MarkClient) -> None:
    # `query` is required; passing only an invalid limit should fail validation
    # before any HTTP call is attempted.
    result = await search_companies.run(client, {"limit": 9999})
    assert result["status_code"] == 422


# ----------------------------------------------------------------------------
# get_company
# ----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_company_by_uuid_happy(
    client: MarkClient, mock_router: respx.Router
) -> None:
    uuid = "11111111-1111-4111-8111-111111111111"
    mock_router.get(f"/api/v1/companies/{uuid}").mock(
        return_value=httpx.Response(
            200,
            json={"id": uuid, "name": "Test KZ LLP", "bin": "123456789012"},
        )
    )

    result = await get_company.run(client, {"id_or_bin": uuid})

    assert result["id"] == uuid
    assert result["name"] == "Test KZ LLP"


@pytest.mark.asyncio
async def test_get_company_by_bin_fallback(
    client: MarkClient, mock_router: respx.Router
) -> None:
    bin_value = "123456789012"
    mock_router.get("/api/v1/companies").mock(
        return_value=httpx.Response(
            200,
            json={"items": [{"id": "abc", "name": "Found by BIN", "bin": bin_value}]},
        )
    )

    result = await get_company.run(client, {"id_or_bin": bin_value})

    assert result["name"] == "Found by BIN"


@pytest.mark.asyncio
async def test_get_company_not_found(client: MarkClient, mock_router: respx.Router) -> None:
    bin_value = "999999999999"
    mock_router.get("/api/v1/companies").mock(
        return_value=httpx.Response(200, json={"items": []})
    )

    result = await get_company.run(client, {"id_or_bin": bin_value})

    assert result["status_code"] == 404
    assert "not found" in result["error"].lower()


# ----------------------------------------------------------------------------
# get_recent_tenders
# ----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_recent_tenders_happy(client: MarkClient, mock_router: respx.Router) -> None:
    mock_router.get("/api/v1/tenders/recent").mock(
        return_value=httpx.Response(
            200,
            json={
                "items": [
                    {"id": "t1", "title": "Server procurement", "amount_kzt": 5_000_000},
                ]
            },
        )
    )

    result = await recent_tenders.run(client, {"industry": "62", "limit": 5})

    assert result.get("degraded") is not True
    assert result["items"][0]["id"] == "t1"


@pytest.mark.asyncio
async def test_recent_tenders_degraded_empty(
    client: MarkClient, mock_router: respx.Router
) -> None:
    mock_router.get("/api/v1/tenders/recent").mock(
        return_value=httpx.Response(200, json={"items": []})
    )

    result = await recent_tenders.run(client, {"limit": 5})

    assert result["degraded"] is True
    assert "stub" in result["reason"].lower()


@pytest.mark.asyncio
async def test_recent_tenders_server_error(
    client: MarkClient, mock_router: respx.Router
) -> None:
    mock_router.get("/api/v1/tenders/recent").mock(
        return_value=httpx.Response(503, json={"detail": "upstream"})
    )

    result = await recent_tenders.run(client, {})

    assert result["status_code"] == 503


# ----------------------------------------------------------------------------
# industry_overview
# ----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_industry_overview_happy(
    client: MarkClient, mock_router: respx.Router
) -> None:
    mock_router.get("/api/v1/analytics/industries/62").mock(
        return_value=httpx.Response(
            200,
            json={
                "industry_code": "62",
                "company_count": 3214,
                "median_headcount": 12,
            },
        )
    )

    result = await industry_overview.run(client, {"industry_code": "62"})

    assert result["industry_code"] == "62"
    assert result["company_count"] == 3214
    assert result.get("degraded") is not True


@pytest.mark.asyncio
async def test_industry_overview_fallback(
    client: MarkClient, mock_router: respx.Router
) -> None:
    # Primary endpoint missing → fallback to distribution.
    mock_router.get("/api/v1/analytics/industries/62").mock(
        return_value=httpx.Response(404, json={"detail": "not found"})
    )
    mock_router.get("/api/v1/analytics/industry-distribution").mock(
        return_value=httpx.Response(
            200,
            json={
                "items": [
                    {"code": "62", "name": "IT services", "company_count": 3000},
                    {"code": "10", "name": "Food", "company_count": 1500},
                ]
            },
        )
    )

    result = await industry_overview.run(client, {"industry_code": "62"})

    assert result["industry_code"] == "62"
    assert result["degraded"] is True
    assert result["summary"]["company_count"] == 3000


@pytest.mark.asyncio
async def test_industry_overview_error(
    client: MarkClient, mock_router: respx.Router
) -> None:
    mock_router.get("/api/v1/analytics/industries/62").mock(
        return_value=httpx.Response(500, json={"detail": "boom"})
    )

    result = await industry_overview.run(client, {"industry_code": "62"})

    assert result["status_code"] == 500


# ----------------------------------------------------------------------------
# region_overview
# ----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_region_overview_happy(
    client: MarkClient, mock_router: respx.Router
) -> None:
    mock_router.get("/api/v1/regions/750000000").mock(
        return_value=httpx.Response(
            200,
            json={
                "kato_code": "750000000",
                "name": "Almaty",
                "company_count": 50000,
            },
        )
    )

    result = await region_overview.run(client, {"kato_code": "750000000"})

    assert result["kato_code"] == "750000000"
    assert result["company_count"] == 50000


@pytest.mark.asyncio
async def test_region_overview_degraded(
    client: MarkClient, mock_router: respx.Router
) -> None:
    mock_router.get("/api/v1/regions/750000000").mock(
        return_value=httpx.Response(404, json={"detail": "not found"})
    )
    mock_router.get("/api/v1/geo/companies/cluster-stats").mock(
        return_value=httpx.Response(404, json={"detail": "not found"})
    )

    result = await region_overview.run(client, {"kato_code": "750000000"})

    assert result["degraded"] is True
    assert result["kato_code"] == "750000000"


# ----------------------------------------------------------------------------
# Smoke test: MCP server registers all five tools
# ----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_server_registers_all_tools(client: MarkClient) -> None:
    server, _ = build_server(client=client)

    # Validate the static registry first — cheap and gives a clear failure.
    expected = {
        "search_companies",
        "get_company",
        "get_recent_tenders",
        "industry_overview",
        "region_overview",
    }
    assert set(tool_names()) == expected

    # And confirm the Server has a list_tools handler wired up.
    from mcp import types  # imported here to keep the top tidy

    assert types.ListToolsRequest in server.request_handlers
    assert types.CallToolRequest in server.request_handlers
