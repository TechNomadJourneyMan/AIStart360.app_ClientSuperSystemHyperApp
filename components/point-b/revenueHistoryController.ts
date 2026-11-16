/**
 * components/point-b/revenueHistoryController.ts — the brain of «Выручка по месяцам» on the «Финмодель» tab (R3, M2),
 * free of React and of the DOM so it is tested with a fetch double (same approach as monthlyFactController.ts).
 *
 * Contract (app/api/v1/point-b/revenue-history):
 *   GET → { ok, data: { months: [{ period, revenue, source }], run, needed, stale, minMonths } }
 *   PUT { months: [{ period, revenue: number | null }] } → the same table
 *   errors { ok:false, error, code?, field? }: 400 (with the field `months[i].revenue`), 402 (PRO), 403 («от имени»),
 *   409 (no company), 429, 503 (not enabled on the server). The text of the server is shown as it is.
 * Amounts are typed the Russian way («6 300 000», «1250000,5»), ₸ per month. Only changed months are sent; a month
 * emptied by the owner is sent as null (cleared). After a save `onSaved` reloads the page state — the overview gets the
 * forecast once 12 months in a row are there.
 */
import { periodLabel } from '@/lib/point-b/planfact/kpis'

export const REVENUE_HISTORY_URL = '/api/v1/point-b/revenue-history'

export type RevenueSource = 'owner' | 'reconciliation' | 'data'

export interface RevenueRowView {
  period: string
  label: string
  /** What is typed in the field. */
  text: string
  /** The stored value (null = none). */
  original: number | null
  source: RevenueSource | null
}

export interface RevenueHistorySnapshot {
  phase: 'loading' | 'ready' | 'error' | 'locked'
  rows: RevenueRowView[]
  run: number
  needed: number
  stale: boolean
  minMonths: number
  saving: boolean
  error: string | null
  /** The period the error is about. */
  field: string | null
  message: string | null
}

export const INITIAL_REVENUE_SNAPSHOT: RevenueHistorySnapshot = {
  phase: 'loading', rows: [], run: 0, needed: 12, stale: false, minMonths: 12, saving: false, error: null, field: null, message: null,
}

export const SOURCE_LABEL: Record<RevenueSource, string> = {
  owner: 'внесено вами',
  reconciliation: 'факт сверки — меняется в «План-факте»',
  data: 'из документов',
}

/** A month reconciled through «Факт за месяц» is read-only here: it is corrected in the plan-fact form (review M1). */
export const isLocked = (r: Pick<RevenueRowView, 'source'>): boolean => r.source === 'reconciliation'

const ERROR_TEXT: Record<number, string> = {
  0: 'Нет связи с сервером. Проверьте соединение и повторите.',
  401: 'Сессия закончилась — войдите заново',
  403: 'В режиме просмотра от имени пользователя данные не меняются',
  429: 'Слишком часто — попробуйте через несколько минут',
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

/** 1250000 → «1 250 000». */
export function fmtAmount(n: number | null): string {
  if (!finite(n)) return ''
  const [i, f] = String(Math.round(n * 100) / 100).split('.')
  return `${i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}${f ? `,${f}` : ''}`
}

/** «1 250 000», «1250000,5» → number; '' → null; anything else → NaN. */
export function parseAmount(text: string): number | null {
  const t = text.replace(/[\s  ]/g, '').replace(',', '.')
  if (!t) return null
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : NaN
}

export function parseRevenueTable(body: unknown): Omit<RevenueHistorySnapshot, 'phase' | 'saving' | 'error' | 'field' | 'message'> | null {
  if (!isObj(body) || body.ok !== true || !isObj(body.data) || !Array.isArray(body.data.months)) return null
  const d = body.data
  const rows = (d.months as unknown[]).filter(isObj).filter((m) => typeof m.period === 'string').map((m): RevenueRowView => {
    const original = finite(m.revenue) ? m.revenue : null
    const source = m.source === 'owner' || m.source === 'reconciliation' || m.source === 'data' ? m.source : null
    return { period: m.period as string, label: periodLabel(m.period as string), text: fmtAmount(original), original, source }
  })
  return {
    rows,
    run: finite(d.run) ? d.run : 0,
    needed: finite(d.needed) ? d.needed : 12,
    stale: d.stale === true,
    minMonths: finite(d.minMonths) ? d.minMonths : 12,
  }
}

/** The months to send: changed ones; an emptied month that had a value → null. Invalid text → the period of the first. */
export function changedMonths(rows: RevenueRowView[]): { months: Array<{ period: string; revenue: number | null }>; invalid: string | null } {
  const months: Array<{ period: string; revenue: number | null }> = []
  for (const r of rows) {
    if (isLocked(r)) continue
    const v = parseAmount(r.text)
    // > 0 like the server and the model: no revenue — leave the month empty (review L3).
    if (v !== null && (!Number.isFinite(v) || v <= 0)) return { months: [], invalid: r.period }
    if (v === null && r.original === null) continue
    if (v !== null && r.original !== null && Math.abs(v - r.original) < 0.005) continue
    months.push({ period: r.period, revenue: v })
  }
  return { months, invalid: null }
}

/** «12 месяцев подряд — прогноз считается» / «Месяцев подряд: 5 из 12». */
export function runText(s: Pick<RevenueHistorySnapshot, 'run' | 'needed' | 'stale' | 'minMonths'>): string {
  if (s.stale) return 'Последний внесённый месяц старше четырёх месяцев — внесите свежие месяцы, и прогноз пересчитается.'
  if (s.needed === 0) return `Внесено ${s.run} мес. подряд — этого достаточно для прогноза «при текущем ходе».`
  return `Месяцев подряд: ${s.run} из ${s.minMonths}. Для прогноза «при текущем ходе» нужно ещё ${s.needed}.`
}

export class RevenueHistoryController {
  private snap: RevenueHistorySnapshot = INITIAL_REVENUE_SNAPSHOT
  private listeners = new Set<() => void>()

  constructor(private readonly fetchFn: typeof fetch, private readonly opts: { onSaved?: () => void; url?: string } = {}) {}

  subscribe = (l: () => void): (() => void) => { this.listeners.add(l); return () => { this.listeners.delete(l) } }
  getSnapshot = (): RevenueHistorySnapshot => this.snap

  private set(patch: Partial<RevenueHistorySnapshot>): void {
    this.snap = { ...this.snap, ...patch }
    this.listeners.forEach((l) => l())
  }

  private get url(): string { return this.opts.url ?? REVENUE_HISTORY_URL }

  async load(): Promise<void> {
    try {
      const res = await this.fetchFn(this.url, { cache: 'no-store' })
      const body = await res.json().catch(() => null)
      if (res.status === 402) { this.set({ phase: 'locked' }); return }
      const parsed = res.ok ? parseRevenueTable(body) : null
      if (!parsed) {
        const server = isObj(body) && typeof body.error === 'string' ? body.error : null
        this.set({ phase: 'error', error: server ?? ERROR_TEXT[res.status] ?? `Не удалось загрузить выручку (${res.status})` })
        return
      }
      this.set({ phase: 'ready', ...parsed, error: null, field: null })
    } catch {
      this.set({ phase: 'error', error: ERROR_TEXT[0] })
    }
  }

  setValue(period: string, text: string): void {
    if (this.snap.rows.some((r) => r.period === period && isLocked(r))) return
    this.set({
      rows: this.snap.rows.map((r) => (r.period === period ? { ...r, text } : r)),
      message: null,
      ...(this.snap.field === period ? { error: null, field: null } : {}),
    })
  }

  async save(): Promise<boolean> {
    if (this.snap.saving) return false
    const { months, invalid } = changedMonths(this.snap.rows)
    if (invalid) {
      this.set({ error: 'Выручка за месяц — число в тенге больше нуля (если выручки не было, оставьте месяц пустым)', field: invalid, message: null })
      return false
    }
    if (!months.length) { this.set({ message: 'Изменений нет', error: null, field: null }); return false }
    this.set({ saving: true, error: null, field: null, message: null })
    try {
      const res = await this.fetchFn(this.url, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ months }),
      })
      const body = await res.json().catch(() => null)
      const parsed = res.ok ? parseRevenueTable(body) : null
      if (!parsed) {
        const b = isObj(body) ? body : {}
        const field = typeof b.field === 'string' ? /months\[(\d+)\]/.exec(b.field) : null
        this.set({
          saving: false,
          error: typeof b.error === 'string' && b.error.trim() ? b.error : ERROR_TEXT[res.status] ?? `Не удалось сохранить (${res.status})`,
          field: field ? months[Number(field[1])]?.period ?? null : null,
        })
        return false
      }
      this.set({ saving: false, phase: 'ready', ...parsed, message: `Сохранено. ${runText(parsed)}` })
      this.opts.onSaved?.()
      return true
    } catch {
      this.set({ saving: false, error: ERROR_TEXT[0] })
      return false
    }
  }
}
