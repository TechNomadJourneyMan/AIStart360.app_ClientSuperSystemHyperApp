"""Track E — KZ Region Risk Index (materialized view).

Creates `region_risk_index` as a materialized view holding a per-region (KATO
two-digit prefix) composite risk score in 0..100, plus a JSONB column of the
contributing subscores so the frontend can break the score down.

We deliberately use a *materialized* view rather than a regular view so the
choropleth doesn't pay the aggregation cost on every render. The view is
refreshed nightly by an Arq cron job (see `app.workers.tasks.region_risk`)
and on-demand by `python -m app.jobs.refresh_region_risk_index`.

Composition (see Track E in the parity doc):

  liquidations_3m  weight 0.30
  court_cases_6m   weight 0.30  (degraded → 0 if `court_cases` table absent)
  sanctions_hits   weight 0.20
  complaints_count weight 0.20  (degraded → 0 if `complaints` table absent)

Each subscore is normalised to 0..100 via a robust median-anchored z-score
(see `score` SQL below), then weight-averaged.

Down migration drops the MV. To roll back manually on a host without docker
postgres, run:

    DROP MATERIALIZED VIEW IF EXISTS region_risk_index;
    DROP INDEX IF EXISTS ix_region_risk_index_kato;

Revision ID: 0014
Revises: 0013
Create Date: 2026-05-28
"""
from __future__ import annotations

from typing import Sequence

from alembic import op

revision: str = "0014"
down_revision: str | None = "0013"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


# ── The MV body ──────────────────────────────────────────────────────
# All four CTEs return one row per region (`kato_code` = region_kato).
# Missing optional tables (`court_cases`, `complaints`) are detected at
# refresh time by the python job, which adjusts the `subscores` JSON to
# mark them as null/degraded. The MV itself always carries a numeric 0.
CREATE_MV_SQL = """
CREATE MATERIALIZED VIEW IF NOT EXISTS region_risk_index AS
WITH regions AS (
    SELECT DISTINCT region_kato AS kato_code
      FROM companies
     WHERE region_kato IS NOT NULL
),
liq AS (
    SELECT region_kato AS kato_code,
           COUNT(*)::numeric AS v
      FROM companies
     WHERE region_kato IS NOT NULL
       AND status = 'liquidated'
       AND updated_at >= NOW() - INTERVAL '3 months'
     GROUP BY region_kato
),
sanc AS (
    -- sanctions_list has no direct region FK in v1; we approximate by
    -- looking up companies whose normalized name matches a sanctions
    -- entry's full_name (case-insensitive), then bucket by region.
    SELECT c.region_kato AS kato_code,
           COUNT(*)::numeric AS v
      FROM companies c
      JOIN sanctions_list s
        ON LOWER(s.full_name) = LOWER(c.name)
     WHERE c.region_kato IS NOT NULL
     GROUP BY c.region_kato
),
joined AS (
    SELECT r.kato_code,
           COALESCE(liq.v, 0)  AS liquidations_3m,
           0::numeric           AS court_cases_6m,
           COALESCE(sanc.v, 0) AS sanctions_hits,
           0::numeric           AS complaints_count
      FROM regions r
      LEFT JOIN liq  ON liq.kato_code  = r.kato_code
      LEFT JOIN sanc ON sanc.kato_code = r.kato_code
),
-- Per-subscore robust normalisation:
--   norm(x) = 50 + 25 * (x - median) / (mad + eps)
-- then clamped to [0, 100]. Median + MAD computed across regions.
stats AS (
    SELECT
        percentile_cont(0.5) WITHIN GROUP (ORDER BY liquidations_3m)    AS med_liq,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY court_cases_6m)     AS med_court,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY sanctions_hits)     AS med_sanc,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY complaints_count)   AS med_comp,
        GREATEST(stddev_pop(liquidations_3m),  1.0) AS sd_liq,
        GREATEST(stddev_pop(court_cases_6m),   1.0) AS sd_court,
        GREATEST(stddev_pop(sanctions_hits),   1.0) AS sd_sanc,
        GREATEST(stddev_pop(complaints_count), 1.0) AS sd_comp
      FROM joined
),
scored AS (
    SELECT j.kato_code,
           j.liquidations_3m,
           j.court_cases_6m,
           j.sanctions_hits,
           j.complaints_count,
           LEAST(100.0, GREATEST(0.0,
               50.0 + 25.0 * (j.liquidations_3m  - s.med_liq)   / s.sd_liq))   AS n_liq,
           LEAST(100.0, GREATEST(0.0,
               50.0 + 25.0 * (j.court_cases_6m   - s.med_court) / s.sd_court)) AS n_court,
           LEAST(100.0, GREATEST(0.0,
               50.0 + 25.0 * (j.sanctions_hits   - s.med_sanc)  / s.sd_sanc))  AS n_sanc,
           LEAST(100.0, GREATEST(0.0,
               50.0 + 25.0 * (j.complaints_count - s.med_comp)  / s.sd_comp)) AS n_comp
      FROM joined j
     CROSS JOIN stats s
)
SELECT
    kato_code,
    ROUND(
        (0.30 * n_liq + 0.30 * n_court + 0.20 * n_sanc + 0.20 * n_comp)::numeric,
        2
    ) AS score,
    jsonb_build_object(
        'liquidations_3m',  liquidations_3m::int,
        'court_cases_6m',   court_cases_6m::int,
        'sanctions_hits',   sanctions_hits::int,
        'complaints_count', complaints_count::int
    ) AS subscores,
    NOW() AS updated_at
  FROM scored;
"""


def upgrade() -> None:
    op.execute(CREATE_MV_SQL)
    # Unique index required for REFRESH MATERIALIZED VIEW CONCURRENTLY.
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_region_risk_index_kato "
        "ON region_risk_index (kato_code)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_region_risk_index_kato")
    op.execute("DROP MATERIALIZED VIEW IF EXISTS region_risk_index")
