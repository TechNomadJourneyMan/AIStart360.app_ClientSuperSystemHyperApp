export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { createServiceClient } from '@/lib/supabase-service'

/**
 * GET /api/giga-admin/users/:id/emails — что платформа писала этому человеку.
 *
 * Журнал `email_deliveries` ведётся с самого начала, но показать его было
 * негде: сотрудник не знал, дошло ли приглашение и напоминали ли уже.
 * Тело письма здесь не отдаём — только факт, вид и результат отправки.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireGiga(req, ['users.view', 'users.sensitive'])
  if (guard.response) return guard.response
  if (!UUID_RE.test(params.id)) return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 })

  const sb = createServiceClient()
  const { data: profile } = await sb.from('profiles').select('email').eq('id', params.id).maybeSingle()
  const email = (profile as { email?: string | null } | null)?.email ?? null

  // Письма ищем и по user_id, и по адресу: приглашение уходит ДО того, как у
  // человека появляется аккаунт, поэтому user_id у него пустой.
  let query = sb
    .from('email_deliveries')
    .select('id, kind, recipient, subject, status, provider_id, error, created_at')
    .order('created_at', { ascending: false })
    .limit(100)
  query = email ? query.or(`user_id.eq.${params.id},recipient.ilike.${email}`) : query.eq('user_id', params.id)

  const { data, error } = await query
  if (error) {
    // Таблицы может не быть, если миграция 081 ещё не применена — это не повод
    // ронять всю карточку пользователя.
    console.warn('[giga-admin/users/emails]', error.message)
    return NextResponse.json({ ok: true, data: [], unavailable: true })
  }
  return NextResponse.json({ ok: true, data: data ?? [] })
}
