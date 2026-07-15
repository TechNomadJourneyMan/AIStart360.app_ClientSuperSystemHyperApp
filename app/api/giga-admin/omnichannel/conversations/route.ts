export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { isGigaSuperAdmin } from '@/lib/admin/giga-actor'
import {
  listDevelopmentAdminInbox,
  shouldUseDevelopmentAdminPostgres,
} from '@/lib/omnichannel/development-admin-postgres'
import { createServiceClient } from '@/lib/supabase-service'

const channels = new Set(['instagram', 'whatsapp'])
export async function GET(req: NextRequest) {
  if (!(await isGigaSuperAdmin(req))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const channel = req.nextUrl.searchParams.get('channel')
  if (channel && !channels.has(channel)) {
    return NextResponse.json({ error: 'Неизвестный канал' }, { status: 400 })
  }

  if (shouldUseDevelopmentAdminPostgres()) {
    try {
      const result = await listDevelopmentAdminInbox(
        channel as 'instagram' | 'whatsapp' | null,
        200,
      )
      return NextResponse.json(result)
    } catch {
      return NextResponse.json({ error: 'Не удалось собрать данные inbox' }, { status: 500 })
    }
  }

  const sb = createServiceClient()
  const [inboxResult, settingsResult] = await Promise.all([
    sb.rpc('list_omnichannel_inbox', { p_channel: channel, p_limit: 200 }),
    sb
      .from('omnichannel_settings')
      .select('channel, enabled, mode, business_context, automation_config, confidence_threshold, reply_delay_seconds')
      .order('channel'),
  ])

  if (inboxResult.error || settingsResult.error) {
    return NextResponse.json({ error: 'Не удалось собрать данные inbox' }, { status: 500 })
  }

  return NextResponse.json({
    conversations: (inboxResult.data ?? []).map((row: unknown) => ({
      ...((row as { conversation?: Record<string, unknown> }).conversation ?? {}),
      contact: (row as { contact?: Record<string, unknown> }).contact ?? null,
      last_message: (row as { last_message?: Record<string, unknown> }).last_message ?? null,
    })),
    settings: settingsResult.data ?? [],
  })
}
