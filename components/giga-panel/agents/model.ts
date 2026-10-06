/**
 * Agent Control Center («ИИ-агенты») — pure view model.
 *
 * Labels, tones, formatting and the permission-matrix logic used by the GIGA
 * pages. No React and no fetching here, so every rule is unit-tested
 * (tests/unit/giga-crm/agents-ui-model.test.ts). Numbers always come from the
 * API; this module only formats and arranges them.
 */
import type { Tone } from '../kit'
import { isValidCron, nextCronRun } from '@/lib/agents/cron'
import { LEVEL_LABELS, type NotificationLevel } from '@/lib/notifications/levels'

export interface StatusMeta { label: string; tone: Tone; hint?: string }

const unknownMeta = (v: string | null | undefined): StatusMeta => ({ label: v || '—', tone: 'neutral' })

/** Pages that change a sidebar counter dispatch this window event (see GigaSidebar). */
export const NAV_BADGES_CHANGED = 'giga:nav-badges-changed'

// ─── Statuses ────────────────────────────────────────────────────────────────

export const TASK_STATUSES = ['queued', 'running', 'awaiting_approval', 'succeeded', 'failed', 'dead', 'cancelled'] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

export const TASK_STATUS: Record<TaskStatus, StatusMeta> = {
  queued: { label: 'В очереди', tone: 'blue', hint: 'ждёт исполнителя' },
  running: { label: 'Выполняется', tone: 'violet', hint: 'исполнитель взял задачу' },
  awaiting_approval: { label: 'Ждёт одобрения', tone: 'amber', hint: 'агенту нужно решение человека' },
  succeeded: { label: 'Успешно', tone: 'green' },
  failed: { label: 'Ошибка', tone: 'red', hint: 'попытка не удалась' },
  dead: { label: 'Попытки исчерпаны', tone: 'red', hint: 'dead-letter: автоматических повторов больше не будет' },
  cancelled: { label: 'Отменена', tone: 'neutral' },
}

export function taskStatusMeta(status: string | null | undefined): StatusMeta {
  return (status && TASK_STATUS[status as TaskStatus]) || unknownMeta(status)
}

/** Task statuses an admin may cancel / retry (mirrors lib/agents/admin.ts cancelTask / retryTask). */
export const CANCELLABLE: ReadonlySet<string> = new Set(['queued', 'awaiting_approval', 'failed'])
export const RETRYABLE: ReadonlySet<string> = new Set(['dead', 'failed', 'cancelled'])
/** Statuses that will still change on their own — the task page refreshes while in them. */
export const LIVE_TASK_STATUSES: ReadonlySet<string> = new Set(['queued', 'running'])

const RUN_STATUS: Record<string, StatusMeta> = {
  running: { label: 'Выполняется', tone: 'violet' },
  succeeded: { label: 'Успешно', tone: 'green' },
  failed: { label: 'Ошибка', tone: 'red' },
  awaiting_approval: { label: 'Ждёт одобрения', tone: 'amber' },
  cancelled: { label: 'Отменён', tone: 'neutral' },
}
export function runStatusMeta(status: string | null | undefined): StatusMeta {
  return (status && RUN_STATUS[status]) || unknownMeta(status)
}

const APPROVAL_STATUS: Record<string, StatusMeta> = {
  pending: { label: 'Ожидает решения', tone: 'amber' },
  approved: { label: 'Одобрено', tone: 'green' },
  rejected: { label: 'Отклонено', tone: 'red' },
  expired: { label: 'Истекло', tone: 'neutral', hint: 'никто не решил вовремя' },
  executed: { label: 'Исполнено', tone: 'blue', hint: 'агент выполнил одобренное действие' },
  failed: { label: 'Не исполнено', tone: 'red' },
}
export function approvalStatusMeta(status: string | null | undefined): StatusMeta {
  return (status && APPROVAL_STATUS[status]) || unknownMeta(status)
}

const DECIDED_VIA: Record<string, string> = { admin: 'в GIGA', telegram: 'в Telegram', system: 'системой' }
export function decidedViaLabel(via: string | null | undefined): string {
  return (via && DECIDED_VIA[via]) || '—'
}

const TOOL_CALL_STATUS: Record<string, StatusMeta> = {
  ok: { label: 'Выполнен', tone: 'green' },
  error: { label: 'Ошибка', tone: 'red' },
  denied: { label: 'Запрещён', tone: 'red' },
  pending_approval: { label: 'Ждёт одобрения', tone: 'amber' },
}
export function toolCallStatusMeta(status: string | null | undefined): StatusMeta {
  return (status && TOOL_CALL_STATUS[status]) || unknownMeta(status)
}

const EVENT_LEVEL: Record<string, StatusMeta> = {
  debug: { label: 'Отладка', tone: 'neutral' },
  info: { label: 'Инфо', tone: 'blue' },
  warn: { label: 'Внимание', tone: 'amber' },
  error: { label: 'Ошибка', tone: 'red' },
}
export function eventLevelMeta(level: string | null | undefined): StatusMeta {
  return (level && EVENT_LEVEL[level]) || unknownMeta(level)
}

const NOTIFICATION_TONE: Record<NotificationLevel, Tone> = {
  INFO: 'blue', SUCCESS: 'green', WARNING: 'amber', CRITICAL: 'red', APPROVAL_REQUIRED: 'violet',
}
export const NOTIFICATION_LEVELS = Object.keys(NOTIFICATION_TONE) as NotificationLevel[]
export function notificationLevelMeta(level: string | null | undefined): StatusMeta {
  if (level && level in NOTIFICATION_TONE) {
    const l = level as NotificationLevel
    return { label: LEVEL_LABELS[l], tone: NOTIFICATION_TONE[l] }
  }
  return unknownMeta(level)
}

const TRIGGER: Record<string, string> = {
  manual: 'Вручную', event: 'Событие', schedule: 'Расписание', agent: 'Другой агент', approval: 'После одобрения',
}
export function triggerLabel(trigger: string | null | undefined): string {
  return (trigger && TRIGGER[trigger]) || trigger || '—'
}

export function scopeLabel(scope: string | null | undefined): string {
  return scope === 'company' ? 'Для компании' : scope === 'platform' ? 'Платформа' : scope || '—'
}

export const TIERS = ['light', 'standard', 'premium'] as const
export type Tier = (typeof TIERS)[number]
const TIER_LABELS: Record<string, string> = {
  none: 'Без LLM', light: 'Light', standard: 'Standard', premium: 'Premium',
}
export const TIER_HINTS: Record<Tier, string> = {
  light: 'быстрые и дешёвые модели: классификация, краткие сводки',
  standard: 'основная модель: извлечение, анализ, выводы',
  premium: 'самая сильная модель: только финальные тексты отчётов',
}
export function tierLabel(tier: string | null | undefined): string {
  return (tier && TIER_LABELS[tier]) || tier || '—'
}

// ─── Permissions ─────────────────────────────────────────────────────────────

export type Decision = 'ALLOW' | 'REQUIRE_APPROVAL' | 'DENY'
export const DECISIONS: readonly Decision[] = ['ALLOW', 'REQUIRE_APPROVAL', 'DENY']
const RANK: Record<Decision, number> = { ALLOW: 0, REQUIRE_APPROVAL: 1, DENY: 2 }

export const DECISION: Record<Decision, StatusMeta> = {
  ALLOW: { label: 'Разрешено', tone: 'green' },
  REQUIRE_APPROVAL: { label: 'Нужно одобрение', tone: 'amber' },
  DENY: { label: 'Запрещено', tone: 'red' },
}
export function decisionMeta(d: string | null | undefined): StatusMeta {
  return (d && DECISION[d as Decision]) || unknownMeta(d)
}
export function isDecision(v: unknown): v is Decision {
  return v === 'ALLOW' || v === 'REQUIRE_APPROVAL' || v === 'DENY'
}

/** Is `a` looser (more permissive) than `b`? */
export function isLooser(a: Decision, b: Decision): boolean {
  return RANK[a] < RANK[b]
}

export const CEILING_NOTE = 'Потолок безопасности: это действие всегда требует человека'

export interface CatalogEntry { key: string; label: string; ceiling: Decision }

export interface DecisionOption { value: Decision; label: string; disabled: boolean; reason?: string }

/** Choices for one permission: anything looser than the code ceiling is shown but locked. */
export function decisionOptions(ceiling: Decision): DecisionOption[] {
  return DECISIONS.map((d) => {
    const locked = isLooser(d, ceiling)
    return { value: d, label: DECISION[d].label, disabled: locked, reason: locked ? CEILING_NOTE : undefined }
  })
}

/** Pending edit for one permission: a decision, or null = back to the agent's default. */
export type GrantDraft = Partial<Record<string, Decision | null>>

export interface MatrixRow {
  key: string
  label: string
  ceiling: Decision
  /** The decision the runtime applies right now (API `agent.permissions`). */
  effective: Decision
  /** True when the code ceiling forbids ALLOW for this permission. */
  ceilingLocked: boolean
  /** Agent tools that need this permission. */
  tools: string[]
  /** What the selector shows: the draft when edited, otherwise the effective decision. */
  selected: Decision
  /** Edited and not saved yet (including «reset to default»). */
  dirty: boolean
  /** Reset to default requested. */
  reset: boolean
  options: DecisionOption[]
}

export function buildPermissionMatrix(
  catalog: readonly CatalogEntry[],
  effective: Partial<Record<string, string>>,
  tools: ReadonlyArray<{ name: string; permission: string }>,
  draft: GrantDraft = {},
): MatrixRow[] {
  return catalog.map((c) => {
    const eff = isDecision(effective[c.key]) ? (effective[c.key] as Decision) : 'DENY'
    const has = Object.prototype.hasOwnProperty.call(draft, c.key)
    const d = has ? draft[c.key] : undefined
    return {
      key: c.key,
      label: c.label,
      ceiling: c.ceiling,
      effective: eff,
      ceilingLocked: c.ceiling !== 'ALLOW',
      tools: tools.filter((t) => t.permission === c.key).map((t) => t.name),
      selected: d ?? eff,
      dirty: has,
      reset: has && d === null,
      options: decisionOptions(c.ceiling),
    }
  })
}

/** Body for PUT …/permissions: only edited rows; never a value looser than the ceiling. */
export function grantsPayload(draft: GrantDraft, catalog: readonly CatalogEntry[]): Record<string, Decision | null> {
  const ceilings = new Map(catalog.map((c) => [c.key, c.ceiling]))
  const out: Record<string, Decision | null> = {}
  for (const [k, v] of Object.entries(draft)) {
    if (v === undefined || !ceilings.has(k)) continue
    out[k] = v === null ? null : isLooser(v, ceilings.get(k)!) ? ceilings.get(k)! : v
  }
  return out
}

/**
 * Why the saved result differs from what the admin picked, in plain words.
 * null when there is nothing to explain.
 */
export function explainOutcome(requested: Decision | null, effective: Decision, ceiling: Decision, capped = false): string | null {
  if (requested === null || requested === effective) return null
  if (capped || (isLooser(requested, ceiling) && effective === ceiling)) {
    return `${CEILING_NOTE}. Итог: «${DECISION[effective].label}».`
  }
  if (effective === 'DENY') {
    return 'Агент не объявляет это право в своём определении, поэтому оно остаётся запрещённым.'
  }
  return `Итог: «${DECISION[effective].label}» — более строгое из выбора, умолчания агента и потолка.`
}

// ─── Formatting ──────────────────────────────────────────────────────────────

export function toNum(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? n : 0
}

/** USD with enough precision for per-run LLM cost (fractions of a cent matter). */
export function fmtUsd(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  if (v === 0) return '$0'
  const a = Math.abs(v)
  const sign = v < 0 ? '−' : ''
  if (a < 0.0001) return `${sign}<$0.0001`
  if (a < 0.01) return `${sign}$${a.toFixed(4)}`
  return `${sign}$${a.toFixed(2)}`
}

const decimal = (n: number) => n.toFixed(1).replace(/\.0$/, '').replace('.', ',')

export function fmtTokens(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const a = Math.abs(v)
  if (a < 1000) return String(Math.round(v))
  if (a < 1_000_000) return `${decimal(v / 1000)} тыс.`
  return `${decimal(v / 1_000_000)} млн`
}

export function fmtDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—'
  if (ms < 1000) return `${Math.round(ms)} мс`
  if (ms < 60_000) return `${decimal(ms / 1000)} с`
  const totalSec = Math.round(ms / 1000)
  if (totalSec < 3600) {
    const m = Math.floor(totalSec / 60)
    const s = totalSec % 60
    return s ? `${m} мин ${s} с` : `${m} мин`
  }
  const totalMin = Math.round(totalSec / 60)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return m ? `${h} ч ${m} мин` : `${h} ч`
}

export function fmtPercent(rate: number | null | undefined): string {
  if (rate == null || !Number.isFinite(rate)) return '—'
  return `${Math.round(rate * 100)}%`
}

export function durationBetween(start: string | null | undefined, end: string | null | undefined): number | null {
  if (!start || !end) return null
  const ms = new Date(end).getTime() - new Date(start).getTime()
  return Number.isFinite(ms) && ms >= 0 ? ms : null
}

/** «через 3 ч 12 мин» / «истёк». */
export function fmtCountdown(iso: string | null | undefined, now: Date = new Date()): { text: string; expired: boolean; urgent: boolean } {
  if (!iso) return { text: '—', expired: false, urgent: false }
  const ms = new Date(iso).getTime() - now.getTime()
  if (!Number.isFinite(ms)) return { text: '—', expired: false, urgent: false }
  if (ms <= 0) return { text: 'срок истёк', expired: true, urgent: false }
  const min = Math.floor(ms / 60_000)
  const urgent = ms < 60 * 60_000
  if (min < 1) return { text: 'меньше минуты', expired: false, urgent }
  if (min < 60) return { text: `через ${min} мин`, expired: false, urgent }
  const h = Math.floor(min / 60)
  const m = min % 60
  return { text: m ? `через ${h} ч ${m} мин` : `через ${h} ч`, expired: false, urgent }
}

/** Who did it, without pretending to know a name the API did not return. */
export function shortActor(id: string | null | undefined): string {
  if (!id) return '—'
  if (id.startsWith('giga:')) return 'общий пароль (аварийный вход)'
  if (id === 'system') return 'система'
  if (id.startsWith('agent:')) return `агент ${id.slice(6)}`
  return /^[0-9a-f-]{36}$/i.test(id) ? `сотрудник ${id.slice(0, 8)}` : id
}

// ─── Schedules ───────────────────────────────────────────────────────────────

export { isValidCron }

/** Next `count` cron fire times (UTC), searched within the matcher's horizon. */
export function nextCronRuns(expr: string, from: Date, count = 5): Date[] {
  if (!isValidCron(expr)) return []
  const out: Date[] = []
  let t = new Date(from)
  for (let i = 0; i < count; i++) {
    const next = nextCronRun(expr, t)
    if (!next) break
    out.push(next)
    t = new Date(next.getTime() + 60_000)
  }
  return out
}

// ─── Costs ───────────────────────────────────────────────────────────────────

export interface DayPoint { day: string; label: string; cost: number; runs: number; tokensIn: number; tokensOut: number }

const isoDay = (d: Date) => d.toISOString().slice(0, 10)

/**
 * One point per UTC day from the start of the period (or the earliest day the
 * API returned, whichever is earlier) to today. Days without runs are real
 * zeros — the API only returns days that had runs.
 */
export function fillDailySeries(byDay: ReadonlyArray<Record<string, unknown>>, days: number, today: Date = new Date()): DayPoint[] {
  const map = new Map<string, Record<string, unknown>>()
  for (const r of byDay) {
    const key = String(r.day ?? '').slice(0, 10)
    if (/^\d{4}-\d{2}-\d{2}$/.test(key)) map.set(key, r)
  }
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
  let start = new Date(end.getTime() - Math.max(0, days - 1) * 86_400_000)
  const earliest = Array.from(map.keys()).sort()[0]
  if (earliest && earliest < isoDay(start)) start = new Date(`${earliest}T00:00:00Z`)
  const out: DayPoint[] = []
  for (let t = start.getTime(); t <= end.getTime(); t += 86_400_000) {
    const key = isoDay(new Date(t))
    const r = map.get(key)
    out.push({
      day: key,
      label: `${key.slice(8, 10)}.${key.slice(5, 7)}`,
      cost: toNum(r?.cost),
      runs: toNum(r?.runs),
      tokensIn: toNum(r?.tin),
      tokensOut: toNum(r?.tout),
    })
  }
  return out
}

export function totalsOf(series: readonly DayPoint[]): { cost: number; runs: number; tokensIn: number; tokensOut: number } {
  return series.reduce(
    (a, p) => ({ cost: a.cost + p.cost, runs: a.runs + p.runs, tokensIn: a.tokensIn + p.tokensIn, tokensOut: a.tokensOut + p.tokensOut }),
    { cost: 0, runs: 0, tokensIn: 0, tokensOut: 0 },
  )
}

export function spendOn(series: readonly DayPoint[], day: Date = new Date()): number {
  return series.find((p) => p.day === isoDay(day))?.cost ?? 0
}

/** Share of a budget used; tone turns amber at 80 %, red at 100 % (same thresholds as the monitoring agent). */
export function budgetUsage(spent: number, budget: number | null | undefined): { ratio: number; tone: Tone; label: string } | null {
  if (budget == null || !Number.isFinite(budget) || budget <= 0) return null
  const ratio = spent / budget
  return { ratio, tone: ratio >= 1 ? 'red' : ratio >= 0.8 ? 'amber' : 'green', label: `${Math.round(ratio * 100)}%` }
}

/**
 * The limit shown next to a spend figure. A budget of 0 is not "no limit":
 * the runtime refuses every model call (spent + estimate > 0).
 */
export function budgetLimitLabel(budget: number | null | undefined): string {
  if (budget == null || !Number.isFinite(budget)) return 'без лимита'
  return budget > 0 ? fmtUsd(budget) : '$0 (LLM запрещён)'
}

/** Today's platform spend: the API's guard-equivalent figure, else the agent-runs series. */
export function platformSpendToday(d: { platformSpendTodayUsd?: number | null } | null | undefined, series: readonly DayPoint[]): number {
  const v = d?.platformSpendTodayUsd
  return typeof v === 'number' && Number.isFinite(v) ? v : spendOn(series)
}

export function shareOf(part: number, total: number): string {
  if (!total) return '—'
  const p = (part / total) * 100
  return p > 0 && p < 1 ? '<1%' : `${Math.round(p)}%`
}

// ─── Agents summary ──────────────────────────────────────────────────────────

export interface AgentStatsLike {
  enabled: boolean
  stats: { runs7d: number; costUsd7d: number; costUsdToday: number; queued: number; running: number; awaitingApproval: number; dead24h: number; failed7d: number }
}

export function summarizeAgents(agents: readonly AgentStatsLike[]) {
  const s = { total: agents.length, enabled: 0, runs7d: 0, failed7d: 0, cost7d: 0, costToday: 0, queued: 0, running: 0, awaiting: 0, dead24h: 0 }
  for (const a of agents) {
    if (a.enabled) s.enabled++
    s.runs7d += toNum(a.stats.runs7d)
    s.failed7d += toNum(a.stats.failed7d)
    s.cost7d += toNum(a.stats.costUsd7d)
    s.costToday += toNum(a.stats.costUsdToday)
    s.queued += toNum(a.stats.queued)
    s.running += toNum(a.stats.running)
    s.awaiting += toNum(a.stats.awaitingApproval)
    s.dead24h += toNum(a.stats.dead24h)
  }
  return s
}

// ─── Manual run ──────────────────────────────────────────────────────────────

/** Optional JSON input of a manual run: empty → none; otherwise must be an object. */
export function parseRunInput(text: string): { ok: true; value: Record<string, unknown> | undefined } | { ok: false; error: string } {
  const t = text.trim()
  if (!t) return { ok: true, value: undefined }
  try {
    const v: unknown = JSON.parse(t)
    if (!v || typeof v !== 'object' || Array.isArray(v)) return { ok: false, error: 'Нужен JSON-объект, например {"refresh": true}' }
    return { ok: true, value: v as Record<string, unknown> }
  } catch {
    return { ok: false, error: 'Неверный JSON' }
  }
}

// ─── Agent settings form ─────────────────────────────────────────────────────

/** Same rule as the API (PATCH /api/giga-admin/agents/:key). */
export const MODEL_RE = /^[a-z0-9._-]+\/[a-z0-9._:-]+$/

export const LIMIT_RANGES = {
  perRun: { min: 0, max: 50 },
  daily: { min: 0, max: 1000 },
  maxTokens: { min: 64, max: 32000 },
} as const

export interface ConfigCurrent {
  scope: 'company' | 'platform'
  tier: string
  model: string | null
  cron: string | null
  limits: { perRunBudgetUsd: number; dailyBudgetUsd: number; maxOutputTokens: number }
}

export interface ConfigDraft {
  /** '' = keep as is, 'reset' = back to the definition's tier. */
  tier: '' | 'reset' | Tier
  model: string
  cron: string
  perRun: string
  daily: string
  maxTokens: string
  /** Fields to return to the definition's default (sent as null). */
  reset: { perRun: boolean; daily: boolean; maxTokens: boolean }
}

export interface ConfigPatchBody {
  tierOverride?: Tier | null
  modelOverride?: string | null
  scheduleCron?: string | null
  perRunBudgetUsd?: number | null
  dailyBudgetUsd?: number | null
  maxOutputTokens?: number | null
}

export type ConfigErrors = Partial<Record<'model' | 'cron' | 'perRun' | 'daily' | 'maxTokens', string>>

export function initialConfigDraft(cur: ConfigCurrent): ConfigDraft {
  return {
    tier: '',
    model: cur.model ?? '',
    cron: cur.cron ?? '',
    perRun: String(cur.limits.perRunBudgetUsd),
    daily: String(cur.limits.dailyBudgetUsd),
    maxTokens: String(cur.limits.maxOutputTokens),
    reset: { perRun: false, daily: false, maxTokens: false },
  }
}

const parseDecimal = (s: string): number => (s.trim() === '' ? NaN : Number(s.trim().replace(',', '.')))

/** Only the fields that really change, plus readable errors; nothing is sent while errors exist. */
export function buildConfigPatch(d: ConfigDraft, cur: ConfigCurrent): { patch: ConfigPatchBody; errors: ConfigErrors } {
  const patch: ConfigPatchBody = {}
  const errors: ConfigErrors = {}

  if (d.tier === 'reset') patch.tierOverride = null
  else if (d.tier && d.tier !== cur.tier) patch.tierOverride = d.tier

  const model = d.model.trim()
  if (model !== (cur.model ?? '')) {
    if (!model) patch.modelOverride = null
    else if (!MODEL_RE.test(model)) errors.model = 'Формат: provider/model строчными буквами, например anthropic/claude-sonnet-4.5'
    else patch.modelOverride = model
  }

  if (cur.scope === 'platform') {
    const cron = d.cron.trim().replace(/\s+/g, ' ')
    if (cron !== (cur.cron ?? '')) {
      if (!cron) patch.scheduleCron = null
      else if (!isValidCron(cron)) errors.cron = 'Неверное расписание: 5 полей cron (минута час день месяц день-недели), время UTC'
      else patch.scheduleCron = cron
    }
  }

  const num = (
    key: 'perRun' | 'daily' | 'maxTokens',
    field: 'perRunBudgetUsd' | 'dailyBudgetUsd' | 'maxOutputTokens',
    current: number,
    integer: boolean,
    unit: string,
  ) => {
    if (d.reset[key]) { patch[field] = null; return }
    const n = parseDecimal(d[key])
    const { min, max } = LIMIT_RANGES[key]
    if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) {
      errors[key] = `${integer ? 'Целое число' : 'Число'} от ${min} до ${max}${unit}`
      return
    }
    if (n !== current) patch[field] = n
  }
  num('perRun', 'perRunBudgetUsd', cur.limits.perRunBudgetUsd, false, ' $')
  num('daily', 'dailyBudgetUsd', cur.limits.dailyBudgetUsd, false, ' $')
  num('maxTokens', 'maxOutputTokens', cur.limits.maxOutputTokens, true, '')

  return { patch, errors }
}

// ─── Links ───────────────────────────────────────────────────────────────────

export interface FeedLinkSource {
  approval_id?: unknown
  entity_type?: unknown
  entity_id?: unknown
  agent_key?: unknown
}

/** Where a staff notification should lead in the panel (null = nowhere sensible). */
export function notificationHref(n: FeedLinkSource, base: string): { href: string; label: string } | null {
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null)
  const approval = str(n.approval_id) ?? (n.entity_type === 'agent_approval' ? str(n.entity_id) : null)
  if (approval) return { href: `${base}/agents/approvals?focus=${encodeURIComponent(approval)}`, label: 'К одобрению' }
  if (n.entity_type === 'agent_task' && str(n.entity_id)) return { href: `${base}/agents/tasks/${encodeURIComponent(str(n.entity_id)!)}`, label: 'Открыть задачу' }
  if (str(n.agent_key)) return { href: `${base}/agents/${encodeURIComponent(str(n.agent_key)!)}`, label: 'Открыть агента' }
  return null
}

/** Pretty JSON for redacted args / payloads; '—' for empty. */
export function prettyJson(v: unknown): string {
  if (v == null) return '—'
  if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0) return '—'
  if (Array.isArray(v) && v.length === 0) return '—'
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}
