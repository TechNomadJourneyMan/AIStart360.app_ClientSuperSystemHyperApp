/**
 * components/point-b/pointBStateController.ts — loads GET /api/v1/point-b/state for the
 * «Обзор» and «Сценарии» tabs (plan Phase 2 Task 8). Free of React and of the DOM so it can
 * be tested with a fetch double (same approach as planController.ts).
 *
 * Failure is local to the two tabs: «Подробности» (the legacy view) has its own loader and
 * keeps working. A 402 (the tariff gate) locks the page, like in the legacy loader.
 */
import type { ModelResult } from '@/lib/point-b/model/types'
import type { InviteView } from '@/lib/point-b/invites/types'
import { isUpgradeRequired } from './pointBAccess'
import { parseRecsFromBody, type PointBNextStep, type PointBRecsState } from './recsModel'
import { parsePlanFactFromBody, type PlanFactState } from './planFactModel'
import { parseStrategyFromBody, type PointBStrategyState } from './strategyModel'
import { EMPTY_PLAN_STATE, parsePointBState, type PointBFinmodelStatus, type PointBPlanState } from './overviewModel'

export type StatePhase = 'loading' | 'ready' | 'error' | 'locked'

export interface PointBStateSnapshot {
  phase: StatePhase
  /** Text of the failure, shown in the tab. */
  error: string | null
  result: ModelResult | null
  plan: PointBPlanState
  /** Completeness of the finmodel (never the values); null = the server did not say. */
  finmodel?: PointBFinmodelStatus | null
  /** `plan.strategy` of the APPROVED version with live progress; null = none (or the server did not say). */
  strategy?: PointBStrategyState | null
  /** Verified (and previously verified, now stale) recommendations + the count of the pending ones — never their texts. */
  recommendations?: PointBRecsState | null
  /** Active invite cards (at most 3). */
  invites?: InviteView[]
  /** «Следующий шаг» of the overview; null = nothing to show. */
  nextStep?: PointBNextStep | null
  /** Plan-fact of the APPROVED plan (Ф6b): checkpoints, goal progress, the «Факт за месяц» form, versions; null = none. */
  planFact?: PlanFactState | null
}

export const INITIAL_STATE_SNAPSHOT: PointBStateSnapshot = { phase: 'loading', error: null, result: null, plan: EMPTY_PLAN_STATE }

const ERROR_TEXT: Record<number, string> = {
  0: 'Нет связи с сервером. Проверьте соединение и повторите.',
  401: 'Сессия закончилась — войдите заново',
  403: 'Нет доступа к этому разделу',
}

export class PointBStateController {
  private snap: PointBStateSnapshot = INITIAL_STATE_SNAPSHOT
  private listeners = new Set<() => void>()
  private seq = 0

  constructor(private readonly fetchFn: typeof fetch) {}

  subscribe = (l: () => void): (() => void) => { this.listeners.add(l); return () => { this.listeners.delete(l) } }
  getSnapshot = (): PointBStateSnapshot => this.snap

  private set(patch: Partial<PointBStateSnapshot>): void {
    this.snap = { ...this.snap, ...patch }
    this.listeners.forEach((l) => l())
  }

  async load(): Promise<void> {
    const my = ++this.seq
    // A reload keeps what is on the screen; only the first load shows the skeleton.
    if (!this.snap.result) this.set({ phase: 'loading', error: null })
    try {
      const res = await this.fetchFn('/api/v1/point-b/state', { cache: 'no-store' })
      const body = (await res.json().catch(() => null)) as { error?: unknown } | null
      if (my !== this.seq) return
      if (isUpgradeRequired(res.status, body)) {
        this.set({ phase: 'locked', error: null, result: null, plan: EMPTY_PLAN_STATE, finmodel: null, strategy: null, recommendations: null, invites: [], nextStep: null, planFact: null })
        return
      }
      const parsed = res.ok ? parsePointBState(body) : null
      if (!parsed) {
        const server = typeof body?.error === 'string' && body.error.trim() ? body.error : null
        this.set({
          phase: 'error',
          error: server ?? ERROR_TEXT[res.status] ?? (res.ok ? 'Не удалось прочитать расчёт' : `Не удалось загрузить расчёт (${res.status})`),
        })
        return
      }
      this.set({
        phase: 'ready', error: null, result: parsed.result, plan: parsed.plan, finmodel: parsed.finmodel, strategy: parseStrategyFromBody(body),
        ...parseRecsFromBody(body),
        planFact: parsePlanFactFromBody(body) ?? null,
      })
    } catch {
      if (my !== this.seq) return
      this.set({ phase: 'error', error: ERROR_TEXT[0] })
    }
  }
}
