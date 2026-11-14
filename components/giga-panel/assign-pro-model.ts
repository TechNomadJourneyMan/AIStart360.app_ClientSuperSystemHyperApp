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

export const ASSIGN_PRO_LABEL = 'Назначить Pro'
/** RBAC of the action — the same as the plan editor (lib/admin/rbac.ts). */
export const ASSIGN_PRO_PERMISSION = 'users.manage'
export const ASSIGN_PRO_NO_RIGHT = 'Назначить тариф может сотрудник с правом «Управление пользователями» (как в User 360 → Биллинг)'

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
    const d = (await res.json().catch(() => null)) as { ok?: boolean; message?: string; error?: string; requestClosed?: boolean; notified?: boolean } | null
    if (!res.ok || !d?.ok) return { ok: false, text: d?.message || d?.error || `Не удалось назначить Pro (HTTP ${res.status})` }
    const parts = ['Pro назначен']
    parts.push(d.requestClosed ? 'заявка закрыта как одобренная' : 'заявку закройте вручную — она не закрылась')
    if (d.notified) parts.push('клиент получил уведомление «Доступ открыт»')
    return { ok: true, text: `${parts.join(', ')}.` }
  } catch {
    return { ok: false, text: 'Нет связи с сервером' }
  }
}
