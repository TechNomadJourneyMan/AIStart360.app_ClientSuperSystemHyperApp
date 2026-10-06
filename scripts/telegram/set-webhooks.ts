/**
 * Register the platform's Telegram bots with Telegram.
 *
 *   npx tsx scripts/telegram/set-webhooks.ts https://app.example.com            # all configured bots
 *   npx tsx scripts/telegram/set-webhooks.ts https://app.example.com --bots admin,expert
 *   npx tsx scripts/telegram/set-webhooks.ts https://app.example.com --info     # only getWebhookInfo
 *   npx tsx scripts/telegram/set-webhooks.ts https://app.example.com --dry-run  # print the plan
 *
 * Per bot (tokens and secrets come from env, see lib/telegram/bots/registry.ts):
 *   setWebhook   <base>/api/telegram/{webhook|admin|expert}, secret_token = the
 *                bot's webhook secret, allowed_updates = message + callback_query
 *   setMyCommands  Russian command list (lib/telegram/bots/commands.ts)
 *   getWebhookInfo  url, pending updates, last error
 * A bot without a token is skipped; a bot without a webhook secret is refused
 * (its webhook would fail closed anyway). Tokens and secrets are never printed.
 *
 * Vercel preview deployments behind Deployment Protection reject Telegram's
 * POSTs (401 from Vercel, not from the app): use the production domain, or a
 * preview with protection off / a bypass, before running this.
 */
import { botEnvNames, botToken, botWebhookSecret, BOT_IDS, callApi, type BotId } from '../../lib/telegram/bots/registry'
import { ADMIN_COMMANDS, CLIENT_COMMANDS, EXPERT_COMMANDS, type BotCommand } from '../../lib/telegram/bots/commands'

const PATHS: Record<BotId, string> = { client: '/api/telegram/webhook', admin: '/api/telegram/admin', expert: '/api/telegram/expert' }
const COMMANDS: Record<BotId, BotCommand[]> = { client: CLIENT_COMMANDS, admin: ADMIN_COMMANDS, expert: EXPERT_COMMANDS }

function arg(name: string): string | null {
  const i = process.argv.indexOf(name)
  return i > 0 ? process.argv[i + 1] ?? null : null
}

async function main(): Promise<void> {
  const base = process.argv[2]
  if (!base || base.startsWith('--') || !/^https:\/\/[^/]+/i.test(base)) {
    console.error('Usage: npx tsx scripts/telegram/set-webhooks.ts https://<host> [--bots admin,expert,client] [--info] [--dry-run]')
    process.exit(1)
  }
  const origin = base.replace(/\/+$/, '')
  const only = arg('--bots')?.split(',').map((s) => s.trim()).filter(Boolean)
  const infoOnly = process.argv.includes('--info')
  const dry = process.argv.includes('--dry-run')
  let failed = false

  for (const bot of BOT_IDS) {
    if (only && !only.includes(bot)) continue
    const env = botEnvNames(bot)
    if (!botToken(bot)) {
      console.log(`— ${bot}: ${env.token} не задан — пропуск`)
      continue
    }
    const url = `${origin}${PATHS[bot]}`
    if (!infoOnly) {
      const secret = botWebhookSecret(bot)
      if (!secret) {
        console.error(`✗ ${bot}: ${env.secret} не задан — вебхук без секрета не регистрируется`)
        failed = true
        continue
      }
      if (dry) {
        console.log(`• ${bot}: setWebhook ${url} (secret_token из ${env.secret}), setMyCommands ×${COMMANDS[bot].length}`)
        continue
      }
      const set = await callApi(bot, 'setWebhook', {
        url,
        secret_token: secret,
        allowed_updates: ['message', 'callback_query'],
        max_connections: 20,
      })
      console.log(set.ok ? `✓ ${bot}: setWebhook ${url}` : `✗ ${bot}: setWebhook — ${set.description}`)
      if (!set.ok) failed = true
      const cmds = await callApi(bot, 'setMyCommands', { commands: COMMANDS[bot], language_code: 'ru' })
      const cmdsDefault = await callApi(bot, 'setMyCommands', { commands: COMMANDS[bot] })
      console.log(cmds.ok && cmdsDefault.ok ? `✓ ${bot}: setMyCommands (${COMMANDS[bot].length})` : `✗ ${bot}: setMyCommands — ${cmds.ok ? '' : cmds.description} ${cmdsDefault.ok ? '' : cmdsDefault.description}`)
    }
    const info = await callApi<{ url?: string; pending_update_count?: number; last_error_message?: string; last_error_date?: number; allowed_updates?: string[] }>(bot, 'getWebhookInfo', {})
    if (info.ok) {
      const r = info.result
      console.log(`  ${bot}: url=${r.url || '—'} pending=${r.pending_update_count ?? 0} updates=${(r.allowed_updates ?? []).join(',') || 'все'}${r.last_error_message ? ` last_error="${r.last_error_message}" (${new Date((r.last_error_date ?? 0) * 1000).toISOString()})` : ''}`)
      if (!infoOnly && !dry && r.url !== url) failed = true
    } else {
      console.error(`✗ ${bot}: getWebhookInfo — ${info.description}`)
      failed = true
    }
  }
  process.exit(failed ? 1 : 0)
}

void main()
