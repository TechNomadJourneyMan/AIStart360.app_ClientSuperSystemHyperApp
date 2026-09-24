export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { createServiceClient } from '@/lib/supabase-service'

/**
 * GET /api/giga-admin/system/health — configuration and data-layer status.
 * Env values are never returned — only whether each is configured.
 */
const ENV_CHECKS: Array<{ key: string; label: string; required: boolean; anyOf?: string[] }> = [
  { key: 'NEXT_PUBLIC_SUPABASE_URL', label: 'Supabase URL', required: true },
  { key: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', label: 'Supabase anon key', required: true },
  { key: 'SUPABASE_SERVICE_ROLE_KEY', label: 'Supabase service key', required: true },
  { key: 'GIGA_ADMIN_PASSWORD', label: 'Пароль аварийного входа', required: false },
  { key: 'GIGA_COOKIE_SECRET', label: 'Секрет подписи cookie и сессий «от имени»', required: true, anyOf: ['GIGA_COOKIE_SECRET', 'AUTH_SECRET', 'NEXTAUTH_SECRET'] },
  { key: 'OPENROUTER_API_KEY', label: 'OpenRouter (ИИ)', required: true },
  { key: 'RESEND_API_KEY', label: 'Resend (почта)', required: false },
  { key: 'TELEGRAM_BOT_TOKEN', label: 'Telegram-бот', required: false },
  { key: 'TELEGRAM_ADMIN_CHAT_IDS', label: 'Telegram-чаты админов', required: false },
  { key: 'GOOGLE_SHEETS_SPREADSHEET_ID', label: 'Google Sheets', required: false },
  { key: 'UPSTASH_REDIS_REST_URL', label: 'Redis (лимиты запросов)', required: false },
  { key: 'CRON_SECRET', label: 'Секрет cron-задач', required: false },
  { key: 'NEXT_PUBLIC_APP_URL', label: 'Адрес приложения', required: false, anyOf: ['NEXT_PUBLIC_APP_URL', 'NEXT_PUBLIC_APP_ORIGIN', 'VERCEL_URL'] },
]

const TABLES = [
  'profiles', 'survey_answers', 'gri_assessments', 'user_events', 'admin_audit_log',
  'staff_roles', 'impersonation_sessions', 'survey_answer_history', 'cms_pages',
  'platform_sections', 'system_settings', 'documents', 'ai_usage',
]

const BUCKETS = ['cms-media', 'documents']

export async function GET(req: NextRequest) {
  const guard = await requireGiga(req, 'settings.manage')
  if (guard.response) return guard.response

  const env = ENV_CHECKS.map((e) => ({ label: e.label, key: e.key, required: e.required, configured: (e.anyOf ?? [e.key]).some((k) => !!process.env[k]) }))

  const sb = createServiceClient()
  const t0 = Date.now()
  const tables = await Promise.all(TABLES.map(async (name) => {
    const { count, error } = await sb.from(name).select('*', { count: 'estimated', head: true })
    return { name, ok: !error, rows: error ? null : count ?? 0, error: error?.message ?? null }
  }))
  const dbMs = Date.now() - t0

  let buckets: Array<{ name: string; ok: boolean }> = []
  try {
    const { data } = await sb.storage.listBuckets()
    const ids = new Set((data ?? []).map((b) => b.id))
    buckets = BUCKETS.map((name) => ({ name, ok: ids.has(name) }))
  } catch {
    buckets = BUCKETS.map((name) => ({ name, ok: false }))
  }

  return NextResponse.json({
    ok: true,
    checkedAt: new Date().toISOString(),
    runtime: { node: process.version, env: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'unknown', commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null },
    db: { ok: tables.every((t) => t.ok), ms: dbMs },
    env,
    tables,
    buckets,
  })
}
