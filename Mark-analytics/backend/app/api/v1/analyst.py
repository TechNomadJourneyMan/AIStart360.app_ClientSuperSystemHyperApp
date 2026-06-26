"""MK Analyst chat endpoint — Track A of `docs/aistart360/08-world-monitor-feature-parity.md` §5.

POST /api/v1/analyst/query
  Body  : { query: str, conversation_id?: str }
  Reply : { conversation_id, message, actions[], tool_calls[] }
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.core.deps import OptionalUserDep, SessionDep
from app.core.errors import ValidationError, envelope
from app.services.analyst import run_analyst_turn

router = APIRouter()


class AnalystQueryRequest(BaseModel):
    query: str = Field(min_length=1, max_length=2000)
    conversation_id: str | None = Field(default=None, max_length=128)


class AnalystActionResponse(BaseModel):
    type: str
    payload: dict[str, Any]


class AnalystToolCallResponse(BaseModel):
    name: str
    input: dict[str, Any]
    output_summary: str
    error: str | None = None


class AnalystQueryResponse(BaseModel):
    conversation_id: str
    message: str
    actions: list[AnalystActionResponse] = Field(default_factory=list)
    tool_calls: list[AnalystToolCallResponse] = Field(default_factory=list)


@router.post(
    "/query",
    summary="Run one MK Analyst chat turn (non-streaming v1)",
)
async def analyst_query(
    body: AnalystQueryRequest,
    session: SessionDep,
    user: OptionalUserDep = None,
) -> dict[str, Any]:
    if not body.query.strip():
        raise ValidationError("Empty query")

    user_id: UUID | None = None
    if user is not None:
        try:
            user_id = UUID(user.user_id)
        except ValueError:
            user_id = None

    turn = await run_analyst_turn(
        session,
        user_id=user_id,
        query=body.query.strip(),
        conversation_id=body.conversation_id,
    )

    payload = AnalystQueryResponse(
        conversation_id=turn.conversation_id,
        message=turn.message,
        actions=[
            AnalystActionResponse(type=a.type, payload=a.payload) for a in turn.actions
        ],
        tool_calls=[
            AnalystToolCallResponse(
                name=tc.name,
                input=tc.input,
                output_summary=tc.output_summary,
                error=tc.error,
            )
            for tc in turn.tool_calls
        ],
    )
    return envelope(data=payload.model_dump(mode="json"))
