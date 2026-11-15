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
 * (the server checks again). R3-PB check N2 — per KPI, not per month: ONLY the KPIs whose value changed are sent (an
 * emptied field that had a value as null); an unchanged value never goes, so a save never re-labels who entered it.
 * For the owner the KPIs an expert entered are read-only (`lockExpert`); the server refuses them anyway.
 * R3-PB check N4: `months` — the current month and up to 24 back; `selectPeriod` switches the form to a month with its
 * own stored values (an older reconciled month is corrected here).
 */
import { KPI_META, periodLabel } from '@/lib/point-b/planfact/kpis'
import type { KpiValues, PlanKpi } from '@/lib/point-b/planfact/types'

export const CLIENT_FACTS_URL = '/api/v1/point-b/monthly-facts'
export const NOTE_MAX = 500

export type FactPhase = 'idle' | 'saving' | 'saved' | 'error'

export interface FactFormSnapshot {
  period: string
  values: Partial<Record<PlanKpi, string>>
  /** KPIs of this month the owner may not change (an expert entered them); absent = none. */
  locked?: PlanKpi[]
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

export interface FactFormMonth { period: string; values: KpiValues; byExpert: PlanKpi[] }

export interface MonthlyFactOptions {
  url: string
  kpis: PlanKpi[]
  period: string
  initial: KpiValues
  /** The KPIs of `period` an expert entered. */
  byExpert?: PlanKpi[]
  /** The owner's form: the expert's KPIs are read-only. The staff form edits every KPI. */
  lockExpert?: boolean
  /** Months the form may switch to (newest first); empty = only `period`. */
  months?: FactFormMonth[]
  onSaved?: () => void
}

const sameNumber = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b))

export class MonthlyFactController {
  private snap: FactFormSnapshot
  private listeners = new Set<() => void>()
  /** The stored values of the shown month — what «changed» is measured against. */
  private base: KpiValues
  private months: FactFormMonth[]

  constructor(private readonly fetchFn: typeof fetch, private readonly opts: MonthlyFactOptions) {
    this.months = (opts.months ?? []).map((m) => ({ ...m, values: { ...m.values }, byExpert: [...m.byExpert] }))
    if (!this.months.some((m) => m.period === opts.period)) this.months.unshift({ period: opts.period, values: { ...opts.initial }, byExpert: [...(opts.byExpert ?? [])] })
    const month = this.months.find((m) => m.period === opts.period)!
    this.base = { ...month.values }
    this.snap = { period: opts.period, values: this.textOf(month.values), locked: this.lockedOf(month), note: '', phase: 'idle', error: null, field: null, message: null }
  }

  private textOf(values: KpiValues): FactFormSnapshot['values'] {
    const out: FactFormSnapshot['values'] = {}
    for (const k of this.opts.kpis) out[k] = typeof values[k] === 'number' ? String(values[k]) : ''
    return out
  }

  private lockedOf(m: FactFormMonth): PlanKpi[] {
    return this.opts.lockExpert ? m.byExpert.filter((k) => this.opts.kpis.includes(k)) : []
  }

  /** The months the form offers (newest first). */
  get periods(): string[] { return this.months.map((m) => m.period) }

  /** Switch the form to another month: its own stored values, its own locked KPIs; nothing typed is kept. */
  selectPeriod(period: string): void {
    const m = this.months.find((x) => x.period === period)
    if (!m || this.snap.phase === 'saving') return
    this.base = { ...m.values }
    this.set({ period, values: this.textOf(m.values), locked: this.lockedOf(m), note: '', phase: 'idle', error: null, field: null, message: null })
  }

  subscribe = (l: () => void): (() => void) => { this.listeners.add(l); return () => { this.listeners.delete(l) } }
  getSnapshot = (): FactFormSnapshot => this.snap

  private set(patch: Partial<FactFormSnapshot>): void {
    this.snap = { ...this.snap, ...patch }
    this.listeners.forEach((l) => l())
  }

  setValue(kpi: PlanKpi, raw: string): void {
    if ((this.snap.locked ?? []).includes(kpi)) return
    this.set({ values: { ...this.snap.values, [kpi]: raw }, ...(this.snap.field === kpi ? { error: null, field: null, phase: 'idle' as const } : {}) })
  }

  setNote(note: string): void {
    this.set({ note: note.slice(0, NOTE_MAX), ...(this.snap.field === 'note' ? { error: null, field: null, phase: 'idle' as const } : {}) })
  }

  /** The body to send — ONLY the changed KPIs (check N2) — or the first problem of the form. */
  body(): { ok: true; body: { period: string; values: Partial<Record<PlanKpi, number | null>>; note: string | null } } | { ok: false; error: string; field: string } {
    const values: Partial<Record<PlanKpi, number | null>> = {}
    for (const k of this.opts.kpis) {
      if ((this.snap.locked ?? []).includes(k)) continue
      const raw = this.snap.values[k] ?? ''
      const problem = checkField(k, raw)
      if (problem) return { ok: false, error: problem, field: k }
      const n = parseNumber(raw)
      const was = this.base[k]
      if (n === null) {
        if (typeof was === 'number') values[k] = null
      } else if (typeof was !== 'number' || !sameNumber(was, n)) {
        values[k] = n
      }
    }
    if (!Object.keys(values).length) {
      const anyValue = this.opts.kpis.some((k) => typeof this.base[k] === 'number' || parseNumber(this.snap.values[k] ?? '') !== null)
      return { ok: false, error: anyValue ? 'Изменений нет — поменяйте или добавьте хотя бы одно значение' : 'Внесите хотя бы одно значение', field: this.opts.kpis.find((k) => !(this.snap.locked ?? []).includes(k)) ?? 'values' }
    }
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
      // What is stored now is the new base: a second save sends only what changes after it.
      for (const [k, v] of Object.entries(b.body.values) as Array<[PlanKpi, number | null]>) {
        if (v === null) delete this.base[k]
        else this.base[k] = v
      }
      const month = this.months.find((m) => m.period === b.body.period)
      if (month) month.values = { ...this.base }
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
