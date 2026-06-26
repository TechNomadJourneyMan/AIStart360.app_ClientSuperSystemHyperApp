"""Unit tests for competitor/market pure math helpers (no DB)."""

from __future__ import annotations

import pytest

from app.services.competitors import (
    REVENUE_BUCKETS,
    bucket_revenue,
    competition_level,
    compute_hhi,
    derive_size_category,
)

# Bucket labels referenced via the module constant so the test never hardcodes
# the en-dash characters that live in the contract-defined labels.
_B = [label for label, _lo, _hi in REVENUE_BUCKETS]
LT_05M, B_05_2M, B_2_10M, B_10_50M, GT_50M = _B


def test_derive_size_category_uses_explicit_when_valid() -> None:
    assert derive_size_category("large", 3) == "large"
    assert derive_size_category("enterprise", None) == "enterprise"


def test_derive_size_category_from_employee_count() -> None:
    assert derive_size_category(None, 5) == "micro"
    assert derive_size_category(None, 9) == "micro"
    assert derive_size_category(None, 10) == "small"
    assert derive_size_category(None, 49) == "small"
    assert derive_size_category(None, 50) == "medium"
    assert derive_size_category(None, 249) == "medium"
    assert derive_size_category(None, 250) == "large"
    assert derive_size_category(None, None) == "micro"
    # Unknown string falls through to employee-count derivation.
    assert derive_size_category("bogus", 300) == "large"


def test_compute_hhi_empty_and_zero() -> None:
    assert compute_hhi([]) == 0.0
    assert compute_hhi([0.0, 0.0]) == 0.0


def test_compute_hhi_monopoly_is_one() -> None:
    assert compute_hhi([1_000_000.0]) == pytest.approx(1.0)


def test_compute_hhi_fragmented_is_low() -> None:
    # Ten equal players → HHI = 10 * (0.1^2) = 0.1
    hhi = compute_hhi([100.0] * 10)
    assert hhi == pytest.approx(0.1)


def test_competition_level_thresholds() -> None:
    assert competition_level(0.10) == "low"
    assert competition_level(0.1499) == "low"
    assert competition_level(0.15) == "moderate"
    assert competition_level(0.25) == "moderate"
    assert competition_level(0.2501) == "high"
    assert competition_level(0.9) == "high"


def test_bucket_revenue_bins() -> None:
    revs = [100_000.0, 600_000.0, 5_000_000.0, 30_000_000.0, 80_000_000.0]
    buckets = bucket_revenue(revs)
    counts = {b["label"]: b["count"] for b in buckets}
    assert counts[LT_05M] == 1
    assert counts[B_05_2M] == 1
    assert counts[B_2_10M] == 1
    assert counts[B_10_50M] == 1
    assert counts[GT_50M] == 1
    assert sum(b["count"] for b in buckets) == 5


def test_bucket_revenue_empty() -> None:
    buckets = bucket_revenue([])
    assert len(buckets) == 5
    assert all(b["count"] == 0 for b in buckets)


def test_bucket_revenue_boundary_is_exclusive_upper() -> None:
    # 500_000 belongs to the second bucket, not the first (upper bound exclusive).
    buckets = bucket_revenue([500_000.0, 2_000_000.0])
    counts = {b["label"]: b["count"] for b in buckets}
    assert counts[LT_05M] == 0
    assert counts[B_05_2M] == 1
    assert counts[B_2_10M] == 1


def test_share_sum_approx_100() -> None:
    """Shares derived from revenues over their own total sum to ~100%."""
    revs = [18_900_000.0, 9_000_000.0, 4_300_000.0, 1_200_000.0, 500_000.0]
    total = sum(revs)
    shares = [round(r / total * 100, 2) for r in revs]
    assert sum(shares) == pytest.approx(100.0, abs=0.05)
