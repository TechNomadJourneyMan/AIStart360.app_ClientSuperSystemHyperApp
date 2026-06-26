"""Seed ~50 realistic demo tenders linked to existing companies.

Idempotent: if `tenders` already has >= 10 rows, exits without doing anything.

Usage:
    cd backend && python scripts/seed_demo_tenders.py [--count 50] [--force]
"""
from __future__ import annotations

import argparse
import asyncio
import random
import sys
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

from sqlalchemy import text

# Add repo root to path so we can import app.*
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.db.session import async_session_factory

SOURCE = "demo_seed"

# Russian/Kazakh tender title templates (object x work)
OBJECTS = [
    "административного здания",
    "школы №42",
    "больничного комплекса",
    "автодорог местного значения",
    "линий электропередач 110 кВ",
    "водопроводных сетей",
    "котельной",
    "детского сада",
    "стадиона",
    "пожарного депо",
    "теплотрассы",
    "канализационных сетей",
    "торгового центра",
    "складского комплекса",
    "офисного здания",
    "жилого микрорайона",
]
WORKS = [
    "Капитальный ремонт",
    "Реконструкция",
    "Строительство",
    "Текущий ремонт",
    "Модернизация",
    "Проектирование",
    "Поставка оборудования для",
    "Техническое обслуживание",
]
SUPPLIES = [
    "Поставка медицинского оборудования",
    "Закуп компьютерной техники",
    "Поставка автотранспорта",
    "Закуп ГСМ",
    "Поставка канцелярских товаров",
    "Поставка спецодежды",
    "Закуп продуктов питания",
    "Поставка нефтепродуктов",
    "Закуп строительных материалов",
    "Поставка серверного оборудования",
]
SERVICES = [
    "Услуги охраны объектов",
    "Услуги клининга",
    "Консультационные услуги по аудиту",
    "Юридические услуги",
    "Услуги по разработке ПО",
    "Услуги связи и интернет",
    "Транспортные услуги",
    "Услуги по обучению персонала",
]

STATUSES = ["published", "published", "published", "in_review", "awarded", "cancelled"]


def make_title(rng: random.Random) -> str:
    bucket = rng.random()
    if bucket < 0.45:
        return f"{rng.choice(WORKS)} {rng.choice(OBJECTS)}"
    if bucket < 0.80:
        return rng.choice(SUPPLIES)
    return rng.choice(SERVICES)


async def get_existing_count(session) -> int:
    r = await session.execute(text("SELECT count(*) FROM tenders"))
    return int(r.scalar() or 0)


async def get_company_ids(session, n: int) -> list[uuid.UUID]:
    """Sample N company ids; prefer demo_seed companies but fall back to any."""
    r = await session.execute(text(
        "SELECT id FROM companies WHERE data_source = 'demo_seed' "
        "ORDER BY random() LIMIT :n"
    ), {"n": n})
    ids = [row[0] for row in r.all()]
    if len(ids) < n:
        r = await session.execute(text(
            "SELECT id FROM companies ORDER BY random() LIMIT :n"
        ), {"n": n})
        ids = [row[0] for row in r.all()]
    return ids


async def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--count", type=int, default=50)
    p.add_argument("--force", action="store_true",
                   help="Insert even if tenders already exist")
    args = p.parse_args()

    rng = random.Random(20260528)  # noqa: S311 — deterministic demo data, not crypto

    async with async_session_factory() as session:
        existing = await get_existing_count(session)
        if existing >= 10 and not args.force:
            print(f"[skip] tenders table already has {existing} rows (>= 10). "
                  "Use --force to add more.")
            return

        customers = await get_company_ids(session, args.count)
        if not customers:
            print("[abort] no companies found — run seed_demo_companies.py first")
            return

        # Awardees come from a wider pool (any company), excluding customer.
        all_companies = await get_company_ids(session, max(args.count * 3, 100))

        now = datetime.now(UTC)
        inserted = 0
        for i in range(args.count):
            customer_id = customers[i % len(customers)]
            published = now - timedelta(days=rng.randint(0, 90),
                                        hours=rng.randint(0, 23))
            deadline = published + timedelta(days=rng.randint(14, 60))
            status = rng.choice(STATUSES)
            # KZT amount 1M..500M, stored in amount_usd column (demo data;
            # frontend formatter renders M / B tenge from magnitude alone).
            amount = round(rng.uniform(1_000_000, 500_000_000), 2)
            awardee = None
            if status == "awarded":
                pool = [c for c in all_companies if c != customer_id]
                if pool:
                    awardee = rng.choice(pool)

            params = {
                "id": uuid.uuid4(),
                "external_id": f"DEMO-{20260000 + i:08d}",
                "source": SOURCE,
                "customer_id": customer_id,
                "title": make_title(rng),
                "description": None,
                "amount_usd": amount,
                "currency": "KZT",
                "status": status,
                "published_at": published,
                "deadline_at": deadline,
                "awarded_to_id": awardee,
            }
            await session.execute(text("""
                INSERT INTO tenders (
                    id, external_id, source, customer_id, title, description,
                    amount_usd, currency, status, published_at, deadline_at,
                    awarded_to_id
                ) VALUES (
                    :id, :external_id, :source, :customer_id, :title, :description,
                    :amount_usd, :currency, :status, :published_at, :deadline_at,
                    :awarded_to_id
                )
                ON CONFLICT (source, external_id) DO NOTHING
            """), params)
            inserted += 1

        await session.commit()
        total = await get_existing_count(session)
        print(f"Inserted {inserted} demo tenders. Total tenders now: {total}")


if __name__ == "__main__":
    asyncio.run(main())
