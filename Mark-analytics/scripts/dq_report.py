#!/usr/bin/env python3
"""Data-quality snapshot. Stub — fill in once data layer is migrated.

Intended checks:
  - % companies with industry_code
  - % companies with provenance for every populated field
  - duplicates (BIN collisions, name+address fuzzy matches)
  - stale entities (last_seen_at older than 90 days)

Output: simple text report; consider piping to Slack via cron.
"""

from __future__ import annotations

print("dq_report: not yet implemented. See docstring.")
