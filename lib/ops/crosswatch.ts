/**
 * lib/ops/crosswatch.ts — перекрёстный сторож (R4-A1, N4A-2): сервис агентов проверяет портал.
 *
 * Все остальные сторожа живут в самом портале и шлют тревогу через базу: упади портал или база —
 * тишина. Сервис агентов — второй процесс, у него свой планировщик; раз в 3 минуты
 * (/api/cron/ops-crosswatch, lib/cron/schedule.ts) он:
 *   • зовёт GET {портал}/api/health (readiness: база, очередь Workflow, наш Inngest, свежесть
 *     журнала задач портала) с таймаутом 10 с:
 *       нет ответа / не 200 и не 503      → «портал не отвечает» (portal:down);
 *       503                               → «портал не готов: …» с названиями проваленных проверок
 *                                           (portal:not_ready);
 *   • проверяет свою связь с базой (SELECT 1, 5 с) → «база не отвечает сервису агентов» (db:down).
 * Адрес портала: PORTAL_SERVICE_URL (частная сеть, например http://<портал>.railway.internal:8080),
 * без неё — NEXT_PUBLIC_APP_URL (публичный домен: тогда проверяется и край Railway).
 *
 * Тревога — только напрямую в Telegram (lib/notifications/ops-direct.ts): база может лежать.
 * Первая — после двух неудачных проверок подряд (выкатка портала не должна будить людей), потом не
 * чаще раза в 6 ч, и одно сообщение «восстановлено», когда проблема ушла. «Портал не отвечает» и
 * «портал не готов» — одна серия (портал, который мигает между ними, — тоже сбой), и «восстановлено»
 * приходит только когда /api/health ответил 200. Состояние — в
 * памяти процесса (globalThis): после перезапуска счёт начинается заново.
 *
 * Портал проверяет сервис агентов сам — в стороже задач (lib/ops/job-watchdog.ts, agents:down и
 * журнал /api/cron/agents).
 */
import { sendOpsDirect, type OpsDirectAlert } from '@/lib/notifications/ops-direct'

type Env = Partial<NodeJS.ProcessEnv>

export const CROSSWATCH_FAILS_BEFORE_ALERT = 2
export const CROSSWATCH_REMIND_MS = 6 * 3600_000
const PORTAL_TIMEOUT_MS = 10_000

export type CrossProblemKey = 'portal:down' | 'portal:not_ready' | 'db:down'

export interface CrossProblem {
  key: CrossProblemKey
  title: string
  detail: string
}

const CHECK_NAMES: Record<string, string> = {
  db: 'база данных',
  config: 'конфигурация сервера',
  queue: 'очередь Workflow',
  inngest: 'Inngest (фоновые задачи)',
  jobs: 'задачи по расписанию',
}

/** The portal to watch: PORTAL_SERVICE_URL (private network) first, else the public NEXT_PUBLIC_APP_URL. */
export function portalTarget(env: Env = process.env): { url: string; via: 'private' | 'public' } | null {
  for (const [name, via] of [['PORTAL_SERVICE_URL', 'private'], ['NEXT_PUBLIC_APP_URL', 'public']] as const) {
    const raw = env[name]?.trim()
    if (!raw) continue
    try {
      const u = new URL(raw)
      if (u.protocol !== 'http:' && u.protocol !== 'https:') continue
      return { url: `${u.origin}${u.pathname.replace(/\/+$/, '')}`, via }
    } catch {
      continue
    }
  }
  return null
}

/** One GET of the portal's readiness; a problem or null. Never throws. */
export async function probePortal(base: string, fetchImpl: typeof fetch = fetch): Promise<CrossProblem | null> {
  let res: Response
  try {
    res = await fetchImpl(`${base}/api/health`, { signal: AbortSignal.timeout(PORTAL_TIMEOUT_MS), cache: 'no-store' })
  } catch (e) {
    const name = (e as { name?: unknown } | null)?.name
    const detail = name === 'TimeoutError' ? `нет ответа за ${PORTAL_TIMEOUT_MS / 1000} с` : `нет соединения (${(e instanceof Error ? e.message : String(e)).split('\n')[0].slice(0, 150)})`
    return { key: 'portal:down', title: 'Портал не отвечает', detail }
  }
  if (res.status === 200) {
    try { await res.body?.cancel() } catch { /* closed */ }
    return null
  }
  if (res.status === 503) {
    const body = (await res.json().catch(() => null)) as { checks?: Record<string, unknown> } | null
    const failed = Object.entries(body?.checks ?? {}).filter(([, v]) => v === 'fail').map(([k]) => CHECK_NAMES[k] ?? k)
    return {
      key: 'portal:not_ready',
      title: 'Портал отвечает, но не готов',
      detail: failed.length ? `не прошли проверки: ${failed.join(', ')}` : 'проверка готовности ответила 503',
    }
  }
  try { await res.body?.cancel() } catch { /* closed */ }
  return { key: 'portal:down', title: 'Портал не отвечает', detail: `GET /api/health ответил HTTP ${res.status}` }
}

/** The series a problem belongs to: every problem of the portal is one series. */
type Series = 'portal' | 'db'
const seriesOf = (key: CrossProblemKey): Series => (key === 'db:down' ? 'db' : 'portal')

interface Track {
  /** The kind seen last (portal:down / portal:not_ready / db:down). */
  key: CrossProblemKey
  fails: number
  firstAt: number
  alertedAt?: number
  detail: string
  title: string
}

const STATE_KEY = Symbol.for('aistart360.ops.crosswatch.state')
function state(): Map<Series, Track> {
  const g = globalThis as Record<symbol, Map<Series, Track> | undefined>
  return (g[STATE_KEY] ??= new Map())
}

/** For tests: forget what earlier passes saw. */
export function resetCrosswatchState(): void {
  state().clear()
}

export interface CrosswatchDeps {
  env?: Env
  fetchImpl?: typeof fetch
  now?: () => Date
  /** This service's own database round trip; resolves true when it answered. */
  checkDb: () => Promise<boolean>
  alert?: (alert: OpsDirectAlert) => Promise<unknown>
  logError?: (line: string) => void
}

export interface CrosswatchReport {
  status: 'ok' | 'problems' | 'not_configured'
  target: 'private' | 'public' | null
  problems: CrossProblemKey[]
  alerted: CrossProblemKey[]
  recovered: CrossProblemKey[]
}

function almaty(ms: number): string {
  return new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Almaty', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(ms))
}

export async function runCrosswatch(deps: CrosswatchDeps): Promise<CrosswatchReport> {
  const env = deps.env ?? process.env
  const now = (deps.now ?? (() => new Date()))().getTime()
  const alert = deps.alert ?? ((a: OpsDirectAlert) => sendOpsDirect(a, { env, logError: deps.logError }))
  const logError = deps.logError ?? ((line: string) => console.error(line))
  const target = portalTarget(env)

  const found: CrossProblem[] = []
  if (target) {
    const p = await probePortal(target.url, deps.fetchImpl)
    if (p) found.push(p)
  }
  let dbOk = false
  try {
    dbOk = await deps.checkDb()
  } catch {
    dbOk = false
  }
  if (!dbOk) found.push({ key: 'db:down', title: 'База данных не отвечает сервису агентов', detail: 'SELECT 1 не прошёл за 5 с' })

  const tracks = state()
  const alerted: CrossProblemKey[] = []
  const recovered: CrossProblemKey[] = []
  const seen = new Set(found.map((p) => seriesOf(p.key)))

  for (const p of found) {
    const series = seriesOf(p.key)
    const t = tracks.get(series) ?? { key: p.key, fails: 0, firstAt: now, detail: p.detail, title: p.title }
    t.fails += 1
    t.key = p.key
    t.detail = p.detail
    t.title = p.title
    tracks.set(series, t)
    // Every failed check is on the error log; the alarm waits for the second in a row.
    logError(`ops-crosswatch: ${p.title} — ${p.detail} (подряд: ${t.fails})`)
    if (t.fails < CROSSWATCH_FAILS_BEFORE_ALERT) continue
    if (t.alertedAt !== undefined && now - t.alertedAt < CROSSWATCH_REMIND_MS) continue
    t.alertedAt = now
    await alert({
      level: 'CRITICAL',
      title: p.title,
      lines: [
        `${p.detail}.`,
        `Впервые замечено ${almaty(t.firstAt)} (Алматы), проверок подряд: ${t.fails}. Проверяет сервис агентов${target ? ` (${target.via === 'private' ? 'частная сеть' : 'публичный адрес'})` : ''}.`,
        p.key === 'db:down'
          ? 'Проверьте Postgres в Railway: портал, скорее всего, тоже не работает.'
          : 'Проверьте сервис портала в Railway: деплой, логи, /api/health.',
      ],
    })
    alerted.push(p.key)
  }

  // Only a series with no problem this pass is over: for the portal that is a 200 from /api/health.
  for (const [series, t] of tracks) {
    if (seen.has(series)) continue
    tracks.delete(series)
    if (t.alertedAt === undefined) continue // never announced: nothing to take back
    recovered.push(t.key)
    await alert({
      level: 'SUCCESS',
      title: `Восстановлено: ${t.title.toLowerCase()}`,
      lines: [`Проблема держалась с ${almaty(t.firstAt)} (Алматы); сейчас проверка проходит.`],
    })
  }

  return {
    status: found.length ? 'problems' : !target ? 'not_configured' : 'ok',
    target: target?.via ?? null,
    problems: found.map((p) => p.key),
    alerted,
    recovered,
  }
}
