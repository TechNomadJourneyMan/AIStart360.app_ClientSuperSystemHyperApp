export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { recordAdminAction } from '@/lib/admin/audit'
import { createServiceClient } from '@/lib/supabase-service'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { sendPlatformInvite } from '@/lib/admin/invites'
import { normalizeEmail } from '@/lib/admin/invite-shared'
import { OPEN_REQUEST_STATUSES } from '@/lib/access/upgrade-requests'
import { isInviteRequestRow } from '@/lib/registration/invite-request-shared'

/**
 * POST /api/giga-admin/requests/:id/invite — «Отправить приглашение» по запросу
 * приглашения (Раунд 4, B3, N4B-3).
 *
 * Тот же поток и те же права, что у «Приглашения» (POST /api/giga-admin/invites:
 * users.invite, lib/admin/invites.ts sendPlatformInvite, запись user.invited в
 * журнале — оттуда строится список приглашений). Почта берётся из заявки на
 * сервере — её не видит в карточке сотрудник без users.sensitive.
 *
 * Одна отправка на заявку: сначала заявка атомарно закрывается («принята»), и
 * только победитель шлёт письмо; письмо не ушло — заявка снова открыта.
 */
const OPEN = [...OPEN_REQUEST_STATUSES] as string[]

interface InviteRow {
  id: string
  type: string | null
  source: string | null
  status: string | null
  payload: Record<string, unknown> | null
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireGiga(req, 'users.invite')
  if (guard.response) return guard.response
  const actor = guard.actor

  if (await isRateLimitedKey(actor.id, 'giga-invites', { max: 100, windowMs: 60 * 60_000 })) {
    return NextResponse.json({ ok: false, error: 'Слишком много приглашений за час. Попробуйте позже.' }, { status: 429 })
  }

  const sb = createServiceClient()
  const { data, error } = await sb
    .from('admin_requests')
    .select('id, type, source, status, payload')
    .eq('id', params.id)
    .maybeSingle()
  if (error) {
    console.error('[giga-admin/requests/:id/invite] read failed:', error.message)
    return NextResponse.json({ ok: false, error: 'Не удалось прочитать заявку' }, { status: 500 })
  }
  const row = data as InviteRow | null
  if (!row || !isInviteRequestRow(row)) {
    return NextResponse.json({ ok: false, error: 'Запрос приглашения не найден' }, { status: 404 })
  }
  const payload = row.payload ?? {}
  const email = normalizeEmail(typeof payload.email === 'string' ? payload.email : '')
  if (!email) return NextResponse.json({ ok: false, error: 'В заявке нет корректной почты' }, { status: 422 })
  if (!OPEN.includes(String(row.status ?? ''))) {
    return NextResponse.json({ ok: false, error: 'Заявка уже разобрана — обновите список' }, { status: 409 })
  }

  // Claim: only the request that moves open → approved sends the letter.
  const nowIso = new Date().toISOString()
  const { data: claimed, error: claimErr } = await sb
    .from('admin_requests')
    .update({ status: 'approved', updatedAt: nowIso })
    .eq('id', row.id)
    .in('status', OPEN)
    .select('id')
  if (claimErr) {
    console.error('[giga-admin/requests/:id/invite] claim failed:', claimErr.message)
    return NextResponse.json({ ok: false, error: 'Не удалось обновить заявку' }, { status: 500 })
  }
  if (!Array.isArray(claimed) || claimed.length === 0) {
    return NextResponse.json({ ok: false, error: 'Заявка уже разобрана — обновите список' }, { status: 409 })
  }

  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const result = await sendPlatformInvite({
    email,
    name: str(payload.name),
    company: str(payload.company),
    invitedById: actor.id,
    invitedByLabel: actor.email ?? null,
  })

  if (result.outcome === 'failed') {
    // The letter did not leave: the request is open again, the colleague can retry.
    await sb.from('admin_requests').update({ status: 'new', updatedAt: new Date().toISOString() }).eq('id', row.id).eq('status', 'approved')
    return NextResponse.json({ ok: false, error: `Приглашение не отправлено: ${result.message}` }, { status: 502 })
  }

  await sb
    .from('admin_requests')
    .update({ payload: { ...payload, invitedAt: nowIso, invitedBy: actor.id, inviteOutcome: result.outcome }, updatedAt: new Date().toISOString() })
    .eq('id', row.id)
  // Like POST /api/giga-admin/invites: the list «Приглашения» is built from these entries.
  await recordAdminAction(actor, {
    action: 'user.invited',
    entityType: 'invite',
    entityId: result.email,
    metadata: { outcome: result.outcome, note: null, company: str(payload.company), staffRole: null, fromRequest: row.id },
  }, req)

  return NextResponse.json({ ok: true, outcome: result.outcome, message: result.message })
}
