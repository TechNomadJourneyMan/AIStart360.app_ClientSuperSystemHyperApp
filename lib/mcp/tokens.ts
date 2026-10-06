/**
 * lib/mcp/tokens.ts — personal access tokens (stage 1 of the owner decision).
 *
 * A token is created by its owner (GIGA «MCP-доступ», the expert portal or
 * the admin bot), shown ONCE, and stored as SHA-256 only (mcp_tokens, 101).
 * Scopes are limited to what the creator's role allows at creation time and
 * re-checked against the CURRENT role on every call (lib/mcp/auth.ts).
 */
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/db'
import { displayPrefix, looksLike, newSecret, sha256Hex } from './crypto'
import { normalizeScopes, type McpScope } from './scopes'
import type { McpPrincipal } from './principal'

/** Lifetimes offered in the UI and the bot (days). Tokens never live forever. */
export const PAT_EXPIRY_DAYS = [7, 30, 90, 365] as const
export const MAX_ACTIVE_PATS = 20

export interface PatRow {
  id: string
  name: string
  prefix: string
  scopes: string[]
  createdVia: string
  expiresAt: Date
  revokedAt: Date | null
  lastUsedAt: Date | null
  createdAt: Date
}

export type CreatePatError = 'bad_name' | 'bad_scopes' | 'scopes_not_allowed' | 'bad_expiry' | 'too_many'

export interface CreatePatInput {
  principal: McpPrincipal
  name: string
  scopes: readonly unknown[]
  expiresInDays: number
  via: 'giga' | 'expert' | 'telegram'
  /** Pre-generated id, so a caller can write its audit row before the token exists. */
  id?: string
}

/** Validate a create request without touching the database. */
export function validatePatInput(input: Omit<CreatePatInput, 'id'>): { ok: true; name: string; scopes: McpScope[] } | { ok: false; error: CreatePatError } {
  const name = typeof input.name === 'string' ? input.name.replace(/\s+/g, ' ').trim() : ''
  if (name.length < 1 || name.length > 80) return { ok: false, error: 'bad_name' }
  const scopes = normalizeScopes(input.scopes)
  if (!scopes || scopes.length === 0) return { ok: false, error: 'bad_scopes' }
  if (!scopes.every((s) => input.principal.allowed.includes(s))) return { ok: false, error: 'scopes_not_allowed' }
  if (!(PAT_EXPIRY_DAYS as readonly number[]).includes(input.expiresInDays)) return { ok: false, error: 'bad_expiry' }
  return { ok: true, name, scopes }
}

export async function createPat(input: CreatePatInput): Promise<{ ok: true; token: string; row: PatRow } | { ok: false; error: CreatePatError }> {
  const v = validatePatInput(input)
  if (!v.ok) return v
  const [{ n }] = await prisma.$queryRaw<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM public.mcp_tokens
    WHERE user_id = ${input.principal.userId}::uuid AND revoked_at IS NULL AND expires_at > now()`
  if (n >= MAX_ACTIVE_PATS) return { ok: false, error: 'too_many' }
  const token = newSecret('pat')
  const id = input.id ?? randomUUID()
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    INSERT INTO public.mcp_tokens (id, user_id, name, token_hash, prefix, scopes, created_via, expires_at)
    VALUES (${id}::uuid, ${input.principal.userId}::uuid, ${v.name}, ${sha256Hex(token)}, ${displayPrefix(token)},
            ${v.scopes}::text[], ${input.via}, now() + make_interval(days => ${input.expiresInDays}::int))
    RETURNING id::text, name, prefix, scopes, created_via, expires_at, revoked_at, last_used_at, created_at`
  return { ok: true, token, row: toRow(rows[0]) }
}

function toRow(r: Record<string, unknown>): PatRow {
  return {
    id: String(r.id),
    name: String(r.name),
    prefix: String(r.prefix),
    scopes: (r.scopes as string[]) ?? [],
    createdVia: String(r.created_via),
    expiresAt: r.expires_at as Date,
    revokedAt: (r.revoked_at as Date | null) ?? null,
    lastUsedAt: (r.last_used_at as Date | null) ?? null,
    createdAt: r.created_at as Date,
  }
}

/** The owner's tokens, newest first (active and recently ended ones). Never returns hashes. */
export async function listPats(userId: string, opts: { includeEnded?: boolean } = {}): Promise<PatRow[]> {
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT id::text, name, prefix, scopes, created_via, expires_at, revoked_at, last_used_at, created_at
    FROM public.mcp_tokens
    WHERE user_id = ${userId}::uuid
      AND (${opts.includeEnded ?? false} OR (revoked_at IS NULL AND expires_at > now()))
    ORDER BY created_at DESC
    LIMIT 100`
  return rows.map(toRow)
}

/** Revoke one of the owner's tokens. false = not found / not theirs / already revoked. */
export async function revokePat(userId: string, id: string, revokedBy: string = userId): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return false
  const n = await prisma.$executeRaw`
    UPDATE public.mcp_tokens SET revoked_at = now(), revoked_by = ${revokedBy}::uuid
    WHERE id = ${id}::uuid AND user_id = ${userId}::uuid AND revoked_at IS NULL`
  return n > 0
}

export interface ActivePat { id: string; userId: string; scopes: string[]; expiresAt: Date }

/** Look up a presented token: active (not revoked, not expired) or null. */
export async function findActivePat(token: string): Promise<ActivePat | null> {
  if (!looksLike('pat', token)) return null
  const rows = await prisma.$queryRaw<Array<{ id: string; user_id: string; scopes: string[]; expires_at: Date }>>`
    SELECT id::text, user_id::text, scopes, expires_at FROM public.mcp_tokens
    WHERE token_hash = ${sha256Hex(token)} AND revoked_at IS NULL AND expires_at > now()`
  const r = rows[0]
  return r ? { id: r.id, userId: r.user_id, scopes: r.scopes, expiresAt: r.expires_at } : null
}

/** Record use, at most once a minute per token (keeps the hot path to one cheap UPDATE). */
export async function touchPat(id: string, ipHash: string | null): Promise<void> {
  await prisma.$executeRaw`
    UPDATE public.mcp_tokens SET last_used_at = now(), last_used_ip_hash = ${ipHash}
    WHERE id = ${id}::uuid AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')`
}
