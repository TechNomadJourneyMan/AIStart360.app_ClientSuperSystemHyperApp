"""Saved Companies lists endpoints (Track F).

Mounted under `/api/v1/lists`. All endpoints are JWT-protected — lists are
strictly per-user; sharing is out of scope for this phase.
"""

from __future__ import annotations

import csv
import io
from typing import Any
from uuid import UUID

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.core.deps import CurrentUserDep, SessionDep
from app.core.errors import envelope
from app.schemas.envelope import ResponseEnvelope
from app.schemas.saved_list import (
    SavedListCreate,
    SavedListDetail,
    SavedListItemCreate,
    SavedListItemOut,
    SavedListItemPatch,
    SavedListRename,
    SavedListSummary,
)
from app.services.saved_lists import (
    add_item,
    create_list,
    delete_list,
    get_list,
    list_for_user,
    remove_item,
    rename_list,
    update_item_note,
)

router = APIRouter()


def _user_uuid(user: CurrentUserDep) -> UUID:
    return UUID(user.user_id)


def _summary(obj: Any, item_count: int) -> SavedListSummary:
    return SavedListSummary(
        id=obj.id,
        name=obj.name,
        item_count=item_count,
        created_at=obj.created_at,
        updated_at=obj.updated_at,
    )


def _item_out(item: Any) -> SavedListItemOut:
    company = getattr(item, "company", None)
    return SavedListItemOut(
        company_id=item.company_id,
        company_name=getattr(company, "name", None),
        company_country=getattr(company, "country", None),
        industry_code=getattr(company, "industry_code", None),
        industry_label=getattr(company, "industry_label", None),
        added_at=item.added_at,
        note=item.note,
    )


def _detail(obj: Any) -> SavedListDetail:
    items = [_item_out(it) for it in obj.items]
    return SavedListDetail(
        id=obj.id,
        name=obj.name,
        item_count=len(items),
        created_at=obj.created_at,
        updated_at=obj.updated_at,
        items=items,
    )


@router.post(
    "",
    summary="Create a new saved list",
    response_model=ResponseEnvelope[SavedListSummary],
    status_code=201,
)
async def create(
    payload: SavedListCreate,
    session: SessionDep,
    user: CurrentUserDep,
) -> dict[str, Any]:
    obj = await create_list(session, user_id=_user_uuid(user), name=payload.name)
    return envelope(data=_summary(obj, 0).model_dump(mode="json"))


@router.get(
    "",
    summary="List saved lists owned by the current user",
    response_model=ResponseEnvelope[list[SavedListSummary]],
)
async def index(session: SessionDep, user: CurrentUserDep) -> dict[str, Any]:
    rows = await list_for_user(session, user_id=_user_uuid(user))
    data = [_summary(obj, count).model_dump(mode="json") for obj, count in rows]
    return envelope(data=data, meta={"count": len(data)})


@router.get(
    "/{list_id}",
    summary="Get a saved list with its items",
    response_model=ResponseEnvelope[SavedListDetail],
)
async def detail(
    list_id: UUID, session: SessionDep, user: CurrentUserDep
) -> dict[str, Any]:
    obj = await get_list(session, list_id=list_id, user_id=_user_uuid(user))
    return envelope(data=_detail(obj).model_dump(mode="json"))


@router.patch(
    "/{list_id}",
    summary="Rename a saved list",
    response_model=ResponseEnvelope[SavedListSummary],
)
async def rename(
    list_id: UUID,
    payload: SavedListRename,
    session: SessionDep,
    user: CurrentUserDep,
) -> dict[str, Any]:
    obj = await rename_list(
        session, list_id=list_id, user_id=_user_uuid(user), name=payload.name
    )
    count = len(obj.items) if "items" in obj.__dict__ else 0
    return envelope(data=_summary(obj, count).model_dump(mode="json"))


@router.delete(
    "/{list_id}",
    summary="Delete a saved list",
    response_model=ResponseEnvelope[dict[str, str]],
)
async def remove(
    list_id: UUID, session: SessionDep, user: CurrentUserDep
) -> dict[str, Any]:
    await delete_list(session, list_id=list_id, user_id=_user_uuid(user))
    return envelope(data={"status": "deleted", "id": str(list_id)})


@router.post(
    "/{list_id}/items",
    summary="Add a company to a saved list",
    response_model=ResponseEnvelope[SavedListItemOut],
    status_code=201,
)
async def add(
    list_id: UUID,
    payload: SavedListItemCreate,
    session: SessionDep,
    user: CurrentUserDep,
) -> dict[str, Any]:
    item = await add_item(
        session,
        list_id=list_id,
        user_id=_user_uuid(user),
        company_id=payload.company_id,
        note=payload.note,
    )
    # Re-fetch the list to get the company name for the response payload.
    obj = await get_list(session, list_id=list_id, user_id=_user_uuid(user))
    fresh = next(
        (it for it in obj.items if it.company_id == item.company_id), item
    )
    return envelope(data=_item_out(fresh).model_dump(mode="json"))


@router.patch(
    "/{list_id}/items/{company_id}",
    summary="Update the note on a saved-list item",
    response_model=ResponseEnvelope[SavedListItemOut],
)
async def patch_item(
    list_id: UUID,
    company_id: UUID,
    payload: SavedListItemPatch,
    session: SessionDep,
    user: CurrentUserDep,
) -> dict[str, Any]:
    await update_item_note(
        session,
        list_id=list_id,
        user_id=_user_uuid(user),
        company_id=company_id,
        note=payload.note,
    )
    obj = await get_list(session, list_id=list_id, user_id=_user_uuid(user))
    fresh = next(it for it in obj.items if it.company_id == company_id)
    return envelope(data=_item_out(fresh).model_dump(mode="json"))


@router.delete(
    "/{list_id}/items/{company_id}",
    summary="Remove a company from a saved list",
    response_model=ResponseEnvelope[dict[str, str]],
)
async def remove_item_route(
    list_id: UUID,
    company_id: UUID,
    session: SessionDep,
    user: CurrentUserDep,
) -> dict[str, Any]:
    await remove_item(
        session,
        list_id=list_id,
        user_id=_user_uuid(user),
        company_id=company_id,
    )
    return envelope(
        data={"status": "removed", "list_id": str(list_id), "company_id": str(company_id)}
    )


@router.get(
    "/{list_id}/export.csv",
    summary="Download a saved list as CSV",
)
async def export_csv(
    list_id: UUID,
    session: SessionDep,
    user: CurrentUserDep,
) -> StreamingResponse:
    obj = await get_list(session, list_id=list_id, user_id=_user_uuid(user))

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(
        [
            "company_id",
            "name",
            "country",
            "industry_code",
            "industry_label",
            "added_at",
            "note",
        ]
    )
    for it in obj.items:
        company = it.company
        writer.writerow(
            [
                str(it.company_id),
                getattr(company, "name", "") or "",
                getattr(company, "country", "") or "",
                getattr(company, "industry_code", "") or "",
                getattr(company, "industry_label", "") or "",
                it.added_at.isoformat() if it.added_at else "",
                (it.note or "").replace("\n", " "),
            ]
        )

    safe_name = "".join(ch for ch in obj.name if ch.isalnum() or ch in "-_") or "list"
    headers = {
        "Content-Disposition": f'attachment; filename="{safe_name}-{obj.id}.csv"'
    }
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers=headers,
    )
