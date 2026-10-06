/**
 * Signed link to one report version (/r/v/<token>, lib/reports/version-link.ts):
 * HMAC-signed, expiring, bound to the version id and number, never accepted
 * for another token type; and only a version that was published (and not
 * withdrawn) opens for a client. The new 'rv' type did not exist before 103.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { signToken } from '@/lib/security/signed-token'
import { signVersionLink, verifyVersionLink, versionOpensForClient, VERSION_LINK_MAX_DAYS } from '@/lib/reports/version-link'
import { canReviewReports } from '@/lib/reports/review-flow'
import { hasPermission } from '@/lib/admin/rbac'

const VID = '11111111-2222-4333-8444-555555555555'
const saved = { secret: process.env.GIGA_COOKIE_SECRET, url: process.env.NEXT_PUBLIC_APP_URL }

beforeAll(() => {
  process.env.GIGA_COOKIE_SECRET = 'test-secret-for-version-links-0123456789'
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.aistart360.test'
})
afterAll(() => {
  if (saved.secret === undefined) delete process.env.GIGA_COOKIE_SECRET
  else process.env.GIGA_COOKIE_SECRET = saved.secret
  if (saved.url === undefined) delete process.env.NEXT_PUBLIC_APP_URL
  else process.env.NEXT_PUBLIC_APP_URL = saved.url
})

describe('version link token', () => {
  it('round-trips the version id and number and points at /r/v/<token>', async () => {
    const link = await signVersionLink(VID, 3, 30)
    expect(link.url).toBe(`https://app.aistart360.test/r/v/${link.token}`)
    expect(await verifyVersionLink(link.token)).toMatchObject({ ok: true, versionId: VID, version: 3 })
  })

  it('expires', async () => {
    const { token } = await signVersionLink(VID, 3, 1)
    expect(await verifyVersionLink(token, Date.now() + 2 * 86_400_000)).toEqual({ ok: false, reason: 'expired' })
  })

  it('caps the lifetime', async () => {
    const link = await signVersionLink(VID, 3, 10_000)
    const days = (new Date(link.expiresAt).getTime() - Date.now()) / 86_400_000
    expect(days).toBeLessThanOrEqual(VERSION_LINK_MAX_DAYS + 0.01)
  })

  it('rejects a tampered payload or signature, another secret, and tokens of another type', async () => {
    const { token } = await signVersionLink(VID, 3)
    const [v, body, sig] = token.split('.')
    const forgedBody = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), vid: '99999999-2222-4333-8444-555555555555' })).toString('base64url')
    expect((await verifyVersionLink(`${v}.${forgedBody}.${sig}`)).ok).toBe(false)
    expect((await verifyVersionLink(`${v}.${body}.${sig.slice(0, -2)}AA`)).ok).toBe(false)
    expect((await verifyVersionLink('garbage')).ok).toBe(false)

    const staffToken = await signToken('staff', { sub: VID }, 600)
    expect((await verifyVersionLink(staffToken)).ok).toBe(false)

    process.env.GIGA_COOKIE_SECRET = 'another-secret-entirely-0123456789abcdef'
    expect(await verifyVersionLink(token)).toEqual({ ok: false, reason: 'signature' })
    process.env.GIGA_COOKIE_SECRET = 'test-secret-for-version-links-0123456789'
  })

  it('opens only published (or published-then-replaced) versions, never in_review / rejected / withdrawn', () => {
    expect(versionOpensForClient({ status: 'published', published_at: '2026-10-06' })).toBe(true)
    expect(versionOpensForClient({ status: 'superseded', published_at: '2026-10-06', provenance: {} })).toBe(true)
    expect(versionOpensForClient({ status: 'in_review', published_at: null })).toBe(false)
    expect(versionOpensForClient({ status: 'ready', published_at: null })).toBe(false)
    expect(versionOpensForClient({ status: 'superseded', published_at: null, provenance: { review: { action: 'changes_requested' } } })).toBe(false)
    expect(versionOpensForClient({ status: 'superseded', published_at: '2026-10-06', provenance: { review: { action: 'withdraw' } } })).toBe(false)
  })
})

describe('who may decide on a report under review', () => {
  it('reports.review: expert / admin / super_admin profiles and the super_expert, admin, super_admin staff roles', () => {
    expect(hasPermission('super_expert', 'reports.review')).toBe(true)
    expect(hasPermission('admin', 'reports.review')).toBe(true)
    expect(hasPermission('super_admin', 'reports.review')).toBe(true)
    for (const r of ['crm_manager', 'content_manager', 'analyst', 'support'] as const) expect(hasPermission(r, 'reports.review'), r).toBe(false)
    // SuperExpert decides on in_review versions but does not get the wider reports.publish.
    expect(hasPermission('super_expert', 'reports.publish')).toBe(false)

    expect(canReviewReports({ profileRole: 'expert', staffRole: null })).toBe(true)
    expect(canReviewReports({ profileRole: 'client', staffRole: 'super_expert' })).toBe(true)
    expect(canReviewReports({ profileRole: 'client', staffRole: 'crm_manager' })).toBe(false)
    expect(canReviewReports({ profileRole: 'client', staffRole: null })).toBe(false)
    expect(canReviewReports({ profileRole: 'owner', staffRole: 'bogus' })).toBe(false)
  })
})
