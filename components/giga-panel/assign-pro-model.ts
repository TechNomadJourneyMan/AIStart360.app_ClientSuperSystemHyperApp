/**
 * components/giga-panel/assign-pro-model.ts — framework-free part of
 * «Назначить Pro» in GIGA «Заявки» → «Доступы» (R2-C, decision of the PO on
 * M-5 / Q7), testable without a DOM.
 *
 * A request for paid access (source 'paywall' — incl. the «pilot» section — or
 * the old 'upgrade_modal') is approved by assigning the plan, not by a bare
 * «Принять»: POST /api/giga-admin/requests/:id/assign-pro { months | periodEnd,
 * note } → setPlan (the same path and rights as User 360 → Биллинг), the request
 * closes as approved, the client gets «Доступ открыт» in the feed.
 */
import { PLAN_TIER_LABEL } from '@/lib/payments/plan-state'
import { GIGA_BASE } from '@/lib/admin/nav'

export const ASSIGN_PRO_LABEL = 'Назначить Pro'
/** RBAC of the action — the same as the plan editor (lib/admin/rbac.ts). */
export const ASSIGN_PRO_PERMISSION = 'users.manage'
export const ASSIGN_PRO_NO_RIGHT = 'Назначить тариф может сотрудник с правом «Управление пользователями» (как в User 360 → Биллинг)'
/** The client is outside the actor's scope («свои клиенты») — the server would answer 403 (verify L-3). */
export const ASSIGN_PRO_OUT_OF_SCOPE = 'Клиент не назначен вам — тариф назначает его ответственный или сотрудник с доступом ко всем клиентам'

/** Why «Назначить Pro» is inactive for this request; null — it is active. */
export function assignProBlockedReason(canAssign: boolean, request: { assignable?: boolean }): string | null {
  if (!canAssign) return ASSIGN_PRO_NO_RIGHT
  if (request.assignable === false) return ASSIGN_PRO_OUT_OF_SCOPE
  return null
}

/** Shown in the form while the period is not complete; the button is locked (review L-3). */
export const ASSIGN_PRO_PERIOD_ERROR = 'Укажите срок: целое число месяцев от 1 до 36 или дату окончания.'
/** The plan is set but this request did not close (closed meanwhile / a DB error): «Принять» is no longer a way. */
export const ASSIGN_PRO_NOT_CLOSED = 'заявка не закрылась — обновите список; если она осталась открытой, отправьте её в архив'

export type AssignProMode = 'months' | 'date' | 'none'

export interface AssignProForm {
  mode: AssignProMode
  months: string
  date: string
  note: string
}

export const DEFAULT_ASSIGN_PRO_FORM: AssignProForm = { mode: 'months', months: '1', date: '', note: '' }

/** Is this a request for PAID access (approved only by assigning the plan)? */
export function isTariffRequest(r: { category?: string | null; source?: string | null }): boolean {
  return r.category === 'access' && (r.source === 'paywall' || r.source === 'upgrade_modal')
}

/** The form → the request body; null when the form is not complete. */
export function assignProBody(f: AssignProForm): { months?: number; periodEnd?: string; note?: string } | null {
  const note = f.note.trim()
  const base = note ? { note } : {}
  if (f.mode === 'none') return base
  if (f.mode === 'months') {
    const n = Number(f.months)
    if (!Number.isInteger(n) || n < 1 || n > 36) return null
    return { ...base, months: n }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) return null
  return { ...base, periodEnd: f.date }
}

/** Human summary of the period for the dialog («на 3 мес.», «до 31.12.2026», «бессрочно»). */
export function assignProPeriodText(f: AssignProForm): string {
  if (f.mode === 'none') return 'бессрочно'
  if (f.mode === 'months') return `на ${f.months || '?'} мес.`
  const [y, m, d] = f.date.split('-')
  return f.date ? `до ${d}.${m}.${y}` : 'до даты'
}

export type AssignProOutcome =
  | { ok: true; text: string }
  | { ok: false; text: string }

/** POST the assignment; the answer as a toast text. */
export async function sendAssignPro(fetchFn: typeof fetch, requestId: string, body: Record<string, unknown>): Promise<AssignProOutcome> {
  try {
    const res = await fetchFn(`/api/giga-admin/requests/${encodeURIComponent(requestId)}/assign-pro`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    })
    const d = (await res.json().catch(() => null)) as { ok?: boolean; message?: string; error?: string; requestClosed?: boolean; notified?: boolean; extended?: boolean; unchanged?: boolean; plan?: { tier?: string } | null } | null
    if (!res.ok || !d?.ok) return { ok: false, text: d?.message || d?.error || `Не удалось назначить Pro (HTTP ${res.status})` }
    if (d.unchanged) {
      // verify (Info): the plan was already paid and open-ended — nothing was assigned.
      const label = (PLAN_TIER_LABEL as Record<string, string>)[String(d.plan?.tier ?? '')] ?? 'Pro'
      return { ok: true, text: `Тариф уже ${label} без срока — назначать нечего; заявка закрыта как одобренная${d.notified ? ', клиент получил уведомление «Доступ открыт»' : ''}.` }
    }
    const parts = [d.extended ? 'Оплаченный период продлён' : 'Pro назначен']
    parts.push(d.requestClosed ? 'заявка закрыта как одобренная' : ASSIGN_PRO_NOT_CLOSED)
    if (d.notified) parts.push('клиент получил уведомление «Доступ открыт» (лента, почта и Telegram, если привязан)')
    return { ok: true, text: `${parts.join(', ')}.` }
  } catch {
    return { ok: false, text: 'Нет связи с сервером' }
  }
}

// ─── R4: срок ответа и ссылки на клиента в карточке заявки ───────────────────

const HOUR_MS = 3_600_000

function almaty(iso: string): string {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return iso
  return new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Almaty', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(d)
}

function lateLabel(hours: number): string {
  const h = Math.max(1, Math.floor(hours))
  if (h < 48) return `${h} ч`
  return `${Math.floor(h / 24)} дн.`
}

export interface RequestSlaView {
  overdue: boolean
  text: string
}

/**
 * N4B-1 (решение PO 2026-11-16): срок ответа на заявку на оплату — 4 ч (настройка
 * request_sla_hours). Карточка ожидающей заявки показывает «Ответить до …», а
 * после срока — «Срок ответа прошёл … — просрочено на …» (подсвечено).
 */
export function requestSlaView(r: { status?: string | null; slaDueAt?: string | null }, now: Date = new Date()): RequestSlaView | null {
  if (r.status !== 'pending' || !r.slaDueAt) return null
  const due = Date.parse(r.slaDueAt)
  if (!Number.isFinite(due)) return null
  if (due <= now.getTime()) {
    return { overdue: true, text: `Срок ответа прошёл ${almaty(r.slaDueAt)} (Алматы) — просрочено на ${lateLabel((now.getTime() - due) / HOUR_MS)}` }
  }
  return { overdue: false, text: `Ответить до ${almaty(r.slaDueAt)} (Алматы)` }
}

export const OPEN_CLIENT_LABEL = 'Открыть клиента (User 360)'
export const WRITE_CLIENT_LABEL = 'Написать в «Сообщения»'

/** N4B-9: из карточки заявки — к клиенту (User 360) и в его переписку («Сообщения»). */
export function requestClientLinks(userId: string | null | undefined): { user360: string; messages: string } | null {
  if (!userId || !/^[0-9a-f-]{36}$/i.test(userId)) return null
  return {
    user360: `${GIGA_BASE}/users/${userId}`,
    messages: `${GIGA_BASE}/messages?user=${userId}`,
  }
}
