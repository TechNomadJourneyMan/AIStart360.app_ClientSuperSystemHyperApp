export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { testProvider } from '@/lib/crm/provider-client'
import { sealCrmToken } from '@/lib/crm/token-store'
import { parseJsonBody } from '@/lib/validation/http'
import { CrmConnectionBody } from '@/lib/validation/schemas'

// Никогда не отдаём access_token наружу.
const SAFE_COLUMNS =
  'id, provider, base_url, connection_name, is_active, last_sync_at, last_sync_status, last_sync_error, synced_deals, synced_contacts, created_at'

/** GET — список СВОИХ подключений (без токенов). RLS скоупит на пользователя. */
export async function GET() {
  const sb = createServerClient()
  const {
    data: { user },
  } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const { data, error } = await sb
    .from('crm_provider_connections')
    .select(SAFE_COLUMNS)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
  if (error) {
    // Таблицы ещё нет (миграция 046 не применена) → честный пустой список,
    // вкладка «CRM» остаётся рабочей; прочие ошибки — настоящий 500.
    const e = error as { message?: string; code?: string }
    const sig = `${e.code ?? ''} ${e.message ?? ''}`
    if (/does not exist|PGRST205|42P01/i.test(sig)) {
      return NextResponse.json({ ok: true, data: [], unavailable: true })
    }
    console.error('[crm/connections GET]', error)
    return NextResponse.json({ ok: false, error: 'db_error' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, data: data ?? [] })
}

/** POST — подключить/обновить провайдера: валидация → testConnection → upsert. */
export async function POST(req: NextRequest) {
  const sb = createServerClient()
  const {
    data: { user },
  } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  // R-149: { provider, base_url, access_token, connection_name? } only; a bad
  // body keeps its historical 422 (a non-string field used to be a 500).
  const parsed = await parseJsonBody(req, CrmConnectionBody, { status: 422 })
  if (!parsed.ok) return parsed.response
  const body = parsed.data
  const provider = body.provider
  const baseUrl = body.base_url
  const token = body.access_token

  // Честная проверка связи до сохранения — не даём «подключить» нерабочий токен.
  // testProvider сначала проверяет домен (allowlist CRM + только публичные адреса).
  const test = await testProvider(provider, baseUrl, token)
  if (!test.ok) {
    return NextResponse.json({ ok: false, error: test.error ?? 'Не удалось подключиться к CRM' }, { status: 400 })
  }

  const { data, error } = await sb
    .from('crm_provider_connections')
    .upsert(
      {
        user_id: user.id,
        provider,
        base_url: baseUrl,
        access_token: sealCrmToken(token),
        connection_name: body.connection_name || null,
        is_active: true,
        last_sync_status: null,
        last_sync_error: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,provider' },
    )
    .select(SAFE_COLUMNS)
    .maybeSingle()
  if (error) {
    console.error('[crm/connections POST]', error)
    return NextResponse.json({ ok: false, error: 'db_error' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, data })
}
