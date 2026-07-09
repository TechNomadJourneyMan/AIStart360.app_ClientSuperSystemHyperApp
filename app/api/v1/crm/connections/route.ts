export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { testProvider } from '@/lib/crm/provider-client'
import type { CrmProvider } from '@/lib/crm/types'

const PROVIDERS: CrmProvider[] = ['bitrix24', 'amocrm']

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

  const body = (await req.json().catch(() => null)) as {
    provider?: string
    base_url?: string
    access_token?: string
    connection_name?: string
  } | null
  const provider = body?.provider as CrmProvider | undefined
  const baseUrl = body?.base_url?.trim()
  const token = body?.access_token?.trim()
  if (!provider || !PROVIDERS.includes(provider) || !baseUrl || !token) {
    return NextResponse.json({ ok: false, error: 'provider, base_url, access_token обязательны' }, { status: 422 })
  }

  // Честная проверка связи до сохранения — не даём «подключить» нерабочий токен.
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
        access_token: token,
        connection_name: body?.connection_name?.trim() || null,
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
