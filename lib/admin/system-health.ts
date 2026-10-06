/**
 * Configuration checklist of the platform (GIGA «Система» and the admin bot's
 * «📊 Статус»). Only whether a variable is set is ever reported — never a
 * value.
 */
export interface EnvCheck { key: string; label: string; required: boolean; anyOf?: string[] }

export const ENV_CHECKS: EnvCheck[] = [
  { key: 'NEXT_PUBLIC_SUPABASE_URL', label: 'Supabase URL', required: true },
  { key: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', label: 'Supabase anon key', required: true },
  { key: 'SUPABASE_SERVICE_ROLE_KEY', label: 'Supabase service key', required: true },
  { key: 'GIGA_ADMIN_PASSWORD', label: 'Пароль аварийного входа', required: false },
  { key: 'GIGA_COOKIE_SECRET', label: 'Секрет подписи cookie и сессий «от имени»', required: true, anyOf: ['GIGA_COOKIE_SECRET', 'AUTH_SECRET', 'NEXTAUTH_SECRET'] },
  { key: 'OPENROUTER_API_KEY', label: 'OpenRouter (ИИ)', required: true },
  { key: 'RESEND_API_KEY', label: 'Resend (почта)', required: false },
  { key: 'TELEGRAM_BOT_TOKEN', label: 'Telegram-бот', required: false },
  { key: 'TELEGRAM_ADMIN_CHAT_IDS', label: 'Telegram-чаты админов', required: false },
  { key: 'TELEGRAM_WEBHOOK_SECRET', label: 'Секрет вебхука Telegram (нужен для одобрений)', required: false },
  { key: 'TELEGRAM_ADMIN_BOT_TOKEN', label: 'Telegram: бот-панель администратора', required: false },
  { key: 'TELEGRAM_ADMIN_WEBHOOK_SECRET', label: 'Telegram: секрет вебхука бота-панели', required: false },
  { key: 'TELEGRAM_EXPERT_BOT_TOKEN', label: 'Telegram: бот экспертов', required: false },
  { key: 'TELEGRAM_EXPERT_WEBHOOK_SECRET', label: 'Telegram: секрет вебхука бота экспертов', required: false },
  // The Sheets mirror is switched on by the Apps Script webhook URL (lib/integrations/google-sheets.ts).
  { key: 'GOOGLE_APPS_SCRIPT_WEBHOOK_URL', label: 'Google Sheets (зеркало анкет)', required: false },
  { key: 'SECRETS_ENCRYPTION_KEY', label: 'Ключ шифрования секретов (2FA, токены CRM)', required: false },
  { key: 'INNGEST_EVENT_KEY', label: 'Inngest (очередь и расписания агентов)', required: false, anyOf: ['INNGEST_EVENT_KEY', 'INNGEST_SIGNING_KEY'] },
  { key: 'UPSTASH_REDIS_REST_URL', label: 'Redis (лимиты запросов)', required: false },
  { key: 'CRON_SECRET', label: 'Секрет cron-задач', required: false },
  { key: 'NEXT_PUBLIC_APP_URL', label: 'Адрес приложения', required: false, anyOf: ['NEXT_PUBLIC_APP_URL', 'NEXT_PUBLIC_APP_ORIGIN', 'VERCEL_URL'] },
]

export function envChecks(): Array<{ label: string; key: string; required: boolean; configured: boolean }> {
  return ENV_CHECKS.map((e) => ({ label: e.label, key: e.key, required: e.required, configured: (e.anyOf ?? [e.key]).some((k) => !!process.env[k]) }))
}

/** Counts only (the bot never lists which variable is missing to a chat). */
export function envCompleteness(): { required: number; requiredSet: number; total: number; set: number } {
  const all = envChecks()
  const req = all.filter((e) => e.required)
  return { required: req.length, requiredSet: req.filter((e) => e.configured).length, total: all.length, set: all.filter((e) => e.configured).length }
}

// ─── Data-layer checks (GIGA «Система» → «Состояние системы») ─────────────

export interface CrmHealth { active: number; errors: number; plaintextTokens: number; lastSyncAt: string | null }

/**
 * CRM connection counts from a supabase-js result. supabase-js does not throw
 * on a query error — it returns { data: null, error } — so the error must be
 * read here: a failed read is "no data" (crm null + the error), never zero
 * connections and zero plaintext tokens.
 */
export function crmHealthFrom(res: { data: unknown[] | null; error: { message?: string } | null }): { crm: CrmHealth | null; error: string | null } {
  if (res.error) return { crm: null, error: res.error.message || 'запрос не выполнен' }
  if (!Array.isArray(res.data)) return { crm: null, error: 'пустой ответ базы' }
  const rows = res.data as Array<{ is_active: boolean; last_sync_status: string | null; last_sync_at: string | null; access_token: string | null }>
  return {
    crm: {
      active: rows.filter((r) => r.is_active).length,
      errors: rows.filter((r) => r.is_active && r.last_sync_status === 'error').length,
      plaintextTokens: rows.filter((r) => r.access_token != null && !String(r.access_token).startsWith('v1:')).length,
      lastSyncAt: rows.map((r) => r.last_sync_at).filter((v): v is string => Boolean(v)).sort().pop() ?? null,
    },
    error: null,
  }
}

export interface CheckFailure { kind: 'not_migrated' | 'failed'; message: string }

/** A missing relation means the migrations are not applied; anything else is a real failure. */
export function classifyCheckError(err: unknown): CheckFailure {
  const message = (err instanceof Error ? err.message : String(err)).slice(0, 300)
  const notMigrated = /42P01|relation .* does not exist|does not exist in the current database/i.test(message)
  return { kind: notMigrated ? 'not_migrated' : 'failed', message }
}
