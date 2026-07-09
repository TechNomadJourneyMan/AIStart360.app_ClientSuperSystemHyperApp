export const dynamic = 'force-dynamic'
// Синк тянет до 500 записей из внешней CRM — даём больше времени.
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { fetchProviderRecords } from '@/lib/crm/provider-client'
import { mapProviderRecords } from '@/lib/crm/provider-sync'
import type { CrmProvider } from '@/lib/crm/types'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CHUNK = 200
const MAX_RECORDS = 500

/**
 * POST — синхронизировать СВОЁ подключение: тянем контакты+сделки, маппим в
 * clients-черновики и upsert-им в crm_clients по телефону (паттерн импорта).
 * RLS скоупит и подключение, и клиентов на пользователя.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const sb = createServerClient()
  const {
    data: { user },
  } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 })
  }

  const { data: conn } = await sb
    .from('crm_provider_connections')
    .select('id, provider, base_url, access_token')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!conn) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })

  const provider = conn.provider as CrmProvider

  let contacts, deals
  try {
    ;({ contacts, deals } = await fetchProviderRecords(
      provider,
      conn.base_url as string,
      conn.access_token as string,
      MAX_RECORDS,
    ))
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'sync failed'
    await sb
      .from('crm_provider_connections')
      .update({ last_sync_at: new Date().toISOString(), last_sync_status: 'error', last_sync_error: msg })
      .eq('id', conn.id)
      .eq('user_id', user.id)
    return NextResponse.json({ ok: false, error: 'Не удалось получить данные из CRM' }, { status: 502 })
  }

  const drafts = mapProviderRecords(provider, contacts, deals).slice(0, MAX_RECORDS)

  let inserted = 0
  let updated = 0
  let skipped = 0

  // Уже существующие телефоны → карта phone -> id (чанками, как в import-роуте).
  const phones = drafts.map((d) => d.phone).filter((p): p is string => !!p)
  const existing = new Map<string, string>()
  for (let i = 0; i < phones.length; i += CHUNK) {
    const slice = phones.slice(i, i + CHUNK)
    const { data: rows, error } = await sb
      .from('crm_clients')
      .select('id, phone')
      .eq('user_id', user.id)
      .in('phone', slice)
    if (error) return NextResponse.json({ ok: false, error: 'db_error' }, { status: 500 })
    for (const r of rows ?? []) if (r.phone) existing.set(r.phone as string, r.id as string)
  }

  const toInsert = drafts.filter((d) => !(d.phone && existing.has(d.phone)))
  const toUpdate = drafts.filter((d) => d.phone && existing.has(d.phone))

  for (let i = 0; i < toInsert.length; i += CHUNK) {
    const slice = toInsert.slice(i, i + CHUNK)
    const { data, error } = await sb
      .from('crm_clients')
      .insert(
        slice.map((d) => ({
          user_id: user.id,
          name: d.name,
          phone: d.phone,
          phone_raw: d.phone_raw,
          email: d.email,
          avg_check: d.avg_check,
          source: d.source,
        })),
      )
      .select('id')
    if (error) skipped += slice.length
    else inserted += data?.length ?? slice.length
  }

  // Обновляем только заполненные поля — не затираем ручные email/avg_check null-ом.
  for (const d of toUpdate) {
    const id = existing.get(d.phone as string)!
    const patch: Record<string, unknown> = { name: d.name, updated_at: new Date().toISOString() }
    if (d.phone_raw) patch.phone_raw = d.phone_raw
    if (d.email) patch.email = d.email
    if (d.avg_check != null) patch.avg_check = d.avg_check
    const { data, error } = await sb
      .from('crm_clients')
      .update(patch)
      .eq('id', id)
      .eq('user_id', user.id)
      .select('id')
    if (error || !data || data.length === 0) skipped++
    else updated++
  }

  await sb
    .from('crm_provider_connections')
    .update({
      last_sync_at: new Date().toISOString(),
      last_sync_status: 'ok',
      last_sync_error: null,
      synced_contacts: contacts.length,
      synced_deals: deals.length,
    })
    .eq('id', conn.id)
    .eq('user_id', user.id)

  return NextResponse.json({
    ok: true,
    data: { inserted, updated, skipped, fetchedContacts: contacts.length, fetchedDeals: deals.length },
  })
}
