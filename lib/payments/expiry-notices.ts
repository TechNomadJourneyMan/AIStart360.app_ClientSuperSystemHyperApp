/**
 * lib/payments/expiry-notices.ts — предупреждения об окончании платного доступа
 * (Раунд 4, N4B-10; решение PO 2026-11-16: за 7 дней, за сутки и в день окончания —
 * клиенту лента + письмо и строка в утренней сводке персонала).
 *
 *   'd7'    — до конца срока ≤ 7 суток (и больше суток);
 *   'd1'    — до конца срока ≤ 1 суток;
 *   'ended' — срок прошёл и ночной крон перевёл кабинет на бесплатный доступ
 *             (expireDuePlans в lib/payments/billing.ts, сразу после снижения).
 * Крон /api/cron/billing-expiry (ежедневно 00:15 UTC) сначала снижает истёкшие
 * тарифы, затем рассылает 'd7' / 'd1'. Идемпотентно: ключ уведомления — этап +
 * подписка + дата окончания (журнал notifyClient), повторный прогон в те же сутки
 * ничего не повторяет, а продление (новая дата) предупредит заново.
 *
 * Чтение — только subscriptions (+ companies / profiles, чтобы найти человека):
 * живые подписки с платным тарифом. Подписок десятки, поэтому фильтр по дате —
 * в коде, а не в запросе (тот же разбор дат без зоны, что у billing-сервиса).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase-service'
import { notifyProExpiry, type ProExpiryStage } from '@/lib/notifications/product'
import { utcIso } from './plan-state'

const DAY_MS = 24 * 3_600_000
const LIVE = ['trialing', 'active', 'past_due']
const READ_LIMIT = 5000
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Sb = Pick<SupabaseClient, 'from'>

export interface PlanEnding {
  orgId: string
  userId: string
  tier: string
  /** Пробный период (trialing / pilot). */
  trial: boolean
  /** Конец пробного или оплаченного периода, ISO UTC. */
  endsAt: string
}

/** Этап предупреждения для срока `endsAt` на момент `now`; null — рано или уже прошёл. */
export function expiryStage(endsAt: string | Date, now: Date): Exclude<ProExpiryStage, 'ended'> | null {
  const end = typeof endsAt === 'string' ? Date.parse(endsAt) : endsAt.getTime()
  if (!Number.isFinite(end)) return null
  const left = end - now.getTime()
  if (left <= 0) return null
  if (left <= DAY_MS) return 'd1'
  if (left <= 7 * DAY_MS) return 'd7'
  return null
}

/** Полных суток до конца, с округлением вверх (6 сут. 23 ч → 7). */
export function daysLeft(endsAt: string, now: Date): number {
  return Math.max(1, Math.ceil((Date.parse(endsAt) - now.getTime()) / DAY_MS))
}

/** Ключ идемпотентности уведомления: этап + подписка + дата окончания. */
export function expiryNoticeKey(stage: ProExpiryStage, orgId: string, endsAt: string): string {
  return `pro_expiry:${stage}:${orgId}:${endsAt}`
}

/** orgId подписки → человек: companies.user_id, иначе сам профиль (как billing_due_expirations). */
async function resolvePeople(sb: Sb, orgIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (!orgIds.length) return out
  const { data: companies } = await sb.from('companies').select('id, user_id').in('id', orgIds)
  for (const c of (companies ?? []) as Array<{ id: string; user_id: string | null }>) if (c.user_id) out.set(String(c.id), c.user_id)
  const rest = orgIds.filter((id) => !out.has(id) && UUID_RE.test(id))
  if (rest.length) {
    const { data: people } = await sb.from('profiles').select('id').in('id', rest)
    for (const p of (people ?? []) as Array<{ id: string }>) out.set(String(p.id), String(p.id))
  }
  return out
}

interface SubRow {
  orgId: string
  tier: string
  status: string
  trialEndsAt: unknown
  currentPeriodEnd: unknown
  updatedAt?: unknown
}

function endOf(r: SubRow): string | null {
  return utcIso(r.status === 'trialing' ? r.trialEndsAt : r.currentPeriodEnd)
}

async function toPeople(sb: Sb, rows: SubRow[], pick: (r: SubRow, end: string) => boolean): Promise<PlanEnding[]> {
  const hits = rows
    .filter((r) => r.tier && r.tier !== 'free')
    .map((r) => ({ r, end: endOf(r) }))
    .filter((x): x is { r: SubRow; end: string } => x.end !== null && pick(x.r, x.end))
  const people = await resolvePeople(sb, Array.from(new Set(hits.map((h) => h.r.orgId))))
  const seen = new Set<string>()
  const out: PlanEnding[] = []
  // Nearest end first; one entry per person (a company row and a user row of the same client).
  for (const h of hits.sort((a, b) => a.end.localeCompare(b.end))) {
    const userId = people.get(h.r.orgId)
    if (!userId || seen.has(userId)) continue
    seen.add(userId)
    out.push({ orgId: h.r.orgId, userId, tier: h.r.tier, trial: h.r.status === 'trialing' || h.r.tier === 'pilot', endsAt: h.end })
  }
  return out
}

/** Живые платные подписки, срок которых кончается в (from, to]. Ошибка чтения — исключение. */
export async function findPlansEnding(sb: Sb, from: Date, to: Date): Promise<PlanEnding[]> {
  const { data, error } = await sb
    .from('subscriptions')
    .select('orgId,tier,status,trialEndsAt,currentPeriodEnd')
    .in('status', LIVE)
    .limit(READ_LIMIT)
  if (error) throw new Error(`subscriptions: ${String(error.message ?? '').slice(0, 160)}`)
  const lo = from.getTime()
  const hi = to.getTime()
  return toPeople(sb, (data ?? []) as SubRow[], (_r, end) => {
    const t = Date.parse(end)
    return t > lo && t <= hi
  })
}

/** Подписки, которые ночной крон перевёл на бесплатный доступ начиная с `since` (source 'system'). */
export async function findPlansEndedSince(sb: Sb, since: Date): Promise<PlanEnding[]> {
  const { data, error } = await sb
    .from('subscriptions')
    .select('orgId,tier,status,trialEndsAt,currentPeriodEnd,updatedAt')
    .eq('status', 'canceled')
    .eq('source', 'system')
    .order('updatedAt', { ascending: false })
    .limit(READ_LIMIT)
  if (error) throw new Error(`subscriptions: ${String(error.message ?? '').slice(0, 160)}`)
  const lo = since.getTime()
  return toPeople(sb, (data ?? []) as SubRow[], (r) => {
    const at = utcIso(r.updatedAt)
    return at !== null && Date.parse(at) >= lo
  })
}

export interface ExpiryWarningsReport {
  due: number
  sent: number
  /** Уже предупреждали на этом этапе (повторный прогон). */
  duplicate: number
  failed: number
}

/** 'd7' / 'd1' всем, у кого платный доступ кончается в ближайшие 7 суток. */
export async function sendExpiryWarnings(opts: { now?: Date } = {}, sb: Sb = createServiceClient()): Promise<ExpiryWarningsReport> {
  const now = opts.now ?? new Date()
  const plans = await findPlansEnding(sb, now, new Date(now.getTime() + 7 * DAY_MS))
  const report: ExpiryWarningsReport = { due: 0, sent: 0, duplicate: 0, failed: 0 }
  for (const p of plans) {
    const stage = expiryStage(p.endsAt, now)
    if (!stage) continue
    report.due += 1
    const res = await notifyProExpiry(p.userId, {
      stage,
      endsAt: p.endsAt,
      daysLeft: daysLeft(p.endsAt, now),
      trial: p.trial,
      dedupeKey: expiryNoticeKey(stage, p.orgId, p.endsAt),
    })
    if (res.skipped === 'duplicate') report.duplicate += 1
    else if (res.ok) report.sent += 1
    else report.failed += 1
  }
  return report
}

/** «Доступ закончился» — сразу после того, как крон перевёл кабинет на бесплатный. Никогда не бросает. */
export async function notifyPlanEnded(input: { orgId: string; userId: string; endsAt: string | null; trial: boolean }): Promise<boolean> {
  try {
    const endsAt = utcIso(input.endsAt) ?? new Date().toISOString()
    const res = await notifyProExpiry(input.userId, {
      stage: 'ended',
      endsAt,
      trial: input.trial,
      dedupeKey: expiryNoticeKey('ended', input.orgId, endsAt),
    })
    return res.ok
  } catch (err) {
    console.error('[billing/expiry] ended notice failed:', input.orgId, err instanceof Error ? err.message : err)
    return false
  }
}
