"""Service layer for user-owned Saved Companies lists (Track F).

All functions are pure-async, expect an `AsyncSession` as the first arg, and
raise `NotFoundError` / `ForbiddenError` / `ValidationError` for the router to
serialize. Business logic lives here — routers stay thin.
"""

from __future__ import annotations

from collections.abc import Sequence
from uuid import UUID

from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.errors import ForbiddenError, NotFoundError, ValidationError
from app.models.company import Company
from app.models.saved_list import SavedList, SavedListItem


async def create_list(session: AsyncSession, *, user_id: UUID, name: str) -> SavedList:
    name = name.strip()
    if not name:
        raise ValidationError("List name cannot be empty", code="LIST_NAME_REQUIRED")
    obj = SavedList(user_id=user_id, name=name)
    session.add(obj)
    try:
        await session.commit()
    except IntegrityError as e:
        await session.rollback()
        raise ValidationError(
            f"You already have a list named '{name}'",
            code="LIST_NAME_DUPLICATE",
        ) from e
    await session.refresh(obj)
    return obj


async def list_for_user(
    session: AsyncSession, *, user_id: UUID
) -> list[tuple[SavedList, int]]:
    """Return all lists owned by `user_id` along with their item counts."""
    stmt = (
        select(
            SavedList,
            func.count(SavedListItem.company_id).label("item_count"),
        )
        .outerjoin(SavedListItem, SavedListItem.list_id == SavedList.id)
        .where(SavedList.user_id == user_id)
        .group_by(SavedList.id)
        .order_by(SavedList.created_at.desc())
    )
    result = await session.execute(stmt)
    return [(row[0], int(row[1])) for row in result.all()]


async def _get_owned(
    session: AsyncSession, *, list_id: UUID, user_id: UUID, eager_items: bool = False
) -> SavedList:
    stmt = select(SavedList).where(SavedList.id == list_id)
    if eager_items:
        stmt = stmt.options(
            selectinload(SavedList.items).selectinload(SavedListItem.company)
        )
    obj = (await session.execute(stmt)).scalar_one_or_none()
    if obj is None:
        raise NotFoundError(f"List {list_id} not found", code="LIST_NOT_FOUND")
    if obj.user_id != user_id:
        raise ForbiddenError(
            "You do not own this list", code="LIST_NOT_OWNED"
        )
    return obj


async def get_list(
    session: AsyncSession, *, list_id: UUID, user_id: UUID
) -> SavedList:
    """Detail view (with eager-loaded items + companies). Raises if not owned."""
    return await _get_owned(session, list_id=list_id, user_id=user_id, eager_items=True)


async def rename_list(
    session: AsyncSession, *, list_id: UUID, user_id: UUID, name: str
) -> SavedList:
    obj = await _get_owned(session, list_id=list_id, user_id=user_id)
    name = name.strip()
    if not name:
        raise ValidationError("List name cannot be empty", code="LIST_NAME_REQUIRED")
    obj.name = name
    try:
        await session.commit()
    except IntegrityError as e:
        await session.rollback()
        raise ValidationError(
            f"You already have a list named '{name}'",
            code="LIST_NAME_DUPLICATE",
        ) from e
    await session.refresh(obj)
    return obj


async def delete_list(
    session: AsyncSession, *, list_id: UUID, user_id: UUID
) -> None:
    obj = await _get_owned(session, list_id=list_id, user_id=user_id)
    await session.delete(obj)
    await session.commit()


async def add_item(
    session: AsyncSession,
    *,
    list_id: UUID,
    user_id: UUID,
    company_id: UUID,
    note: str | None = None,
) -> SavedListItem:
    await _get_owned(session, list_id=list_id, user_id=user_id)

    company = (
        await session.execute(select(Company.id).where(Company.id == company_id))
    ).scalar_one_or_none()
    if company is None:
        raise NotFoundError(
            f"Company {company_id} not found", code="COMPANY_NOT_FOUND"
        )

    existing = (
        await session.execute(
            select(SavedListItem).where(
                SavedListItem.list_id == list_id,
                SavedListItem.company_id == company_id,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        if note is not None:
            existing.note = note
            await session.commit()
            await session.refresh(existing)
        return existing

    item = SavedListItem(list_id=list_id, company_id=company_id, note=note)
    session.add(item)
    await session.commit()
    await session.refresh(item)
    return item


async def remove_item(
    session: AsyncSession,
    *,
    list_id: UUID,
    user_id: UUID,
    company_id: UUID,
) -> None:
    await _get_owned(session, list_id=list_id, user_id=user_id)
    result = await session.execute(
        delete(SavedListItem).where(
            SavedListItem.list_id == list_id,
            SavedListItem.company_id == company_id,
        )
    )
    if result.rowcount == 0:
        raise NotFoundError(
            f"Company {company_id} is not in list {list_id}",
            code="LIST_ITEM_NOT_FOUND",
        )
    await session.commit()


async def update_item_note(
    session: AsyncSession,
    *,
    list_id: UUID,
    user_id: UUID,
    company_id: UUID,
    note: str | None,
) -> SavedListItem:
    await _get_owned(session, list_id=list_id, user_id=user_id)
    item = (
        await session.execute(
            select(SavedListItem).where(
                SavedListItem.list_id == list_id,
                SavedListItem.company_id == company_id,
            )
        )
    ).scalar_one_or_none()
    if item is None:
        raise NotFoundError(
            f"Company {company_id} is not in list {list_id}",
            code="LIST_ITEM_NOT_FOUND",
        )
    item.note = note
    await session.commit()
    await session.refresh(item)
    return item


def items_with_company(saved_list: SavedList) -> Sequence[tuple[SavedListItem, Company]]:
    """Pair every item with its eager-loaded Company. Convenience for callers."""
    return [(item, item.company) for item in saved_list.items]
