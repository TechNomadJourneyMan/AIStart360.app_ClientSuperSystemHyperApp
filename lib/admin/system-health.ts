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
