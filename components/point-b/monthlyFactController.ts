/**
 * components/point-b/monthlyFactController.ts — the brain of the «Факт за месяц» form (plan Ф6b, spec §13), free of
 * React and of the DOM so it can be tested with a fetch double (same approach as planController.ts).
 *
 * Contract: PUT <url> { period: 'YYYY-MM', values: { <kpi>: number | null }, note: string | null }
 *   → { ok, data: { period, saved, cleared, checkpoint: { status, overall, reason } } }
 *   errors { ok:false, error, code?, field? }: 400 (invalid / profanity with the field), 402 (PRO), 403 («от имени»),
 *   409 (no approved plan), 429, 503 (not enabled on the server). The text of the server is shown as it is.
 * The client URL is /api/v1/point-b/monthly-facts; the staff panels pass their own (GIGA / expert portal).
 *
 * Numbers are typed the Russian way («6 300 000», «10,8»); the form checks the limits of each KPI before sending
 * (the server checks again). An emptied field that had a value is sent as null (the value is cleared); a field that
 * was empty and stays empty is not sent.
 */
import { KPI_META, periodLabel } from '@/lib/point-b/planfact/kpis'
import type { KpiValues, PlanKpi } from '@/lib/point-b/planfact/types'

export const CLIENT_FACTS_URL = '/api/v1/point-b/monthly-facts'
export const NOTE_MAX = 500

export type FactPhase = 'idle' | 'saving' | 'saved' | 'error'

export interface FactFormSnapshot {
  period: string
  values: Partial<Record<PlanKpi, string>>
  note: string
  phase: FactPhase
  error: string | null
  /** The field the error is about (a KPI key, 'note' or 'period'). */
  field: string | null
  /** «Сохранено. Вердикт за сентябрь: на курсе.» */
  message: string | null
}

const ERROR_TEXT: Record<number, string> = {
  0: 'Нет связи с сервером. Проверьте соединение и повторите.',
  401: 'Сессия закончилась — войдите заново',
  402: 'План-факт доступен в тарифе PRO',
  403: 'Нет прав менять факты этого клиента',
  429: 'Слишком часто — попробуйте через несколько минут',
}

const VERDICT_TEXT: Record<string, string> = { on_track: 'на курсе', risk: 'есть риск', behind: 'отстаём', no_data: 'нет данных' }

/** «6 300 000» / «10,8» → a number; '' → null; anything else → NaN. */
export function parseNumber(raw: string): number | null {
  const t = raw.replace(/[\s ]/g, '').replace(',', '.')
  if (!t) return null
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : NaN
}

export function checkField(kpi: PlanKpi, raw: string): string | null {
  const n = parseNumber(raw)
  if (n === null) return null
  const m = KPI_META[kpi]
  if (!Number.isFinite(n)) return `${m.label}: нужно число`
  if (n < m.min || n > m.max) return kpi === 'conversion' ? 'Конверсия — от 0 до 100%' : `${m.label}: значение вне допустимого диапазона`
  if (m.integer && !Number.isInteger(n)) return `${m.label}: нужно целое число`
  return null
}

export class MonthlyFactController {
  private snap: FactFormSnapshot
  private listeners = new Set<() => void>()

  constructor(
    private readonly fetchFn: typeof fetch,
    private readonly opts: { url: string; kpis: PlanKpi[]; period: string; initial: KpiValues; onSaved?: () => void },
  ) {
    const values: FactFormSnapshot['values'] = {}
    for (const k of opts.kpis) values[k] = typeof opts.initial[k] === 'number' ? String(opts.initial[k]) : ''
    this.snap = { period: opts.period, values, note: '', phase: 'idle', error: null, field: null, message: null }
  }

  subscribe = (l: () => void): (() => void) => { this.listeners.add(l); return () => { this.listeners.delete(l) } }
  getSnapshot = (): FactFormSnapshot => this.snap

  private set(patch: Partial<FactFormSnapshot>): void {
    this.snap = { ...this.snap, ...patch }
    this.listeners.forEach((l) => l())
  }

  setValue(kpi: PlanKpi, raw: string): void {
    this.set({ values: { ...this.snap.values, [kpi]: raw }, ...(this.snap.field === kpi ? { error: null, field: null, phase: 'idle' as const } : {}) })
  }

  setNote(note: string): void {
    this.set({ note: note.slice(0, NOTE_MAX), ...(this.snap.field === 'note' ? { error: null, field: null, phase: 'idle' as const } : {}) })
  }

  /** The body to send, or the first problem of the form. */
  body(): { ok: true; body: { period: string; values: Partial<Record<PlanKpi, number | null>>; note: string | null } } | { ok: false; error: string; field: string } {
    const values: Partial<Record<PlanKpi, number | null>> = {}
    for (const k of this.opts.kpis) {
      const raw = this.snap.values[k] ?? ''
      const problem = checkField(k, raw)
      if (problem) return { ok: false, error: problem, field: k }
      const n = parseNumber(raw)
      if (n !== null) values[k] = n
      else if (typeof this.opts.initial[k] === 'number') values[k] = null
    }
    if (!Object.keys(values).length) return { ok: false, error: 'Внесите хотя бы одно значение', field: this.opts.kpis[0] ?? 'values' }
    return { ok: true, body: { period: this.snap.period, values, note: this.snap.note.trim() || null } }
  }

  async submit(): Promise<boolean> {
    if (this.snap.phase === 'saving') return false
    const b = this.body()
    if (!b.ok) { this.set({ phase: 'error', error: b.error, field: b.field, message: null }); return false }
    this.set({ phase: 'saving', error: null, field: null, message: null })
    try {
      const res = await this.fetchFn(this.opts.url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b.body) })
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: unknown; field?: unknown; data?: { checkpoint?: { overall?: unknown } } } | null
      if (!res.ok || !json?.ok) {
        const server = typeof json?.error === 'string' && json.error.trim() ? json.error : null
        this.set({
          phase: 'error',
          error: server && res.status !== 402 ? server : ERROR_TEXT[res.status] ?? `Не удалось сохранить (${res.status})`,
          field: typeof json?.field === 'string' ? json.field : null,
        })
        return false
      }
      const overall = typeof json.data?.checkpoint?.overall === 'string' ? VERDICT_TEXT[json.data.checkpoint.overall] : null
      this.set({ phase: 'saved', error: null, field: null, message: `Сохранено.${overall ? ` Вердикт за ${periodLabel(this.snap.period)}: ${overall}.` : ''}` })
      this.opts.onSaved?.()
      return true
    } catch {
      this.set({ phase: 'error', error: ERROR_TEXT[0], field: null })
      return false
    }
  }
}
