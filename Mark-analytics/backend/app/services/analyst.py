"""MK Analyst service — Track A of `docs/aistart360/08-world-monitor-feature-parity.md` §5.

Single-turn, non-streaming chat that exposes 5 internal "tools" to an LLM:
  - search_companies
  - get_company
  - get_recent_tenders
  - industry_overview
  - region_overview

The provider-native function-calling protocols differ between Google AI Studio
and OpenRouter, so we run a *protocol-agnostic* loop: the system prompt asks
the model to emit ONE of two JSON shapes — either a tool call or a final
answer. We feed each tool result back to the model as a `tool` message and
loop up to 4 turns (cost guard).

History is kept in Redis under `analyst:conv:{id}` with TTL 24h, keeping the
last 8 turns (user+assistant pairs) so the chat stays cheap.

Quota: counts each user turn against `users.requests_used` (with cap from
`users.requests_limit`). Raises `QuotaExceededError` (HTTP 429 in v1; the
endpoint maps it to a 402-style payload).
"""

from __future__ import annotations

import json
import re
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai import ChatMessage, GenerateRequest, Task, gateway
from app.ai.prompts import render
from app.core.errors import QuotaExceededError
from app.core.logging import get_logger
from app.models.user import User

logger = get_logger(__name__)


# ────────────────────────────────────────────────────────────────────
# Public dataclasses (kept loose dicts in the wire schema; see api/v1/analyst.py)
# ────────────────────────────────────────────────────────────────────


@dataclass(slots=True)
class ToolCallRecord:
    """One executed tool call, surfaced back to the caller."""

    name: str
    input: dict[str, Any]
    output_summary: str
    error: str | None = None


@dataclass(slots=True)
class ActionRecord:
    """Frontend action chip (e.g. open_company, apply_filter)."""

    type: str
    payload: dict[str, Any]


@dataclass(slots=True)
class AnalystTurn:
    conversation_id: str
    message: str
    actions: list[ActionRecord] = field(default_factory=list)
    tool_calls: list[ToolCallRecord] = field(default_factory=list)


# ────────────────────────────────────────────────────────────────────
# Tool registry — each tool is a direct service call (NOT HTTP self-calls).
# ────────────────────────────────────────────────────────────────────


ToolFn = Callable[[AsyncSession, dict[str, Any]], Awaitable[dict[str, Any]]]


async def _tool_search_companies(
    session: AsyncSession, args: dict[str, Any]
) -> dict[str, Any]:
    """Thin wrapper over `services.companies.list_companies`."""
    from app.services.companies import list_companies

    query = (args.get("query") or "").strip() or None
    limit = int(args.get("limit") or 5)
    limit = max(1, min(limit, 10))

    filters: dict[str, Any] = {}
    industry = args.get("industry")
    if isinstance(industry, str) and industry.strip():
        # Industry can be a code ("62.01") or label — we pass via the
        # filter taxonomy if known, otherwise keep it as a free-text "q".
        filters["industry_code"] = industry.strip()
    region = args.get("region")
    if isinstance(region, str) and region.strip():
        filters["region_kato"] = region.strip()
    country = args.get("country")
    if isinstance(country, str) and country.strip():
        filters["country"] = country.strip().upper()
    size = args.get("size")
    if isinstance(size, str) and size.strip():
        filters["company_size"] = [size.strip().lower()]

    rows, _next, total = await list_companies(
        session, filters=filters, q=query, limit=limit, cursor=None,
    )
    items = [
        {
            "id": str(c.id),
            "name": c.name,
            "industry_code": c.industry_code,
            "industry_label": c.industry_label,
            "country": c.country,
            "region_kato": getattr(c, "region_kato", None),
        }
        for c in rows
    ]
    return {"total_estimate": total, "items": items}


async def _tool_get_company(
    session: AsyncSession, args: dict[str, Any]
) -> dict[str, Any]:
    """Thin wrapper over `services.companies.get_company_by_id`."""
    from app.services.companies import get_company_by_id

    raw_id = args.get("id")
    if not raw_id:
        return {"error": "missing id"}
    try:
        cid = UUID(str(raw_id))
    except ValueError:
        return {"error": "id must be a UUID"}

    company = await get_company_by_id(session, cid)
    if company is None:
        return {"error": "not_found"}
    return {
        "id": str(company.id),
        "name": company.name,
        "bin": company.bin,
        "country": company.country,
        "industry_code": company.industry_code,
        "industry_label": company.industry_label,
        "employee_count": company.employee_count,
        "revenue_usd": float(company.revenue_usd) if company.revenue_usd is not None else None,
        "status": company.status,
        "website": company.website,
    }


async def _tool_get_recent_tenders(
    session: AsyncSession, args: dict[str, Any]
) -> dict[str, Any]:
    """Pull the N most recently published tenders directly from the DB.

    Note: `api/v1/tenders` is a Phase 0 stub at the time of writing; we read
    the `tenders` table straight to give the analyst real signal without
    waiting for that endpoint to be promoted.
    """
    from app.models.tender import Tender

    limit = max(1, min(int(args.get("limit") or 5), 20))
    stmt = (
        select(
            Tender.id, Tender.title, Tender.amount_usd, Tender.currency,
            Tender.status, Tender.published_at,
        )
        .order_by(Tender.published_at.desc().nulls_last())
        .limit(limit)
    )
    rows = (await session.execute(stmt)).all()
    return {
        "items": [
            {
                "id": str(r.id),
                "title": r.title,
                "amount_usd": float(r.amount_usd) if r.amount_usd is not None else None,
                "currency": r.currency,
                "status": r.status,
                "published_at": r.published_at.isoformat() if r.published_at else None,
            }
            for r in rows
        ],
    }


async def _tool_industry_overview(
    session: AsyncSession, args: dict[str, Any]
) -> dict[str, Any]:
    """Industry KPI from `services.analytics.overview` filtered by industry_code."""
    from app.services.analytics import overview as analytics_overview

    code = args.get("industry_code")
    if not isinstance(code, str) or not code.strip():
        return {"error": "missing industry_code"}
    filters = {"industry_code": [code.strip()]}
    data = await analytics_overview(session, filters=filters)
    data["industry_code"] = code
    return data


async def _tool_region_overview(
    session: AsyncSession, args: dict[str, Any]
) -> dict[str, Any]:
    """Region KPI from `services.analytics.overview` filtered by KATO."""
    from app.services.analytics import overview as analytics_overview

    kato = args.get("kato_code")
    if not isinstance(kato, str) or not kato.strip():
        return {"error": "missing kato_code"}
    filters = {"region_kato": [kato.strip()]}
    data = await analytics_overview(session, filters=filters)
    data["kato_code"] = kato
    return data


# Tool *names* mirror Track D's MCP tools (per spec §8 — consistent naming
# across surfaces) but the bodies here are direct service calls.
TOOLS: dict[str, ToolFn] = {
    "search_companies": _tool_search_companies,
    "get_company": _tool_get_company,
    "get_recent_tenders": _tool_get_recent_tenders,
    "industry_overview": _tool_industry_overview,
    "region_overview": _tool_region_overview,
}


# ────────────────────────────────────────────────────────────────────
# Conversation history (Redis)
# ────────────────────────────────────────────────────────────────────


_CONV_PREFIX = "analyst:conv:"
_CONV_TTL_SECONDS = 60 * 60 * 24  # 24h
_HISTORY_MAX_TURNS = 8            # last 8 user/assistant pairs


async def _load_history(conversation_id: str) -> list[ChatMessage]:
    try:
        from app.ai.cache import get_redis

        r = await get_redis()
        raw = await r.get(f"{_CONV_PREFIX}{conversation_id}")
    except Exception:
        return []
    if not raw:
        return []
    try:
        payload = json.loads(raw)
    except Exception:
        return []
    out: list[ChatMessage] = []
    for item in payload[-(_HISTORY_MAX_TURNS * 2):]:
        try:
            out.append(ChatMessage(**item))
        except Exception:
            continue
    return out


async def _save_history(conversation_id: str, messages: list[ChatMessage]) -> None:
    try:
        from app.ai.cache import get_redis

        r = await get_redis()
        trimmed = messages[-(_HISTORY_MAX_TURNS * 2):]
        await r.setex(
            f"{_CONV_PREFIX}{conversation_id}",
            _CONV_TTL_SECONDS,
            json.dumps([m.model_dump() for m in trimmed], ensure_ascii=False),
        )
    except Exception as e:
        logger.warning("analyst_history_save_failed", err=str(e))


# ────────────────────────────────────────────────────────────────────
# LLM protocol — see prompt for shape contract.
# ────────────────────────────────────────────────────────────────────


_PROTOCOL_INSTRUCTIONS = """
Каждый твой ответ — это РОВНО ОДИН JSON-объект (без префикса/постфикса, без markdown-кодовых блоков).
Допустимы только две формы:

1. Вызов инструмента:
{"tool": "<имя_инструмента>", "input": { ... аргументы ... }}

2. Финальный ответ пользователю:
{"final": "<текст ответа на языке вопроса>"}

Никаких других ключей. После того как тебе вернут результат инструмента
(как сообщение role=tool), реши: вызвать ещё один инструмент или ответить final.
"""


_JSON_RE = re.compile(r"\{[\s\S]*\}", re.MULTILINE)


def _parse_llm_envelope(text: str) -> dict[str, Any] | None:
    """Extract the JSON object from the LLM response. Tolerant of stray fences."""
    text = text.strip()
    if not text:
        return None
    # Strip ```json fences if present
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        return json.loads(text)
    except Exception:
        match = _JSON_RE.search(text)
        if not match:
            return None
        try:
            return json.loads(match.group(0))
        except Exception:
            return None


def _summarize_tool_output(out: dict[str, Any]) -> str:
    """One-line human summary, surfaced to caller (and embedded in tool message)."""
    if "error" in out and out["error"]:
        return f"error: {out['error']}"
    if "items" in out and isinstance(out["items"], list):
        n = len(out["items"])
        total = out.get("total_estimate")
        if total is not None:
            return f"{n} item(s) (total≈{total})"
        return f"{n} item(s)"
    if "total_companies" in out:
        return f"total_companies={out['total_companies']}"
    if "name" in out:
        return f"company: {out.get('name')}"
    return "ok"


# ────────────────────────────────────────────────────────────────────
# Quota (requests_used / requests_limit on the users row)
# ────────────────────────────────────────────────────────────────────


async def _check_and_increment_quota(session: AsyncSession, user_id: UUID) -> None:
    """Atomic-ish increment on `users.requests_used`. Raises if over cap."""
    row = (await session.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if row is None:
        # Nothing to bill against (anonymous / unprovisioned). Allow.
        return
    if row.requests_limit and row.requests_used >= row.requests_limit:
        raise QuotaExceededError(
            f"Monthly request limit ({row.requests_limit}) reached.",
            kind="analyst",
            used=row.requests_used,
            limit=row.requests_limit,
            tier=row.plan,
        )
    await session.execute(
        update(User).where(User.id == user_id).values(requests_used=User.requests_used + 1)
    )
    await session.commit()


# ────────────────────────────────────────────────────────────────────
# Actions — derived from the tool calls the LLM made this turn.
# ────────────────────────────────────────────────────────────────────


def _build_actions(tool_calls: list[ToolCallRecord]) -> list[ActionRecord]:
    """Derive frontend action chips from the tool calls executed this turn.

    Heuristics:
      - `get_company` → open_company chip with the requested id (if present)
        and the result's first id.
      - `search_companies` → open_company chip for the top hit + apply_filter
        chip with the search filters the LLM passed.
      - `industry_overview` → apply_filter for industry_code.
      - `region_overview` → apply_filter for region_kato.
    """
    actions: list[ActionRecord] = []
    seen_company_ids: set[str] = set()

    for tc in tool_calls:
        if tc.error:
            continue
        if tc.name == "get_company":
            cid = tc.input.get("id")
            if isinstance(cid, str) and cid not in seen_company_ids:
                actions.append(ActionRecord("open_company", {"id": cid}))
                seen_company_ids.add(cid)
        elif tc.name == "search_companies":
            filters: dict[str, Any] = {}
            for k in ("industry", "region", "country", "size", "query"):
                v = tc.input.get(k)
                if v is not None and v != "":
                    filters[k] = v
            if filters:
                actions.append(ActionRecord("apply_filter", {"filters": filters}))
        elif tc.name == "industry_overview":
            code = tc.input.get("industry_code")
            if isinstance(code, str) and code:
                actions.append(ActionRecord(
                    "apply_filter", {"filters": {"industry_code": code}},
                ))
        elif tc.name == "region_overview":
            kato = tc.input.get("kato_code")
            if isinstance(kato, str) and kato:
                actions.append(ActionRecord(
                    "apply_filter", {"filters": {"region_kato": kato}},
                ))

    return actions[:6]  # hard cap


# ────────────────────────────────────────────────────────────────────
# Public entry point
# ────────────────────────────────────────────────────────────────────


MAX_TOOL_CALLS_PER_TURN = 4


async def run_analyst_turn(
    session: AsyncSession,
    *,
    user_id: UUID | None,
    query: str,
    conversation_id: str | None = None,
    request_id: str | None = None,
) -> AnalystTurn:
    """Run one MK Analyst turn end-to-end.

    Args:
      session: DB session (for tool calls).
      user_id: authenticated user (for quota). None = anonymous (no quota).
      query: the user's natural-language question.
      conversation_id: opaque id from the client; created if missing.
      request_id: forwarded to the AI gateway for telemetry tracing.
    """
    conv_id = conversation_id or str(uuid.uuid4())
    if user_id is not None:
        await _check_and_increment_quota(session, user_id)

    history = await _load_history(conv_id)

    system_prompt = render("analyst_system") + "\n\n" + _PROTOCOL_INSTRUCTIONS
    messages: list[ChatMessage] = [ChatMessage(role="system", content=system_prompt)]
    messages.extend(history)
    messages.append(ChatMessage(role="user", content=query))

    tool_calls: list[ToolCallRecord] = []
    final_text: str | None = None

    for _step in range(MAX_TOOL_CALLS_PER_TURN + 1):
        req = GenerateRequest(
            task=Task.EXTRACT_QUERY_FILTERS,  # cheap Flash-8b route
            messages=messages,
            temperature=0.1,
            max_tokens=600,
            agent="mk_analyst",
            request_id=request_id,
        )
        resp = await gateway.generate(req)
        envelope = _parse_llm_envelope(resp.text)

        if envelope is None:
            # The model returned freeform text — surface as final.
            final_text = resp.text.strip() or "—"
            break

        if "final" in envelope:
            final_text = str(envelope.get("final") or "").strip() or "—"
            messages.append(ChatMessage(role="assistant", content=final_text))
            break

        tool_name = envelope.get("tool")
        tool_input = envelope.get("input") or {}
        if not isinstance(tool_name, str) or tool_name not in TOOLS:
            final_text = f"Не понял инструмент `{tool_name}`."
            break
        if not isinstance(tool_input, dict):
            tool_input = {}

        if len(tool_calls) >= MAX_TOOL_CALLS_PER_TURN:
            # We've already executed the cap; force a final by re-prompting.
            messages.append(ChatMessage(
                role="assistant",
                content=json.dumps({"tool": tool_name, "input": tool_input}),
            ))
            messages.append(ChatMessage(
                role="tool",
                name=tool_name,
                content="error: tool budget exhausted, respond with `final`.",
            ))
            continue

        try:
            output = await TOOLS[tool_name](session, tool_input)
            err = None
        except Exception as e:  # noqa: BLE001
            output = {"error": str(e)}
            err = str(e)
            logger.warning("analyst_tool_failed", tool=tool_name, err=str(e))

        summary = _summarize_tool_output(output)
        tool_calls.append(ToolCallRecord(
            name=tool_name, input=tool_input, output_summary=summary, error=err,
        ))

        # Echo the assistant's tool-call back into the convo so the next
        # gateway call sees a coherent (assistant→tool) chain.
        messages.append(ChatMessage(
            role="assistant",
            content=json.dumps({"tool": tool_name, "input": tool_input}, ensure_ascii=False),
        ))
        messages.append(ChatMessage(
            role="tool",
            name=tool_name,
            content=json.dumps(output, ensure_ascii=False, default=str),
        ))

    if final_text is None:
        final_text = "Не удалось сформировать ответ. Попробуйте переформулировать."

    # Persist the human-visible turn only (user + final assistant), not the
    # intermediate tool noise — keeps tokens cheap on the next turn.
    new_history: list[ChatMessage] = [*history,
        ChatMessage(role="user", content=query),
        ChatMessage(role="assistant", content=final_text),
    ]
    await _save_history(conv_id, new_history)

    actions = _build_actions(tool_calls)

    logger.info(
        "analyst_turn_complete",
        conversation_id=conv_id,
        tool_calls=len(tool_calls),
        actions=len(actions),
        at=datetime.now(timezone.utc).isoformat(),
    )

    return AnalystTurn(
        conversation_id=conv_id,
        message=final_text,
        actions=actions,
        tool_calls=tool_calls,
    )
