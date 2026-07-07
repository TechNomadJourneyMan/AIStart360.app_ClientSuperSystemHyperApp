import { describe, it, expect } from 'vitest'
import { calculatePointA } from '@/lib/point-a-engine'

/**
 * COR-01: the 12-step onboarding writes the finance answers under `s9n_*` keys
 * (Step9FinanceForm), but the base engine's finance block read only the legacy
 * `s2_*` keys — so a current submission scored ~0 on margin / breakeven / debt.
 * These pin the alias mapping. No LTV/CAC exists in the new step, so those stay
 * "missing" (never fabricated).
 */
describe('Point A finance block — new s9n_* finance-step keys', () => {
  // A current-form finance submission (no legacy s2_* finance keys at all).
  const s9nBase = {
    s9n_revenue_2024: 24_000_000,
    s9n_change_vs_2023: '+30%',
    s9n_breakeven_point: 'да, ~5 млн ₸/мес',
    s9n_debts_amount: 0,
  }

  it('counts net margin (s9n_net_margin) toward the finance score', () => {
    const low = calculatePointA({ ...s9nBase, s9n_net_margin: 0 })
    const high = calculatePointA({ ...s9nBase, s9n_net_margin: 40 })
    expect(high.blocks.finance.score).toBeGreaterThan(low.blocks.finance.score)
  })

  it('treats a filled breakeven text as "knows breakeven"', () => {
    const known = calculatePointA({ ...s9nBase, s9n_net_margin: 40, s9n_breakeven_point: 'да, 5 млн' })
    const unknown = calculatePointA({ ...s9nBase, s9n_net_margin: 40, s9n_breakeven_point: '' })
    expect(known.blocks.finance.score).toBeGreaterThan(unknown.blocks.finance.score)
  })

  it('penalizes real debt captured as s9n_debts_amount', () => {
    const noDebt = calculatePointA({ ...s9nBase, s9n_net_margin: 40, s9n_debts_amount: 0 })
    const withDebt = calculatePointA({ ...s9nBase, s9n_net_margin: 40, s9n_debts_amount: 50_000_000 })
    expect(withDebt.blocks.finance.score).toBeLessThan(noDebt.blocks.finance.score)
  })

  it('does not score ~0 on an s9n-only finance submission', () => {
    const pa = calculatePointA({ ...s9nBase, s9n_net_margin: 40 })
    expect(pa.blocks.finance.score).toBeGreaterThanOrEqual(45)
  })

  it('still prefers legacy s2_gross_margin when present', () => {
    const legacy = calculatePointA({ ...s9nBase, s2_gross_margin: 45, s9n_net_margin: 5 })
    const current = calculatePointA({ ...s9nBase, s9n_net_margin: 5 })
    // legacy 45% margin should out-score a 5% net margin submission.
    expect(legacy.blocks.finance.score).toBeGreaterThan(current.blocks.finance.score)
  })
})
