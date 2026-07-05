"""Honest region-level geocoding for the existing seed companies.

The `market.companies` seed rows have real names + OKED codes but NO location
(latitude/longitude/region_kato are NULL), so the map (`/geo/companies`, filters
by bbox) returns nothing. This assigns each company its HQ **region** from public
knowledge and sets coordinates to the region centroid + a small deterministic
jitter (so points don't stack). Precision is REGION-LEVEL only — every touched
row is tagged `geo:hq-region-approx` and `region_name` is set; we never invent a
precise street address.

Idempotent: re-running recomputes the same values. Scope: market schema only
(DB_SCHEMA=market) — the portal's public.companies is never touched.

Usage:
    cd backend && DB_SCHEMA=market DATABASE_URL=<pooler or direct> \
        python scripts/geocode_seed_companies.py [--dry-run]
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import text  # noqa: E402

from app.db.session import async_session_factory  # noqa: E402

# 2-digit KATO → (lat, lon, region_name). Centroids of the region's main city.
REGION_CENTROIDS: dict[str, tuple[float, float, str]] = {
    "75": (43.2389, 76.8897, "г. Алматы"),
    "71": (51.1605, 71.4704, "г. Астана"),
    "79": (42.3417, 69.5900, "г. Шымкент"),
    "23": (47.0944, 51.9230, "Атырауская область"),
    "15": (50.2839, 57.1660, "Актюбинская область"),
    "47": (43.6500, 51.2000, "Мангистауская область"),
    "63": (49.9483, 82.6279, "Восточно-Казахстанская область"),
    "35": (49.8050, 73.1094, "Карагандинская область"),
    "39": (53.2200, 63.6240, "Костанайская область"),
    "55": (52.2855, 76.9405, "Павлодарская область"),
    "31": (42.9000, 71.3667, "Жамбылская область"),
    "61": (43.3000, 68.2500, "Туркестанская область"),
}

# Distinctive name substring (lowercased) → HQ region KATO. Checked in order;
# first match wins. Industrial/extractive firms → real production region; the
# rest fall through to the state-vs-private default below.
HQ_OVERRIDES: list[tuple[str, str]] = [
    # Oil & gas / petrochemistry
    ("тенгизшевройл", "23"),
    ("атырауский нпз", "23"),
    ("каражанбасмунай", "47"),
    ("kazazot", "47"),
    ("павлодарский нхз", "55"),
    # Mining & metallurgy
    ("арселформиттал", "35"),
    ("арселормиттал", "35"),
    ("темиртау", "35"),
    ("казцинк", "63"),
    ("kaz minerals", "63"),
    ("костанайские минералы", "39"),
    ("eurasian resources", "15"),
    ("erg —", "15"),
    # Agriculture (Kostanay grain belt)
    ("иволга", "39"),
    ("атамекен-агро", "39"),
    ("allur", "39"),
    # Pharma (Shymkent)
    ("химфарм", "79"),
    # Almaty-anchored consumer/leisure
    ("рахат", "75"),
    ("шымбулак", "75"),
    ("аэропорт алматы", "75"),
    ("rixos almaty", "75"),
    ("кока-кола алматы", "75"),
]

# State / national companies HQ in Astana (71). Substrings.
STATE_HINTS: list[str] = [
    "казмунайгаз", "kegoc", "темір жолы", "темир жолы", "эйр астана", "air astana",
    "казахстан инжиниринг", "тау-кен", "самрук", "казахтелеком", "қазпошта",
    "казпошта", "назарбаев университет", "ск-фармация", "astana ", "bts digital",
    "documentolog", "highvill", "bi group", "jusan", "forte bank", "freedom holding",
]


def region_for(name: str) -> str:
    low = name.lower()
    for sub, kato in HQ_OVERRIDES:
        if sub in low:
            return kato
    for sub in STATE_HINTS:
        if sub in low:
            return "71"
    # Default: the vast majority of remaining large KZ private/commercial HQs
    # are in Almaty. Region-level, explicitly approximate (tagged below).
    return "75"


def jitter(name: str) -> tuple[float, float]:
    """Deterministic ±~0.18° offset from a name hash so points spread out."""
    h = hashlib.md5(name.encode("utf-8")).hexdigest()
    dlat = (int(h[0:4], 16) / 0xFFFF - 0.5) * 0.36
    dlon = (int(h[4:8], 16) / 0xFFFF - 0.5) * 0.36
    return dlat, dlon


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="Print, do not write")
    args = ap.parse_args()

    async with async_session_factory() as session:
        rows = (
            await session.execute(
                text("SELECT id, name FROM companies WHERE latitude IS NULL OR region_kato IS NULL")
            )
        ).fetchall()
        print(f"Companies needing geocoding: {len(rows)}")

        counts: dict[str, int] = {}
        updates = []
        for cid, name in rows:
            kato = region_for(name)
            lat0, lon0, rname = REGION_CENTROIDS[kato]
            dlat, dlon = jitter(name)
            lat, lon = round(lat0 + dlat, 6), round(lon0 + dlon, 6)
            counts[rname] = counts.get(rname, 0) + 1
            updates.append((cid, lat, lon, kato, rname, name))

        for rname, n in sorted(counts.items(), key=lambda x: -x[1]):
            print(f"  {rname}: {n}")

        if args.dry_run:
            print("DRY RUN — no writes.")
            return

        for cid, lat, lon, kato, rname, name in updates:
            await session.execute(
                text(
                    """
                    UPDATE companies
                    SET latitude = :lat,
                        longitude = :lon,
                        region_kato = :kato,
                        kato_code = :kato,
                        region_name = :rname,
                        tags = (
                            SELECT array_agg(DISTINCT t)
                            FROM unnest(COALESCE(tags, '{}') || ARRAY['geo:hq-region-approx']) AS t
                        )
                    WHERE id = :cid
                    """
                ),
                {"lat": lat, "lon": lon, "kato": kato, "rname": rname, "cid": cid},
            )
        await session.commit()
        print(f"Updated {len(updates)} companies (region-level HQ, tagged geo:hq-region-approx).")


if __name__ == "__main__":
    asyncio.run(main())
