/**
 * lib/reports/version-link.ts — an expiring link to ONE report version:
 * `/r/v/<token>` (page) and `/r/v/<token>/pdf` (its PDF).
 *
 * Stateless: the token is the HMAC-signed claim set of lib/security/signed-token
 * (type 'rv', key GIGA_COOKIE_SECRET / AUTH_SECRET) carrying the version id,
 * its number and the expiry. Nothing is stored; a changed secret invalidates
 * every link. The link is a bearer link like the existing share links
 * (/r/<token>): whoever holds it reads that version until it expires.
 *
 * It only ever opens a version that was published to the client and was not
 * withdrawn: an in_review / draft / ready / rejected version never opens,
 * whatever token is presented — the status is checked on every request, so a
 * link minted for a version that is later withdrawn stops working at once.
 */
import { signToken, verifyToken } from '@/lib/security/signed-token'
import { getSiteUrl } from '@/lib/site-url'
import type { ReportVersionFull } from './versions'

export const VERSION_LINK_DEFAULT_DAYS = 30
export const VERSION_LINK_MAX_DAYS = 90
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface VersionLinkClaims {
  vid: string
  /** report_versions.version, shown before the row is read. */
  n: number
  [k: string]: unknown
}

export function linkSecretConfigured(): boolean {
  return Boolean(process.env.GIGA_COOKIE_SECRET || process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET)
}

export async function signVersionLink(versionId: string, version: number, days = VERSION_LINK_DEFAULT_DAYS): Promise<{ token: string; url: string; expiresAt: string }> {
  if (!UUID.test(versionId)) throw new Error('bad version id')
  const ttlDays = Math.min(Math.max(1, Math.floor(days)), VERSION_LINK_MAX_DAYS)
  const token = await signToken<VersionLinkClaims>('rv', { vid: versionId.toLowerCase(), n: version }, ttlDays * 86_400)
  const expiresAt = new Date(Date.now() + ttlDays * 86_400_000).toISOString()
  return { token, url: getSiteUrl(`/r/v/${token}`), expiresAt }
}

export type VersionLinkCheck =
  | { ok: true; versionId: string; version: number; expiresAt: string }
  | { ok: false; reason: 'malformed' | 'signature' | 'expired' }

export async function verifyVersionLink(token: string | null | undefined, nowMs = Date.now()): Promise<VersionLinkCheck> {
  const v = await verifyToken<VersionLinkClaims>('rv', token, nowMs)
  if (!v.ok) return { ok: false, reason: v.reason === 'expired' ? 'expired' : v.reason === 'signature' ? 'signature' : 'malformed' }
  if (typeof v.claims.vid !== 'string' || !UUID.test(v.claims.vid) || !Number.isInteger(v.claims.n)) return { ok: false, reason: 'malformed' }
  return { ok: true, versionId: v.claims.vid, version: Number(v.claims.n), expiresAt: new Date(v.claims.exp * 1000).toISOString() }
}

/**
 * May a client-facing link show this version? Published now, or published
 * earlier and later replaced by a newer publication (still the same frozen
 * document) — but never withdrawn, never unpublished.
 */
export function versionOpensForClient(v: { status: string; published_at: string | Date | null; provenance?: unknown }): boolean {
  if (v.status === 'published') return true
  if (v.status !== 'superseded' || !v.published_at) return false
  const review = (v.provenance as { review?: { action?: string } } | null)?.review
  return review?.action !== 'withdraw'
}

/**
 * Token → the version it names, only when it may be shown to a client
 * (versionOpensForClient). One answer for every failure, so a link never
 * tells whether a version exists or why it does not open.
 */
export async function resolveVersionLink(token: string | null | undefined): Promise<
  | { ok: true; version: ReportVersionFull; expiresAt: string }
  | { ok: false }
> {
  const check = await verifyVersionLink(token)
  if (!check.ok) return { ok: false }
  const { getReportVersion } = await import('./versions')
  const v = await getReportVersion(check.versionId)
  if (!v || v.version !== check.version || !versionOpensForClient(v)) return { ok: false }
  return { ok: true, version: v, expiresAt: check.expiresAt }
}
