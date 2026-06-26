"""Denormalize geo fields onto companies for fast map rendering.

Adds latitude/longitude + region/city denorm columns so MapLibre + deck.gl
don't need a JOIN on every viewport request.

Revision ID: 0004
Revises: 0003
Create Date: 2026-05-28
"""
from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    # ── New denormalized geo columns ──────────────────────────────────
    # All nullable + IF NOT EXISTS guard via add_column (we re-check via index).
    op.add_column(
        "companies",
        sa.Column("latitude", sa.Float(precision=53), nullable=True),
    )
    op.add_column(
        "companies",
        sa.Column("longitude", sa.Float(precision=53), nullable=True),
    )
    op.add_column(
        "companies",
        sa.Column("region_kato", sa.String(20), nullable=True),
    )
    op.add_column(
        "companies",
        sa.Column("region_name", sa.String(128), nullable=True),
    )
    op.add_column(
        "companies",
        sa.Column("city_name", sa.String(128), nullable=True),
    )

    # ── Indexes ───────────────────────────────────────────────────────
    # Partial index on (lat,lng) — only rows with geo are queried by the map.
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_companies_geo "
        "ON companies (latitude, longitude) "
        "WHERE latitude IS NOT NULL"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_companies_region_kato "
        "ON companies (region_kato)"
    )

    # ── Backfill ──────────────────────────────────────────────────────
    # Region / city — straightforward text columns on addresses.
    # Idempotent: re-running just re-copies the same values.
    op.execute(
        """
        UPDATE companies c
           SET region_name = a.region,
               city_name   = a.city
          FROM addresses a
         WHERE c.address_id = a.id
           AND (c.region_name IS DISTINCT FROM a.region
                OR c.city_name IS DISTINCT FROM a.city)
        """
    )

    # Derive region-level KATO from companies.kato_code (first 2 digits = region).
    # KATO format: 9-digit code, first 2 digits identify the region (e.g. '75' = Almaty).
    op.execute(
        """
        UPDATE companies
           SET region_kato = LEFT(kato_code, 2)
         WHERE kato_code IS NOT NULL
           AND LENGTH(kato_code) >= 2
           AND region_kato IS DISTINCT FROM LEFT(kato_code, 2)
        """
    )

    # Coordinate backfill — try PostGIS first, fall back to TEXT geo column,
    # else leave NULL. Wrapped in DO block so it doesn't abort the migration
    # if PostGIS is missing or the geo column has an unexpected type.
    op.execute(
        """
        DO $$
        DECLARE
            geo_type text;
        BEGIN
            SELECT data_type INTO geo_type
              FROM information_schema.columns
             WHERE table_name = 'addresses' AND column_name = 'geo';

            IF geo_type IS NULL THEN
                RAISE NOTICE 'addresses.geo not present — skipping coordinate backfill';
                RETURN;
            END IF;

            -- PostGIS path: geography or geometry → cast to geometry, ST_X/ST_Y.
            IF geo_type IN ('USER-DEFINED') THEN
                BEGIN
                    UPDATE companies c
                       SET latitude  = ST_Y(a.geo::geometry),
                           longitude = ST_X(a.geo::geometry)
                      FROM addresses a
                     WHERE c.address_id = a.id
                       AND a.geo IS NOT NULL
                       AND (c.latitude IS NULL OR c.longitude IS NULL);
                EXCEPTION WHEN OTHERS THEN
                    RAISE NOTICE 'PostGIS ST_X/ST_Y unavailable — coordinates left NULL: %', SQLERRM;
                END;
            ELSE
                -- TEXT fallback (PostGIS disabled). geo stored as 'lat,lng' or WKT;
                -- we don't parse here — leave NULL and let the enrichment job fill it.
                RAISE NOTICE 'addresses.geo is %, leaving lat/lng NULL for enrichment pass', geo_type;
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_companies_region_kato")
    op.execute("DROP INDEX IF EXISTS idx_companies_geo")
    op.drop_column("companies", "city_name")
    op.drop_column("companies", "region_name")
    op.drop_column("companies", "region_kato")
    op.drop_column("companies", "longitude")
    op.drop_column("companies", "latitude")
