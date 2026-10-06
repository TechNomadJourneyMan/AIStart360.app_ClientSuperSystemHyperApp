/**
 * /api/mcp/tokens — the caller's own MCP credentials.
 *
 *   GET   personal tokens (metadata only, never a hash), active OAuth
 *         sign-ins, the scopes the caller's role allows, expiry choices.
 *   POST  { name, scopes[], expires_in_days } → the new token, shown ONCE.
 *         Scopes must be a subset of what the caller's role allows; the
 *         staff audit journal row is written before the token exists.
 * Staff (GIGA, second factor passed) and experts (expert portal) only —
 * lib/mcp/manage.ts.
 */
import { randomUUID } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { recordAdminAction } from '@/lib/admin/audit'
import { resolveTokenManager } from '@/lib/mcp/manage'
import { listOAuthGrants } from '@/lib/mcp/oauth'
import { SCOPE_DEFS } from '@/lib/mcp/scopes'
import { createPat, listPats, PAT_EXPIRY_DAYS, type CreatePatError } from '@/lib/mcp/tokens'
import { mcpResourceUrl, publicOrigin } from '@/lib/mcp/urls'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CREATE_ERRORS: Record<CreatePatError, string> = {
  bad_name: 'Название: от 1 до 80 символов',
  bad_scopes: 'Выберите хотя бы одно право из списка',
  scopes_not_allowed: 'Можно выдать токену только права вашей роли',
  bad_expiry: `Срок действия: ${PAT_EXPIRY_DAYS.join(', ')} дней`,
  too_many: 'Слишком много активных токенов — отзовите ненужные',
}

export async function GET(req: NextRequest) {
  const r = await resolveTokenManager(req)
  if ('response' in r) return r.response
  const { principal, canCreate } = r.manager
  try {
    const [items, oauth] = await Promise.all([listPats(principal.userId, { includeEnded: true }), listOAuthGrants(principal.userId)])
    return NextResponse.json({
      ok: true,
      items,
      oauth,
      allowedScopes: principal.allowed.map((s) => ({ scope: s, label: SCOPE_DEFS[s].label, description: SCOPE_DEFS[s].description })),
      expiryDays: PAT_EXPIRY_DAYS,
      canCreate: canCreate && principal.allowed.length > 0,
      mcpUrl: mcpResourceUrl(publicOrigin(req.headers, req.url)),
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ ok: false, error: 'Не удалось загрузить токены (применена ли миграция 101?)' }, { status: 500 })
  }
}

const createSchema = z.object({
  name: z.string().max(200),
  scopes: z.array(z.string().max(40)).max(20),
  expires_in_days: z.number().int(),
}).strict()

export async function POST(req: NextRequest) {
  const r = await resolveTokenManager(req)
  if ('response' in r) return r.response
  const { principal, canCreate, via, auditActor } = r.manager
  if (!canCreate) return NextResponse.json({ ok: false, error: 'Создать токен можно только из своей сессии (не в режиме входа от имени клиента)' }, { status: 403 })
  const parsed = createSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Некорректные данные' }, { status: 400 })

  const id = randomUUID()
  try {
    await recordAdminAction(auditActor, {
      action: 'mcp.token.create',
      entityType: 'mcp_token',
      entityId: id,
      targetUserId: principal.userId,
      newValue: { name: parsed.data.name.slice(0, 80), scopes: parsed.data.scopes, expires_in_days: parsed.data.expires_in_days, via },
    }, req, { required: true })
  } catch {
    return NextResponse.json({ ok: false, error: 'Журнал аудита недоступен — токен не создан' }, { status: 503 })
  }
  try {
    const res = await createPat({
      principal, name: parsed.data.name, scopes: parsed.data.scopes, expiresInDays: parsed.data.expires_in_days, via, id,
    })
    if (!res.ok) return NextResponse.json({ ok: false, error: CREATE_ERRORS[res.error] }, { status: 400 })
    return NextResponse.json({ ok: true, token: res.token, item: res.row }, { status: 201, headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ ok: false, error: 'Не удалось создать токен' }, { status: 500 })
  }
}
