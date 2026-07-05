"""Seed demo companies for the map: 60 real KZ companies from
New advanced Data/kazakhstan_market_data_registry.xlsx + 940 synthetic
spread across 17 regions × 12 industries with realistic noise.

Usage:
    cd backend && python scripts/seed_demo_companies.py [--synthetic N]
"""
from __future__ import annotations

import asyncio
import random
import sys
import uuid
from pathlib import Path

import openpyxl
from sqlalchemy import text

# Add repo root to path so we can import app.*
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.db.session import async_session_factory  # noqa: E402

XLSX_PATH = Path(
    "/Users/ansarisenoff/Mark-analytics/New advanced Data/kazakhstan_market_data_registry.xlsx"
)

# Centroids of 17 KZ regions + 3 cities (lat, lon, region_kato, region_name)
KZ_REGIONS = [
    (43.2389, 76.8897, "75", "Алматы"),
    (51.1605, 71.4704, "71", "Астана"),
    (42.3417, 69.5900, "79", "Шымкент"),
    (47.0944, 51.9230, "15", "Атырауская"),
    (50.2839, 57.1660, "11", "Актюбинская"),
    (43.6500, 51.2000, "47", "Мангистауская"),
    (50.4111, 80.2275, "63", "Восточно-Казахстанская"),
    (49.8050, 73.1094, "35", "Карагандинская"),
    (53.2200, 63.6240, "39", "Костанайская"),
    (52.2855, 76.9405, "55", "Павлодарская"),
    (54.8720, 69.1380, "59", "Северо-Казахстанская"),
    (52.9610, 63.5700, "31", "Акмолинская"),
    (44.8500, 65.5000, "43", "Кызылординская"),
    (42.9000, 71.3667, "33", "Жамбылская"),
    (43.6500, 51.1500, "27", "Западно-Казахстанская"),
    (43.5000, 68.2000, "61", "Туркестанская"),
    (45.0167, 78.3736, "23", "Алматинская"),
    (49.4561, 82.6175, "62", "Абайская"),
    (50.4111, 80.2275, "67", "Жетiсуская"),
    (46.8500, 53.7000, "19", "Улытауская"),
]

# Industry codes (NACE letter) with weighted probability
INDUSTRY_DIST = [
    ("B", "Mining/Oil&Gas", 0.10),
    ("C", "Manufacturing", 0.18),
    ("D", "Utilities", 0.04),
    ("F", "Construction", 0.10),
    ("G", "Trade/Retail", 0.18),
    ("H", "Transport/Logistics", 0.08),
    ("I", "Hospitality", 0.05),
    ("J", "ICT/Telecom", 0.07),
    ("K", "Finance", 0.05),
    ("L", "Real Estate", 0.04),
    ("M", "Professional Services", 0.06),
    ("N", "Admin Services", 0.03),
    ("Q", "Healthcare", 0.02),
]

SIZE_CATEGORIES = [
    ("micro", 50, 100_000, 2_000_000, 0.45),
    ("small", 100, 2_000_000, 24_000_000, 0.30),
    ("medium", 250, 24_000_000, 100_000_000, 0.15),
    ("large", 2000, 100_000_000, 500_000_000, 0.07),
    ("enterprise", 50000, 500_000_000, 20_000_000_000, 0.03),
]


def load_real_companies() -> list[dict]:
    """Load 60 real KZ companies from xlsx."""
    if not XLSX_PATH.exists():
        print(f"[warn] {XLSX_PATH} not found, skipping real companies")
        return []
    wb = openpyxl.load_workbook(XLSX_PATH, data_only=True)
    ws = wb["companies_registry"]
    rows = list(ws.iter_rows(values_only=True))
    headers = rows[0]
    companies = []
    for r in rows[1:]:
        row = dict(zip(headers, r, strict=False))
        if not row.get("name"):
            continue
        city = (row.get("hq_city") or "").strip()
        lat, lon, kato, region = find_region_for_city(city)
        size_class = (row.get("size_class") or "medium").lower()
        if size_class not in {"micro", "small", "medium", "large", "enterprise"}:
            size_class = "medium"
        sector_to_code = {
            "финансы": "K",
            "торговля": "G",
            "энергетика": "D",
            "нефть и газ": "B",
            "транспорт": "H",
            "связь": "J",
            "ит": "J",
            "технологии": "J",
            "промышленность": "C",
            "строительство": "F",
        }
        sector = (row.get("sector") or "").lower()
        ind_code = "M"  # default professional services
        for k, v in sector_to_code.items():
            if k in sector:
                ind_code = v
                break
        # add small jitter (within ~30km) for visual variety
        lat += random.uniform(-0.25, 0.25)
        lon += random.uniform(-0.4, 0.4)
        companies.append({
            "name": row["name"],
            "industry_code": ind_code,
            "industry_label": row.get("industry") or row.get("sector"),
            "size_category": size_class,
            "employee_count": _employees_from_band(row.get("employees_band")),
            "revenue_usd": _revenue_from_band(row.get("revenue_band_kzt")),
            "latitude": lat,
            "longitude": lon,
            "region_kato": kato,
            "region_name": region,
            "city_name": city or region,
            "ownership_type_detail": row.get("ownership_type"),
        })
    return companies


def find_region_for_city(city: str) -> tuple[float, float, str, str]:
    """Naive region lookup by city name."""
    c = (city or "").lower()
    mapping = {
        "алматы": ("75", "Алматы"),
        "almaty": ("75", "Алматы"),
        "астана": ("71", "Астана"),
        "astana": ("71", "Астана"),
        "nur-sultan": ("71", "Астана"),
        "шымкент": ("79", "Шымкент"),
        "shymkent": ("79", "Шымкент"),
        "атырау": ("15", "Атырауская"),
        "actobe": ("11", "Актюбинская"),
        "актобе": ("11", "Актюбинская"),
        "актау": ("47", "Мангистауская"),
        "aktau": ("47", "Мангистауская"),
        "тараз": ("33", "Жамбылская"),
        "tarsa": ("33", "Жамбылская"),
        "караганда": ("35", "Карагандинская"),
        "karaganda": ("35", "Карагандинская"),
        "костанай": ("39", "Костанайская"),
        "kostanay": ("39", "Костанайская"),
        "павлодар": ("55", "Павлодарская"),
        "pavlodar": ("55", "Павлодарская"),
        "усть-каменогорск": ("63", "Восточно-Казахстанская"),
        "семей": ("62", "Абайская"),
        "тенгиз": ("15", "Атырауская"),
        "кызылорда": ("43", "Кызылординская"),
        "уральск": ("27", "Западно-Казахстанская"),
        "петропавловск": ("59", "Северо-Казахстанская"),
        "кокшетау": ("31", "Акмолинская"),
    }
    for k, (kato, region) in mapping.items():
        if k in c:
            for lat, lon, kk, rr in KZ_REGIONS:
                if kk == kato:
                    return (lat, lon, kato, region)
    # default Almaty
    return (43.2389, 76.8897, "75", "Алматы")


def _employees_from_band(band: str | None) -> int | None:
    if not band:
        return None
    s = str(band).replace(" ", "")
    if ">" in s:
        return 12000
    if "-" in s:
        parts = s.split("-")
        try:
            return (int(parts[0]) + int(parts[1])) // 2
        except (ValueError, IndexError):
            return None
    try:
        return int(s)
    except ValueError:
        return None


def _revenue_from_band(band: str | None) -> float | None:
    # Bands are noisy free-text; approximate
    if not band:
        return None
    s = str(band).lower().replace(",", ".")
    multipliers = {"трлн": 1e12, "млрд": 1e9, "млн": 1e6}
    multiplier = 1.0
    for k, m in multipliers.items():
        if k in s:
            multiplier = m
            s = s.replace(k, "")
            break
    # Extract first number
    import re
    match = re.search(r"\d+(\.\d+)?", s)
    if not match:
        return None
    try:
        kzt = float(match.group()) * multiplier
        return kzt / 450.0  # KZT → USD approx
    except ValueError:
        return None


def weighted_pick(items_with_weight: list) -> tuple:
    """Pick by weight (last element of tuple)."""
    weights = [it[-1] for it in items_with_weight]
    return random.choices([it[:-1] for it in items_with_weight], weights=weights, k=1)[0]


def generate_synthetic(n: int) -> list[dict]:
    out = []
    first_names = ["KazTech", "Astana", "Almaty", "Tulpar", "Saryarka", "Kaspian", "BaiTerek",
                   "Eurasia", "TauKen", "Beren", "Aibyn", "Adal", "Berel", "Beibarys", "Aralsk",
                   "Tenir", "TanSulu", "Aksai", "Asyl", "Saulet"]
    suffixes = ["LLP", "JSC", "Group", "Holding", "Trading", "Industries", "Energy", "Logistics",
                "Capital", "Tech", "Solutions", "Construction", "Mining", "Foods", "Media"]
    for i in range(n):
        lat0, lon0, kato, region = random.choice(KZ_REGIONS)
        # Scatter within ~150km of region centroid
        lat = lat0 + random.uniform(-1.2, 1.2)
        lon = lon0 + random.uniform(-1.8, 1.8)
        ind_code, ind_label = weighted_pick(INDUSTRY_DIST)
        size, emp_max, rev_min, rev_max = weighted_pick(SIZE_CATEGORIES)
        employees = random.randint(max(emp_max // 4, 1), emp_max)
        revenue = round(random.uniform(rev_min, rev_max), 2)
        name = f"{random.choice(first_names)}{random.choice(['', ' '])}{random.choice(suffixes)} {i + 1}"
        out.append({
            "name": name,
            "industry_code": ind_code,
            "industry_label": ind_label,
            "size_category": size,
            "employee_count": employees,
            "revenue_usd": revenue,
            "latitude": round(lat, 5),
            "longitude": round(lon, 5),
            "region_kato": kato,
            "region_name": region,
            "city_name": region,
            "ownership_type_detail": random.choice(["Private", "Public", "State", "Foreign"]),
        })
    return out


async def upsert_companies(companies: list[dict]) -> int:
    if not companies:
        return 0
    sql = text("""
        INSERT INTO companies (
            id, country, name, name_normalized, industry_code, industry_label,
            size_category, employee_count, revenue_usd,
            latitude, longitude, region_kato, region_name, city_name,
            ownership_type_detail, status, data_source, source_confidence, confidence
        ) VALUES (
            :id, 'KZ', :name, lower(:name), :industry_code, :industry_label,
            :size_category, :employee_count, :revenue_usd,
            :latitude, :longitude, :region_kato, :region_name, :city_name,
            :ownership_type_detail, 'active', 'demo_seed', 0.9, 0.9
        )
    """)
    inserted = 0
    for c in companies:
        # Truncate text fields that may exceed column limits
        c["id"] = uuid.uuid4()
        c["name"] = (c.get("name") or "")[:255]
        c["industry_label"] = (c.get("industry_label") or "")[:64] or None
        c["city_name"] = (c.get("city_name") or "")[:128] or None
        c["region_name"] = (c.get("region_name") or "")[:128] or None
        c["ownership_type_detail"] = (c.get("ownership_type_detail") or "")[:64] or None
        # Use a fresh session per row so one failure doesn't abort the whole batch
        async with async_session_factory() as session:
            try:
                result = await session.execute(sql, c)
                await session.commit()
                inserted += result.rowcount or 0
            except Exception as e:  # noqa: BLE001
                await session.rollback()
                # Only print first 100 chars of error to avoid noise
                msg = str(e)[:100]
                print(f"[skip] {c['name'][:40]}: {msg}")
    return inserted


async def main():
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--synthetic", type=int, default=1000,
                   help="Number of synthetic companies to add (default 1000)")
    p.add_argument("--real-only", action="store_true",
                   help="Insert ONLY the real companies from the xlsx (synthetic=0). "
                        "Use for honest production seeding.")
    p.add_argument("--clear", action="store_true",
                   help="DELETE existing demo_seed companies first")
    args = p.parse_args()

    if args.real_only:
        args.synthetic = 0

    if args.clear:
        async with async_session_factory() as session:
            r = await session.execute(text(
                "DELETE FROM companies WHERE data_source = 'demo_seed'"
            ))
            await session.commit()
            print(f"Cleared {r.rowcount} existing demo_seed companies")

    real = load_real_companies()
    print(f"Loaded {len(real)} real companies from xlsx")

    synthetic = generate_synthetic(args.synthetic)
    print(f"Generated {len(synthetic)} synthetic companies")

    n = await upsert_companies(real + synthetic)
    print(f"Inserted {n} companies total")

    async with async_session_factory() as session:
        total = await session.execute(text(
            "SELECT count(*) FROM companies WHERE latitude IS NOT NULL"
        ))
        print(f"Companies with geo: {total.scalar()}")


if __name__ == "__main__":
    asyncio.run(main())
