"""FastAPI dependencies: DB session, current_user, optional_user."""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends, Header
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import UnauthorizedError
from app.core.security import SupabaseUserClaims, verify_supabase_jwt
from app.db.session import async_session_factory


async def get_session() -> AsyncIterator[AsyncSession]:
    async with async_session_factory() as session:
        yield session


async def get_current_user(
    authorization: Annotated[str | None, Header()] = None,
) -> SupabaseUserClaims:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise UnauthorizedError("Missing bearer token", code="MISSING_TOKEN")
    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise UnauthorizedError("Empty token", code="EMPTY_TOKEN")
    return verify_supabase_jwt(token)


async def get_optional_user(
    authorization: Annotated[str | None, Header()] = None,
) -> SupabaseUserClaims | None:
    if not authorization:
        return None
    try:
        return await get_current_user(authorization)
    except UnauthorizedError:
        return None


# Type aliases for FastAPI signatures
SessionDep = Annotated[AsyncSession, Depends(get_session)]
CurrentUserDep = Annotated[SupabaseUserClaims, Depends(get_current_user)]
OptionalUserDep = Annotated[SupabaseUserClaims | None, Depends(get_optional_user)]
