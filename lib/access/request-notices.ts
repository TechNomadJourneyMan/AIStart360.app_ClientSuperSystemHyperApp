/**
 * lib/access/request-notices.ts — персонал узнаёт о заявке на оплату (Раунд 4, N4B-1;
 * решение PO 2026-11-16: заявки разбирают Admin и Super Admin, срок ответа 4 ч).
 *
 *   • Новая заявка или новый раздел к открытой заявке → СРАЗУ запись в ленте
 *     персонала (notification_events, ГИГА «Уведомления») и Telegram тем Admin /
 *     Super Admin, кто привязал Telegram к аккаунту (lib/notifications/staff.ts) —
 *     и в тихие часы тоже (WB-1: это деньги, а не шум; «без звука» и уровни
 *     уведомлений сотрудника действуют). Ключ дедупликации — заявка (и раздел):
 *     повтор того же раздела, двойной клик или повторный вызов ничего второй раз
 *     не шлют.
 *   • В тексте — имя и компания клиента, раздел и ссылка в ГИГА; e-mail клиента
 *     НЕ пишется (WB-2): ленту видит любой сотрудник панели, а e-mail положен
 *     только ролям с users.sensitive — он в карточке заявки и в User 360.
 *   • Адресаты Telegram — только Admin и Super Admin. Нет ни одного одобренного
 *     или список не прочитался → только лента ГИГА (WB-7), без рассылки всему
 *     персоналу и в чаты администраторов из окружения.
 *   • Срок ответа — настройка request_sla_hours (по умолчанию 4 ч) от создания
 *     заявки. Его видно в карточке заявки («Заявки» → «Доступы»), просрочка
 *     подсвечивается, у пункта «Заявки» — бейдж (GET /api/giga-admin/nav-badges).
 *   • Просроченная открытая заявка → ОДНО напоминание-эскалация тем же людям
 *     (ключ access_request.overdue:<id>), крон /api/cron/access-requests каждые
 *     15 минут. В тихие часы уведомлений (ночью) напоминание ждёт утра: иначе
 *     Telegram его пропустил бы, а второго не будет. Прерванную отправку
 *     (процесс убит, сбой базы после записи в ленту) следующие проходы в течение
 *     часа досылают тем же ключом (WB-8); отказ самого Telegram окончателен —
 *     заявка остаётся в ленте, красным бейджем и в утренней сводке.
 *
 * Тумблер «Заявка на оплату» в «Настройки → Уведомления администраторам»
 * (admin_notifications.access_requested, по умолчанию включён) выключает и
 * уведомление, и напоминание; бейдж, карточка и утренняя сводка остаются.
 * Ни одна функция не бросает наружу из фоновой отправки: заявка уже сохранена.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSetting } from '@/lib/settings/store'
import { plural } from '@/lib/crm/digest'
import { utcIso } from '@/lib/payments/plan-state'
import type { StaffNotification } from '@/lib/notifications/staff'
import { ACCESS_REQUEST_SOURCES, OPEN_REQUEST_STATUSES, featureLabel, requestFeatures, type RequestPerson } from './upgrade-requests'

export const REQUESTS_PATH = '/admin-giga-panel/requests'
export const DEFAULT_REQUEST_SLA_HOURS = 4
export const ACCESS_REQUEST_NEW = 'access_request.new'
export const ACCESS_REQUEST_ADDED = 'access_request.added'
export const ACCESS_REQUEST_OVERDUE = 'access_request.overdue'

const HOUR_MS = 3_600_000
const SCAN_LIMIT = 500

type Sb = Pick<SupabaseClient, 'from'>

/** Срок ответа на заявку, часов (настройка request_sla_hours; ошибка чтения — 4). */
export async function requestSlaHours(): Promise<number> {
  try {
    const h = await getSetting('request_sla_hours')
    return typeof h === 'number' && Number.isFinite(h) && h > 0 ? h : DEFAULT_REQUEST_SLA_HOURS
  } catch {
    return DEFAULT_REQUEST_SLA_HOURS
  }
}

/** Когда истекает срок ответа: создание заявки + `hours`. "createdAt" без зоны — это UTC (Prisma). */
export function requestSlaDueAt(createdAt: unknown, hours: number): string | null {
  const iso = utcIso(createdAt)
  if (!iso) return null
  return new Date(Date.parse(iso) + hours * HOUR_MS).toISOString()
}

/** «16.11, 14:00» по Алматы. */
export function almatyTime(iso: string): string {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return iso
  return new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Almaty', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(d)
}

/** «5 часов» / «3 дня». */
export function waitLabel(hours: number): string {
  const h = Math.max(0, Math.floor(hours))
  if (h < 48) return `${h} ${plural(h, 'час', 'часа', 'часов')}`
  const days = Math.floor(h / 24)
  return `${days} ${plural(days, 'день', 'дня', 'дней')}`
}

/** Тумблер «Заявка на оплату» (admin_notifications.access_requested). Настройки недоступны — включено. */
export async function requestNoticesEnabled(): Promise<boolean> {
  try {
    const n = await getSetting('admin_notifications')
    return (n as Record<string, boolean | undefined>).access_requested !== false
  } catch {
    return true
  }
}

/**
 * Кто разбирает заявку на оплату: одобренные Admin и Super Admin (staff_roles).
 * Ошибка чтения — исключение (вызывающий решает, что делать).
 */
export async function requestDeciders(sb: Sb): Promise<string[]> {
  const { data, error } = await sb.from('staff_roles').select('user_id, role').in('role', ['admin', 'super_admin'])
  if (error) throw new Error(`request deciders: ${String(error.message ?? '').slice(0, 120)}`)
  const ids = Array.from(new Set(((data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id).filter(Boolean)))
  if (!ids.length) return []
  const { data: people, error: pErr } = await sb.from('profiles').select('id, status').in('id', ids)
  if (pErr) throw new Error(`request deciders: ${String(pErr.message ?? '').slice(0, 120)}`)
  const approved = new Set(((people ?? []) as Array<{ id: string; status: string | null }>).filter((p) => p.status === 'approved').map((p) => p.id))
  return ids.filter((id) => approved.has(id))
}

/**
 * Адресаты Telegram: Admin / Super Admin. Никого нет или список не прочитался —
 * [] (только лента ГИГА, WB-7): заявку с данными клиента не рассылаем всему
 * персоналу и в чаты администраторов из окружения.
 */
async function audienceOf(sb: Sb): Promise<string[]> {
  try {
    return await requestDeciders(sb)
  } catch (err) {
    console.error('[request-notices] deciders unavailable:', err instanceof Error ? err.message : err)
    return []
  }
}

export interface AccessRequestInfo {
  requestId: string
  userId: string
  person: RequestPerson
  features: string[]
  /** Раздел, дописанный в уже открытую заявку; null — новая заявка. */
  added: string | null
  /** Создание заявки ("createdAt"); null — только что (новая заявка). */
  createdAt: string | null
}

function who(person: RequestPerson): string {
  return `${person.name}${person.company ? ` · ${person.company}` : ''}`
}

/** Уведомление персоналу о новой заявке / новом разделе (чистая функция). */
export function accessRequestNotice(info: AccessRequestInfo, opts: { slaHours: number; now: Date; audience: string[] }): StaffNotification {
  const labels = info.features.map(featureLabel).join(', ')
  const due = requestSlaDueAt(info.createdAt ?? opts.now, opts.slaHours)
  const added = info.added
  return {
    level: 'WARNING',
    type: added ? ACCESS_REQUEST_ADDED : ACCESS_REQUEST_NEW,
    title: (added
      ? `Раздел к заявке на оплату: ${featureLabel(added)} — ${who(info.person)}`
      : `Новая заявка на оплату: ${who(info.person)}`).slice(0, 200),
    lines: [
      `Клиент: ${who(info.person)}`,
      `Разделы: ${labels || '—'}`,
      ...(due ? [`Ответить до ${almatyTime(due)} (Алматы) — срок ${opts.slaHours} ч.`] : []),
      'Онлайн-оплата не подключена: свяжитесь с клиентом и нажмите «Назначить Pro» в «Заявки» → «Доступы» (или отклоните с причиной).',
    ],
    entityType: 'admin_request',
    entityId: info.requestId,
    link: REQUESTS_PATH,
    dedupeKey: added ? `${ACCESS_REQUEST_ADDED}:${info.requestId}:${added}` : `${ACCESS_REQUEST_NEW}:${info.requestId}`,
    audienceUserIds: opts.audience,
    // Ключ уже ограничивает повтор; общий cooldown по типу заглушил бы заявку другого клиента.
    skipCooldown: true,
    // WB-1: «сразу» — и ночью; «без звука» и уровни сотрудника действуют.
    quietHoursExempt: true,
    data: { requestId: info.requestId, userId: info.userId, features: info.features, ...(added ? { added } : {}) },
  }
}

export type RequestNoticeOutcome = 'sent' | 'disabled' | 'failed'

/** Новая заявка / новый раздел → лента + Telegram Admin / Super Admin. Никогда не бросает. */
export async function notifyStaffAccessRequested(sb: Sb, info: AccessRequestInfo, now: Date = new Date()): Promise<RequestNoticeOutcome> {
  try {
    if (!(await requestNoticesEnabled())) return 'disabled'
    const [slaHours, audience] = await Promise.all([requestSlaHours(), audienceOf(sb)])
    const { notifyStaff } = await import('@/lib/notifications/staff')
    await notifyStaff(accessRequestNotice(info, { slaHours, now, audience }))
    return 'sent'
  } catch (err) {
    console.error('[request-notices] staff notice failed:', err instanceof Error ? err.message : err)
    return 'failed'
  }
}

// ─── Просрочка ───────────────────────────────────────────────────────────────

export interface OpenPaidRequest {
  id: string
  userId: string | null
  person: RequestPerson
  features: string[]
  createdAt: string
}

/** Открытые заявки на платный доступ, старые первыми. Ошибка чтения — исключение. */
export async function loadOpenPaidRequests(sb: Sb, limit = SCAN_LIMIT): Promise<OpenPaidRequest[]> {
  const { data, error } = await sb
    .from('admin_requests')
    .select('id, payload, createdAt')
    .eq('type', 'access')
    .in('source', [...ACCESS_REQUEST_SOURCES])
    .in('status', [...OPEN_REQUEST_STATUSES])
    .order('createdAt', { ascending: true })
    .limit(limit)
  if (error) throw new Error(`open paid requests: ${String(error.message ?? '').slice(0, 160)}`)
  const out: OpenPaidRequest[] = []
  for (const r of (data ?? []) as Array<{ id: string; payload: Record<string, unknown> | null; createdAt: unknown }>) {
    const createdAt = utcIso(r.createdAt)
    if (!createdAt) continue
    const p = r.payload ?? {}
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
    out.push({
      id: String(r.id),
      userId: str(p.userId),
      person: { name: str(p.name) ?? 'Клиент', email: str(p.email) ?? '—', company: str(p.company) },
      features: requestFeatures(p),
      createdAt,
    })
  }
  return out
}

export interface RequestSlaSummary {
  open: number
  overdue: number
  /** Возраст самой старой открытой заявки, часов; null — заявок нет. */
  oldestHours: number | null
}

export function summarizeRequestSla(rows: Array<{ createdAt: string }>, slaHours: number, now: Date): RequestSlaSummary {
  const ages = rows.map((r) => (now.getTime() - Date.parse(r.createdAt)) / HOUR_MS).filter((h) => Number.isFinite(h) && h >= 0)
  return {
    open: rows.length,
    overdue: ages.filter((h) => h >= slaHours).length,
    oldestHours: ages.length ? Math.floor(Math.max(...ages)) : null,
  }
}

/** Напоминание-эскалация по одной просроченной заявке (чистая функция). */
export function overdueNotice(r: OpenPaidRequest, opts: { slaHours: number; now: Date; audience: string[] }): StaffNotification {
  const age = (opts.now.getTime() - Date.parse(r.createdAt)) / HOUR_MS
  return {
    level: 'WARNING',
    type: ACCESS_REQUEST_OVERDUE,
    title: `Заявка на оплату ждёт дольше ${opts.slaHours} ч: ${who(r.person)}`.slice(0, 200),
    lines: [
      `Клиент: ${who(r.person)}`,
      `Разделы: ${r.features.map(featureLabel).join(', ') || '—'}`,
      `Заявка оставлена ${almatyTime(r.createdAt)} (Алматы), ждёт ${waitLabel(age)}.`,
      'Свяжитесь с клиентом: «Назначить Pro» или «Отклонить» с причиной в «Заявки» → «Доступы». Это единственное напоминание по заявке.',
    ],
    entityType: 'admin_request',
    entityId: r.id,
    link: REQUESTS_PATH,
    dedupeKey: `${ACCESS_REQUEST_OVERDUE}:${r.id}`,
    audienceUserIds: opts.audience,
    skipCooldown: true,
    data: { requestId: r.id, userId: r.userId, features: r.features },
  }
}

export interface OverdueReport {
  open: number
  overdue: number
  /** Напоминаний отправлено в этот проход (впервые). */
  notified: number
  /** Почему проход ничего не отправил. */
  skipped?: 'disabled' | 'quiet_hours'
}

/**
 * WB-8: сколько после записи в ленту проходы ещё зовут notifyStaff тем же ключом.
 * notifyStaff идемпотентен: отправленным второй раз ничего не уходит, а доставку,
 * которую прервал убитый процесс (нет строки или «queued» старше 120 с), он
 * досылает. Четыре прохода по 15 минут — достаточно, дальше не нагружаем базу.
 */
export const RESUME_WINDOW_MS = 60 * 60_000

/** Когда напоминание попало в ленту, по ключу (чтобы не дёргать notifyStaff каждые 15 минут вечно). */
async function escalatedAt(sb: Sb, keys: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (!keys.length) return out
  try {
    const { data, error } = await sb.from('notification_events').select('dedupe_key, created_at').in('dedupe_key', keys)
    if (error) return out
    for (const r of (data ?? []) as Array<{ dedupe_key: string | null; created_at: string | null }>) {
      if (!r.dedupe_key) continue
      const at = Date.parse(String(r.created_at ?? ''))
      out.set(r.dedupe_key, Number.isFinite(at) ? at : 0)
    }
  } catch {
    /* no pre-check: notifyStaff dedupes by the key anyway */
  }
  return out
}

/**
 * Проход крона: каждая открытая заявка старше срока получает ОДНО напоминание.
 * Повторный проход ничего не повторяет (ключ в ленте); прерванную отправку
 * досылает в течение часа (WB-8). Ночью — пропуск до утра.
 */
export async function escalateOverdueAccessRequests(sb: Sb, now: Date = new Date(), deps: {
  notifyStaff?: (n: StaffNotification) => Promise<{ duplicate?: boolean } | unknown>
} = {}): Promise<OverdueReport> {
  const slaHours = await requestSlaHours()
  const rows = await loadOpenPaidRequests(sb)
  const overdue = rows.filter((r) => now.getTime() - Date.parse(r.createdAt) >= slaHours * HOUR_MS)
  const report: OverdueReport = { open: rows.length, overdue: overdue.length, notified: 0 }
  if (!overdue.length) return report
  if (!(await requestNoticesEnabled())) return { ...report, skipped: 'disabled' }
  const { inQuietHours, routingConfig } = await import('@/lib/notifications/levels')
  if (inQuietHours('WARNING', routingConfig(), now)) return { ...report, skipped: 'quiet_hours' }

  const recorded = await escalatedAt(sb, overdue.map((r) => `${ACCESS_REQUEST_OVERDUE}:${r.id}`))
  // Not yet in the feed, or recorded less than an hour ago (a run killed midway is resumed).
  const fresh = overdue.filter((r) => {
    const at = recorded.get(`${ACCESS_REQUEST_OVERDUE}:${r.id}`)
    return at === undefined || now.getTime() - at < RESUME_WINDOW_MS
  })
  if (!fresh.length) return report
  const audience = await audienceOf(sb)
  const send = deps.notifyStaff ?? (async (n: StaffNotification) => (await import('@/lib/notifications/staff')).notifyStaff(n))
  for (const r of fresh) {
    try {
      const res = (await send(overdueNotice(r, { slaHours, now, audience }))) as { duplicate?: boolean } | null | undefined
      if (!res?.duplicate) report.notified += 1
    } catch (err) {
      // One failed notice does not stop the pass. The next passes call notifyStaff with the
      // same key again (within RESUME_WINDOW_MS of the feed row, or until there is one): it
      // records nothing twice and delivers to whoever this run did not reach.
      console.error('[request-notices] overdue notice failed:', r.id, err instanceof Error ? err.message : err)
    }
  }
  return report
}
