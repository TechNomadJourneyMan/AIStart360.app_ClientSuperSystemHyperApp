/**
 * Is everything in place for the admin and expert bots to work?
 *
 *   npx tsx --env-file=.env.local scripts/telegram/go-live-check.ts https://app.example.com
 *   npx tsx scripts/telegram/go-live-check.ts                       # env + DB only, no domain checks
 *   npx tsx scripts/telegram/go-live-check.ts https://… --skip-db   # no database connection
 *
 * Checks, each with what to do when it fails (lib/telegram/bots/go-live.ts):
 *   env        token / username / webhook secret of both bots, SECRETS_ENCRYPTION_KEY,
 *              Supabase URL + service key
 *   Telegram   getMe (the token works, the username matches), getWebhookInfo
 *              (the webhook points to <domain>/api/telegram/{admin,expert}, last error)
 *   domain     a POST with a wrong secret must be refused by the app itself (JSON 401);
 *              an HTML 401/403 is Vercel Deployment Protection
 *   database   (DIRECT_URL or DATABASE_URL) migrations 083+ in schema_migrations,
 *              the owner account has super_admin, the owner linked the admin bot
 * Tokens and secrets are never printed. Exit code 1 when anything failed.
 *
 * Run from the repository root. The env checks read this process's env: run it with the same variables as the
 * deployment (e.g. `vercel env pull .env.local` first).
 */
import fs from 'node:fs'
import path from 'node:path'
import { Client } from 'pg'
import { botEnvNames, botToken, botUsernameOf, callApi } from '../../lib/telegram/bots/registry'
import {
  GO_LIVE_BOTS, OWNER_EMAIL, WEBHOOK_PATHS, checkBotEnv, checkMigrations, checkPlatformEnv,
  classifyWebhookInfo, classifyWebhookProbe, formatCheck, requiredMigrations, summarize,
  type Check, type WebhookInfo,
} from '../../lib/telegram/bots/go-live'

async function telegramChecks(origin: string | null): Promise<Check[]> {
  const out: Check[] = []
  for (const bot of GO_LIVE_BOTS) {
    if (!botToken(bot)) {
      out.push({ status: 'skip', name: `${bot}: Telegram`, detail: `${botEnvNames(bot).token} не задан` })
      continue
    }
    const me = await callApi<{ username?: string }>(bot, 'getMe', {})
    if (!me.ok) {
      out.push({
        status: 'fail', name: `${bot}: getMe`, detail: me.description,
        fix: me.status === 401 ? 'Токен отозван или неверен — возьмите актуальный в @BotFather' : 'Нет доступа к api.telegram.org из этой сети',
      })
      continue
    }
    const expected = botUsernameOf(bot)
    out.push(expected && me.result.username && me.result.username.toLowerCase() !== expected.toLowerCase()
      ? { status: 'fail', name: `${bot}: getMe`, detail: `токен принадлежит @${me.result.username}, а ${botEnvNames(bot).username}=@${expected}`, fix: 'Токен и имя должны быть от одного бота' }
      : { status: 'ok', name: `${bot}: getMe`, detail: `@${me.result.username ?? '?'}` })

    const info = await callApi<WebhookInfo>(bot, 'getWebhookInfo', {})
    out.push(info.ok
      ? classifyWebhookInfo(bot, origin ? `${origin}${WEBHOOK_PATHS[bot]}` : null, info.result)
      : { status: 'fail', name: `${bot}: getWebhookInfo`, detail: info.description })
  }
  return out
}

async function probeChecks(origin: string): Promise<Check[]> {
  const out: Check[] = []
  for (const bot of GO_LIVE_BOTS) {
    const url = `${origin}${WEBHOOK_PATHS[bot]}`
    let status = 0
    let type = ''
    let body = ''
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'go-live-check-deliberately-wrong' },
        body: '{}',
        redirect: 'manual',
        signal: AbortSignal.timeout(15_000),
      })
      status = res.status
      type = res.headers.get('content-type') ?? ''
      body = (await res.text()).slice(0, 2000)
    } catch {
      status = 0
    }
    out.push(classifyWebhookProbe(bot, url, status, type, body))
  }
  return out
}

async function dbChecks(): Promise<Check[]> {
  const conn = process.env.DIRECT_URL || process.env.DATABASE_URL
  if (!conn) return [{ status: 'skip', name: 'база данных', detail: 'DIRECT_URL/DATABASE_URL не заданы — проверка БД пропущена' }]
  const client = new Client({ connectionString: conn })
  const out: Check[] = []
  try {
    await client.connect()
    const files = fs.readdirSync(path.resolve(process.cwd(), 'supabase/migrations'))
    const required = requiredMigrations(files)
    const ledger = await client.query<{ t: string | null }>(`SELECT to_regclass('public.schema_migrations')::text AS t`)
    if (!ledger.rows[0].t) {
      out.push({ status: 'fail', name: 'миграции', detail: 'нет таблицы schema_migrations (создаётся миграцией 083)', fix: 'Примените миграции с 083 по порядку: node scripts/apply-migration.js supabase/migrations/<файл>' })
    } else {
      const applied = await client.query<{ file: string }>('SELECT file FROM public.schema_migrations')
      out.push(checkMigrations(required, new Set(applied.rows.map((r) => r.file))))
    }

    const owner = await client.query<{ id: string; profile_role: string | null; staff_role: string | null; linked: boolean }>(
      `SELECT u.id, p.role AS profile_role, sr.role AS staff_role,
              EXISTS (SELECT 1 FROM public.telegram_bot_links l
                       WHERE l.bot = 'admin' AND l.user_id = u.id AND l.linked_at IS NOT NULL) AS linked
         FROM auth.users u
         LEFT JOIN public.profiles p ON p.id = u.id
         LEFT JOIN public.staff_roles sr ON sr.user_id = u.id
        WHERE lower(u.email) = $1`,
      [OWNER_EMAIL],
    ).catch((err: Error) => {
      out.push({ status: 'fail', name: 'владелец', detail: `запрос не выполнен: ${err.message.split('\n')[0]}`, fix: 'Сначала примените миграции (095 создаёт telegram_bot_links)' })
      return null
    })
    if (owner) {
      const row = owner.rows[0]
      if (!row) {
        out.push({ status: 'fail', name: 'владелец', detail: `аккаунта ${OWNER_EMAIL} нет в auth.users`, fix: 'Зарегистрируйтесь на /login этим email, затем примените миграцию 099' })
      } else {
        const superAdmin = row.profile_role === 'super_admin' || row.staff_role === 'super_admin'
        out.push(superAdmin
          ? { status: 'ok', name: 'владелец', detail: `${OWNER_EMAIL} — super_admin` }
          : { status: 'fail', name: 'владелец', detail: `${OWNER_EMAIL} без роли super_admin (profiles: ${row.profile_role ?? '—'}, staff_roles: ${row.staff_role ?? '—'})`, fix: 'Примените миграцию 099_owner_super_admin.sql' })
        out.push(row.linked
          ? { status: 'ok', name: 'привязка admin-бота', detail: 'Telegram владельца привязан' }
          : { status: 'warn', name: 'привязка admin-бота', detail: 'Telegram владельца ещё не привязан', fix: 'GIGA → «Уведомления» → «Привязать Telegram» → открыть ссылку → /start в боте' })
      }
    }
  } catch (err) {
    out.push({ status: 'fail', name: 'база данных', detail: `подключение не удалось: ${err instanceof Error ? err.message.split('\n')[0] : 'ошибка'}` })
  } finally {
    await client.end().catch(() => undefined)
  }
  return out
}

async function main(): Promise<void> {
  const arg = process.argv[2]
  const base = arg && !arg.startsWith('--') ? arg : null
  // http only for a local stand (next dev); Telegram itself requires https.
  if (base && !/^(https:\/\/[^/]+|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)/i.test(base)) {
    console.error('Usage: npx tsx scripts/telegram/go-live-check.ts [https://<домен>] [--skip-db]')
    process.exit(1)
  }
  const origin = base ? base.replace(/\/+$/, '') : null

  const sections: Array<[string, Check[]]> = [
    ['Окружение', [...GO_LIVE_BOTS.flatMap((b) => checkBotEnv(b, process.env)), ...checkPlatformEnv(process.env)]],
    ['Telegram', await telegramChecks(origin)],
  ]
  if (origin) sections.push(['Домен', await probeChecks(origin)])
  if (!process.argv.includes('--skip-db')) sections.push(['База данных', await dbChecks()])

  const all: Check[] = []
  for (const [title, checks] of sections) {
    console.log(`\n${title}`)
    for (const c of checks) console.log(`  ${formatCheck(c).replace(/\n/g, '\n  ')}`)
    all.push(...checks)
  }
  const s = summarize(all)
  console.log(`\n${s.ok ? '✓ Готово к запуску' : `✗ Ошибок: ${s.failed}`}${s.warned ? `, предупреждений: ${s.warned}` : ''}`)
  if (s.ok) console.log('  Проверка в боте: /start, затем /status')
  process.exit(s.ok ? 0 : 1)
}

void main()
