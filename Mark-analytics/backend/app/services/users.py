"""User service — lazy provisioning of Supabase users into our `users` table."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.core.security import SupabaseUserClaims
from app.models.user import User

logger = get_logger(__name__)


async def ensure_user_exists(session: AsyncSession, claims: SupabaseUserClaims) -> User:
    """Insert-on-conflict-do-nothing, then SELECT. Idempotent.

    On the *first* successful insert we also seed default dashboard widgets
    (Track G — `docs/aistart360/08-world-monitor-feature-parity.md` §5).
    Seeding is wrapped in try/except so a widget-table problem never blocks
    auth provisioning.
    """
    user_id = UUID(claims.user_id)
    email = claims.email or f"unknown+{user_id}@example.invalid"

    stmt = (
        pg_insert(User)
        .values(
            id=user_id,
            email=email,
            plan=claims.app_metadata.get("plan", "free"),
            role=claims.app_metadata.get("role", "user"),
        )
        .on_conflict_do_nothing(index_elements=[User.id])
        .returning(User.id)
    )
    inserted = (await session.execute(stmt)).scalar_one_or_none()
    await session.commit()

    if inserted is not None:
        try:
            # Local import to avoid a circular import at module load time
            # (widgets service imports from app.models which imports user).
            from app.services import widgets as widgets_svc

            await widgets_svc.seed_defaults(session, user_id=user_id)
        except Exception as exc:
            logger.warning(
                "widget_seed_failed",
                user_id=str(user_id),
                error=str(exc),
            )

    result = await session.execute(select(User).where(User.id == user_id))
    return result.scalar_one()


async def get_user(session: AsyncSession, user_id: UUID) -> User | None:
    result = await session.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()
