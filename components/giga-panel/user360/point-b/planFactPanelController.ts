/**
 * components/giga-panel/user360/point-b/planFactPanelController.ts — the brain of the staff «План-факт и пересчёт» panel
 * (User 360 → «Точка Б» and the expert portal; plan Ф6b, spec §14, §15.4), free of React and of the DOM so it can be
 * tested with a fetch double (same approach as scenariosController.ts).
 *
 * Contract (two sets of URLs, the same answers):
 *   GIGA     GET/PUT /api/giga-admin/users/:id/point-b/plan-fact · POST /api/giga-admin/users/:id/point-b/recompute
 *   expert   GET/PUT/POST /api/expert/clients/:id/point-b/plan-fact (POST { action: 'recompute' })
 *   GET  → { ok, data: { published, planFact: PlanFactState | null, runs: Array<{ kind, status, startedAt, finishedAt }> } }
 *   POST → { ok, data: { status: 'done' | 'unchanged' | 'no_plan' | 'failed', computedAt?, period?, overall?, reason?, draft?, error? } }
 *          429 { retryAt } — at most once in 10 minutes per company
 * The button shows «Пересчитываем…» while the request runs and then the time of the result; after a recompute the
 * plan-fact is read again.
 */
import { fmtLongDate } from '@/components/point-b/overviewModel'
import { parsePlanFact, PF_VERDICT_VIEW } from '@/components/point-b/planFactModel'
import { periodLabel } from '@/lib/point-b/planfact/kpis'
import type { PlanFactState, PlanFactVerdict } from '@/lib/point-b/planfact/types'

export interface PlanFactUrls { view: string; facts: string; recompute: string; recomputeBody: Record<string, unknown> | null }

export const gigaPlanFactUrls = (userId: string): PlanFactUrls => ({
  view: `/api/giga-admin/users/${userId}/point-b/plan-fact`,
  facts: `/api/giga-admin/users/${userId}/point-b/plan-fact`,
  recompute: `/api/giga-admin/users/${userId}/point-b/recompute`,
  recomputeBody: null,
})

export const expertPlanFactUrls = (clientId: string): PlanFactUrls => ({
  view: `/api/expert/clients/${clientId}/point-b/plan-fact`,
  facts: `/api/expert/clients/${clientId}/point-b/plan-fact`,
  recompute: `/api/expert/clients/${clientId}/point-b/plan-fact`,
  recomputeBody: { action: 'recompute' },
})

export interface StaffRunView { kind: string; status: string; startedAt: string; finishedAt: string | null }

export interface PlanFactPanelSnapshot {
  phase: 'loading' | 'ready' | 'error'
  error: string | null
  published: boolean
  planFact: PlanFactState | null
  runs: StaffRunView[]
  recompute: { phase: 'idle' | 'running' | 'done' | 'error'; message: string | null; at: string | null }
}

export const INITIAL_PANEL: PlanFactPanelSnapshot = {
  phase: 'loading', error: null, published: false, planFact: null, runs: [], recompute: { phase: 'idle', message: null, at: null },
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)

const timeOf = (iso: string | null): string | null => {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isNaN(t) ? null : new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

/** The words for the outcome of a recompute. */
export function recomputeMessage(data: unknown): string {
  if (!isObj(data)) return 'Пересчёт выполнен'
  const status = str(data.status)
  if (status === 'no_plan') return 'У клиента нет одобренного плана — пересчитывать нечего'
  if (status === 'failed') return data.error === 'not_ready' ? 'План-факт ещё не включён на сервере' : 'Пересчёт не удался — попробуйте позже'
  if (status === 'unchanged') return 'Данные не изменились — расчёт актуален'
  const overall = str(data.overall) as PlanFactVerdict | null
  const period = str(data.period)
  const parts = [overall && PF_VERDICT_VIEW[overall] ? `${PF_VERDICT_VIEW[overall].label}${period ? ` за ${periodLabel(period)}` : ''}` : 'Пересчитано']
  const draft = isObj(data.draft) ? data.draft : null
  if (draft?.created === true) parts.push(`создан черновик пересмотра (версия ${draft.version ?? '—'}) — проверьте и отправьте на одобрение`)
  else if (overall === 'behind' && draft) parts.push('отклонение учтите в открытой версии плана')
  return parts.join('; ')
}

export const RUN_KIND_LABEL: Record<string, string> = { scheduled: 'по расписанию', manual: 'по кнопке' }
export const RUN_STATUS_LABEL: Record<string, string> = { running: 'идёт', done: 'готово', failed: 'с ошибкой' }

export function runLine(r: StaffRunView): string {
  return `${fmtLongDate(r.startedAt) ?? r.startedAt} ${timeOf(r.startedAt) ?? ''} · ${RUN_KIND_LABEL[r.kind] ?? r.kind} · ${RUN_STATUS_LABEL[r.status] ?? r.status}`.replace(/\s+·/g, ' ·')
}

export class PlanFactPanelController {
  private snap: PlanFactPanelSnapshot = INITIAL_PANEL
  private listeners = new Set<() => void>()
  private seq = 0

  constructor(private readonly fetchFn: typeof fetch, readonly urls: PlanFactUrls, private readonly now: () => Date = () => new Date()) {}

  subscribe = (l: () => void): (() => void) => { this.listeners.add(l); return () => { this.listeners.delete(l) } }
  getSnapshot = (): PlanFactPanelSnapshot => this.snap

  private set(patch: Partial<PlanFactPanelSnapshot>): void {
    this.snap = { ...this.snap, ...patch }
    this.listeners.forEach((l) => l())
  }

  async load(): Promise<void> {
    const my = ++this.seq
    if (!this.snap.planFact) this.set({ phase: 'loading', error: null })
    try {
      const res = await this.fetchFn(this.urls.view, { cache: 'no-store' })
      const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: unknown; data?: unknown } | null
      if (my !== this.seq) return
      if (!res.ok || !body?.ok || !isObj(body.data)) {
        this.set({ phase: 'error', error: str(body?.error) ?? `Не удалось загрузить план-факт (${res.status})` })
        return
      }
      const d = body.data
      const runs = (Array.isArray(d.runs) ? d.runs : []).filter(isObj).flatMap((r) => (str(r.startedAt) ? [{
        kind: str(r.kind) ?? '', status: str(r.status) ?? '', startedAt: r.startedAt as string, finishedAt: str(r.finishedAt),
      }] : []))
      this.set({ phase: 'ready', error: null, published: d.published === true, planFact: parsePlanFact(d.planFact), runs })
    } catch {
      if (my !== this.seq) return
      this.set({ phase: 'error', error: 'Нет связи с сервером' })
    }
  }

  async recompute(): Promise<void> {
    if (this.snap.recompute.phase === 'running') return
    this.set({ recompute: { phase: 'running', message: null, at: null } })
    try {
      const res = await this.fetchFn(this.urls.recompute, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: this.urls.recomputeBody ? JSON.stringify(this.urls.recomputeBody) : undefined,
      })
      const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: unknown; retryAt?: unknown; data?: unknown } | null
      if (res.status === 429) {
        const at = timeOf(str(body?.retryAt))
        this.set({ recompute: { phase: 'error', message: `Пересчёт уже запускали недавно${at ? ` — следующий после ${at}` : ' — попробуйте через несколько минут'}`, at: null } })
        return
      }
      if (!res.ok || !body?.ok) {
        this.set({ recompute: { phase: 'error', message: str(body?.error) ?? `Пересчёт не удался (${res.status})`, at: null } })
        return
      }
      const data = isObj(body.data) ? body.data : {}
      const at = str(data.computedAt) ?? this.now().toISOString()
      this.set({ recompute: { phase: 'done', message: recomputeMessage(data), at } })
      await this.load()
    } catch {
      this.set({ recompute: { phase: 'error', message: 'Нет связи с сервером', at: null } })
    }
  }

  /** «Пересчитано в 14:05» for the button area. */
  resultTime(): string | null {
    return timeOf(this.snap.recompute.at)
  }
}

// ── The reconciliation list of the queue page ───────────────────────────

export interface ReconciliationRow { userId: string; clientName: string; company: string | null; done: boolean; enteredRole: string | null; updatedAt: string | null }

/** GET /api/giga-admin/point-b/reconciliation → { ok, data: { period, items } }; tolerant, null on a broken answer. */
export function parseReconciliation(body: unknown): { period: string; rows: ReconciliationRow[] } | null {
  if (!isObj(body) || body.ok === false || !isObj(body.data)) return null
  const items = Array.isArray(body.data.items) ? body.data.items : []
  return {
    period: str(body.data.period) ?? '',
    rows: items.filter(isObj).flatMap((r) => (str(r.userId) ? [{
      userId: r.userId as string,
      clientName: str(r.clientName) ?? 'Без имени',
      company: str(r.companyName),
      done: r.done === true,
      enteredRole: str(r.enteredRole),
      updatedAt: str(r.updatedAt),
    }] : [])),
  }
}

export const ENTERED_BY_LABEL: Record<string, string> = { owner: 'клиент', expert: 'эксперт' }
