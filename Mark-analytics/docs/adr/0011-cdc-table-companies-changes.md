# ADR-0011: CDC table for `companies_changes`

Status: Accepted (2026-05-28)

## Context

§8 and §11 PR #1 of `docs/aistart360/07-product-redesign.md` require a
change-data-capture log over the `companies` table so the UI can surface a
"Δ in the last 30d" badge, render a Changes tab on the company profile, and
back time-series analytics (new registrations, exec changes, etc.). Without
CDC the trust-signal envelope's `recent_changes` field is dishonest.

The `companies_changes` table was already defined in migration `0001_initial`
(columns: `id`, `company_id`, `field`, `old_value`, `new_value`, `detected_at`,
`source_page_id`). What was missing: a write path that actually populates it
on `UPDATE`, and a discriminator that says *what kind of mutation* this was
(spider re-crawl vs. manual edit vs. enrichment job).

## Decision

1. **Reuse the existing table.** Don't rename `detected_at → changed_at` or
   `field → field_name` just to match the spec's English. The columns are
   semantic equivalents; renaming breaks 0001 + any downstream queries.
2. **Add `change_source TEXT` discriminator** (migration 0008) — values are
   free-text by convention: `spider`, `manual`, `enrichment`, `merge`,
   `unknown`. Constrained by application code, not by a check constraint, so
   spider/agent authors can add new sources without a migration.
3. **Write path is a SQLAlchemy `before_flush` event listener**, not a DB
   trigger. The listener lives in `app/models/_company_cdc.py`, walks every
   dirty `Company`, and emits one `CompanyChange` row per changed column.
4. **Ignored fields**: `updated_at`, `created_at`, `embedding`,
   `data_freshness_at`. They flap on every UPDATE and would drown signal.
5. **Source tagging**: callers set `set_change_source(session, "spider")`
   before flushing. Default is `"unknown"` so we never silently drop rows.

## Why application-level vs. DB trigger

| Concern | App-level (chosen) | DB trigger (rejected fallback) |
|---|---|---|
| Test ergonomics | Works against any DB Alembic supports; trivial to assert | Needs Postgres-only fixtures, plpgsql for diffs |
| Author attribution | Trivially available via `session.info` | Requires `SET LOCAL` per transaction or a session table |
| Rollback | `git revert` one file | A second migration |
| Performance | Adds Python work to every flush touching a Company | Zero app overhead, fires in the DB |
| Bulk updates | **Misses bulk `UPDATE` statements that bypass the ORM** | Catches everything |

The bulk-update gap is the main risk. We mitigate by routing every bulk
mutation through a service function that itself stamps the CDC log. If we
ever need a hard guarantee (regulators, audit), the fallback is a `plpgsql`
trigger that this ADR pre-approves; see `migrations/_unused/0008b_cdc_trigger.sql`
sketch when/if we land it.

## Retention

No automatic deletion in Phase 0/1. Rows are cheap (≤ 200 bytes typical).
Phase 2 work item: partition by month and TTL > 24 months to cold storage.

## Read pattern

The `/companies/{id}` envelope counts CDC rows in a trailing 30-day window
(`recent_changes`). A future `/companies/{id}/changes` endpoint will page
through them ordered by `detected_at DESC`. Index
`ix_companies_changes_company_detected_desc` from migration 0008 backs both.

## Consequences

- Every spider/enricher that mutates a Company gets a change history "for
  free", without needing to remember to log.
- The CDC log becomes the source of truth for the timeline tab — no more
  ad-hoc "what changed" queries against `raw` JSONB.
- We accept the bulk-update gap for now. ER merges, mass relabels, and
  similar operations MUST go through the ORM or stamp CDC rows manually.
