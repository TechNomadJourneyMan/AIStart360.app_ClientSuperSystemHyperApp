/**
 * lib/payments/billing.ts — the only writer of a client's plan (W8).
 *  - one call changes subscriptions AND profiles.tier (via billing_set_plan);
 *  - admin / system changes are journalled BEFORE the write, required;
 *  - provider changes (Kaspi) are never lost because the journal is down;
 *  - the expiry job is idempotent.
 * The SQL function itself runs against Postgres in
 * tests/integration/db/billing-unify.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeClient, fakeDb, sqlModel, type FakeDb } from './_fake-supabase'

const state = vi.hoisted(() => ({ client: null as unknown }))
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => state.client }))

import {
  BillingError,
  KASPI_WEBHOOK_ACTOR,
  addMonths,
  effectivePlan,
  expireDuePlans,
  getEffectivePlan,
  setPlan,
  toSubscriptionRecord,
  utcIso,
} from '@/lib/payments/billing'

const USER = '11111111-2222-3333-4444-555555555555'
const COMPANY = 'company-1'
const ADMIN = { id: 'aaaaaaaa-0000-0000-0000-000000000001', kind: 'session' as const, role: 'admin' as const }

let db: FakeDb
function world(extra: { subscriptions?: Record<string, unknown>[]; tier?: string } = {}) {
  db = fakeDb({
    profiles: [{ id: USER, tier: extra.tier ?? 'free', feature_flags: {} }],
    companies: [{ id: COMPANY, user_id: USER }],
    subscriptions: extra.subscriptions ?? [],
  })
  state.client = fakeClient(db, sqlModel)
}

const iso = (d: Date) => d.toISOString().replace('Z', '')

describe('setPlan writes both tables in one call', () => {
  beforeEach(() => world())

  it('admin assigns Enterprise with an end date: subscription + profiles.tier', async () => {
    const end = new Date(Date.now() + 90 * 864e5)
    const r = await setPlan({ userId: USER, tier: 'enterprise', periodEnd: end, source: 'admin', actor: ADMIN, note: 'договор №7' })

    expect(r.applied).toBe(true)
    expect(db.rpcCalls).toHaveLength(1)
    expect(db.rpcCalls[0].args).toMatchObject({
      p_org_id: COMPANY, // the company tenant key, like the checkout
      p_user_id: USER,
      p_tier: 'enterprise',
      p_source: 'admin',
      p_note: 'договор №7',
      p_actor: ADMIN.id,
      p_period_end: end.toISOString(),
    })
    expect(db.tables.subscriptions[0]).toMatchObject({ orgId: COMPANY, tier: 'enterprise', status: 'active', source: 'admin' })
    expect(db.tables.profiles[0].tier).toBe('pro')
    expect(r.after).toMatchObject({ tier: 'enterprise', status: 'active', source: 'admin', accessTier: 'pro' })
  })

  it('downgrade to free cancels the subscription and closes access', async () => {
    world({ tier: 'pro', subscriptions: [{ orgId: COMPANY, tier: 'pro', status: 'active', currentPeriodEnd: null, updatedAt: iso(new Date()) }] })
    const r = await setPlan({ userId: USER, tier: 'free', source: 'admin', actor: ADMIN })
    expect(db.tables.subscriptions[0].status).toBe('canceled')
    expect(db.tables.profiles[0].tier).toBe('free')
    expect(r.after).toMatchObject({ tier: 'free', status: 'canceled', accessTier: 'free' })
  })

  it('journals an admin change BEFORE the write, with old and new value', async () => {
    await setPlan({ userId: USER, tier: 'pro', periodEnd: null, source: 'admin', actor: ADMIN })
    expect(db.log).toEqual(['audit:billing.plan_changed', 'rpc:billing_set_plan'])
    const entry = db.tables.admin_audit_log[0]
    expect(entry).toMatchObject({ actor_id: ADMIN.id, target_user_id: USER, entity_type: 'user' })
    expect(entry.old_value).toMatchObject({ tier: 'free' })
    expect(entry.new_value).toMatchObject({ tier: 'pro', access_tier: 'pro', source: 'admin' })
  })

  it('refuses an admin change when the journal is unavailable — nothing is written', async () => {
    db.auditFails = true
    await expect(setPlan({ userId: USER, tier: 'pro', source: 'admin', actor: ADMIN })).rejects.toMatchObject({ code: 'audit_unavailable' })
    expect(db.rpcCalls).toHaveLength(0)
    expect(db.tables.profiles[0].tier).toBe('free')
  })

  it('a Kaspi payment is applied even when the journal is down (audit after, best effort)', async () => {
    db.auditFails = true
    const r = await setPlan({ orgId: COMPANY, tier: 'pro', periodEnd: addMonths(new Date(), 1), source: 'kaspi', provider: 'kaspi', actor: KASPI_WEBHOOK_ACTOR })
    expect(r.applied).toBe(true)
    expect(db.rpcCalls[0].args).toMatchObject({ p_org_id: COMPANY, p_user_id: USER, p_provider: 'kaspi' })
    expect(db.tables.profiles[0].tier).toBe('pro')
  })

  it('a trial needs an end date; unknown tiers are refused', async () => {
    await expect(setPlan({ userId: USER, tier: 'pilot', source: 'trial', actor: ADMIN })).rejects.toBeInstanceOf(BillingError)
    await expect(setPlan({ userId: USER, tier: 'gold' as never, source: 'admin', actor: ADMIN })).rejects.toMatchObject({ code: 'invalid' })
    expect(db.rpcCalls).toHaveLength(0)
  })

  it('reports a missing migration 106 honestly', async () => {
    state.client = fakeClient(db, () => ({ error: { code: 'PGRST202', message: 'Could not find the function public.billing_set_plan' } }))
    await expect(setPlan({ userId: USER, tier: 'pro', source: 'admin', actor: ADMIN })).rejects.toMatchObject({ code: 'migration_106_required' })
  })

  it('404 for an unknown person', async () => {
    await expect(setPlan({ userId: '99999999-2222-3333-4444-555555555555', tier: 'pro', source: 'admin', actor: ADMIN }))
      .rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('expireDuePlans', () => {
  it('downgrades an ended trial once; a second run does nothing (idempotent)', async () => {
    world({ tier: 'pro', subscriptions: [{ orgId: COMPANY, tier: 'pilot', status: 'trialing', trialEndsAt: iso(new Date(Date.now() - 864e5)), updatedAt: iso(new Date()) }] })

    const first = await expireDuePlans()
    expect(first).toEqual({ due: 1, downgraded: 1, skipped: 0, failed: 0 })
    expect(db.tables.subscriptions[0]).toMatchObject({ status: 'canceled', source: 'system', assignedBy: 'system:billing-expiry' })
    expect(db.tables.profiles[0].tier).toBe('free')
    expect(db.tables.admin_audit_log.map((a) => a.action)).toEqual(['billing.plan_expired'])
    expect(db.tables.admin_audit_log[0]).toMatchObject({ actor_id: 'system:billing-expiry', actor_kind: 'system' })
    expect(db.rpcCalls.find((c) => c.name === 'billing_set_plan')?.args.p_only_if_expired).toBe(true)

    const second = await expireDuePlans()
    expect(second).toEqual({ due: 0, downgraded: 0, skipped: 0, failed: 0 })
    expect(db.tables.admin_audit_log).toHaveLength(1)
  })

  it('leaves live and open-ended plans alone', async () => {
    world({
      tier: 'pro',
      subscriptions: [{ orgId: COMPANY, tier: 'pro', status: 'active', currentPeriodEnd: iso(new Date(Date.now() + 864e5)), updatedAt: iso(new Date()) }],
    })
    expect(await expireDuePlans()).toEqual({ due: 0, downgraded: 0, skipped: 0, failed: 0 })
    expect(db.tables.profiles[0].tier).toBe('pro')
  })

  it('does not journal or write when the row was extended after it was listed', async () => {
    world({ tier: 'pro', subscriptions: [{ orgId: COMPANY, tier: 'pro', status: 'active', currentPeriodEnd: iso(new Date(Date.now() + 864e5)), updatedAt: iso(new Date()) }] })
    // The due list is stale: it still names the row.
    state.client = fakeClient(db, (name, args, d) =>
      name === 'billing_due_expirations'
        ? { data: [{ org_id: COMPANY, user_id: USER, tier: 'pro', status: 'active', ends_at: null }] }
        : sqlModel(name, args, d))
    expect(await expireDuePlans()).toEqual({ due: 1, downgraded: 0, skipped: 1, failed: 0 })
    expect(db.tables.admin_audit_log).toHaveLength(0)
    expect(db.rpcCalls.filter((c) => c.name === 'billing_set_plan')).toHaveLength(0)
  })
})

describe('effective plan', () => {
  it('a plan assigned in GIGA before migration 106 (profiles.tier only) reads as Pro by the administrator', async () => {
    world({ tier: 'pro' })
    const plan = await getEffectivePlan({ userId: USER })
    expect(plan).toMatchObject({ tier: 'pro', status: 'active', source: 'admin', periodEnd: null })
  })

  it('a row past its end is "expired" until the job runs', () => {
    const sub = toSubscriptionRecord({ orgId: 'o', tier: 'pro', status: 'active', currentPeriodEnd: '2020-01-01T00:00:00', updatedAt: null })
    expect(effectivePlan(sub, 'pro').status).toBe('expired')
  })

  it('names the source of legacy rows from what they hold', () => {
    const kaspi = toSubscriptionRecord({ orgId: 'o', tier: 'pro', status: 'active', provider: 'kaspi' })
    const trial = toSubscriptionRecord({ orgId: 'o', tier: 'pilot', status: 'trialing', trialEndsAt: '2999-01-01T00:00:00' })
    expect(effectivePlan(kaspi, 'pro').source).toBe('kaspi')
    expect(effectivePlan(trial, 'pro').source).toBe('trial')
  })

  it('reads TIMESTAMP WITHOUT TIME ZONE as UTC', () => {
    expect(utcIso('2026-11-06T10:00:00')).toBe('2026-11-06T10:00:00.000Z')
    expect(utcIso('2026-11-06 10:00:00.123')).toBe('2026-11-06T10:00:00.123Z')
    expect(utcIso('2026-11-06T10:00:00+05:00')).toBe('2026-11-06T05:00:00.000Z')
  })

  it('addMonths clamps to the end of a shorter month', () => {
    expect(addMonths(new Date('2026-01-31T12:00:00Z'), 1).toISOString()).toBe('2026-02-28T12:00:00.000Z')
    expect(addMonths(new Date('2026-10-06T00:00:00Z'), 12).toISOString()).toBe('2027-10-06T00:00:00.000Z')
  })
})
