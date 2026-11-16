'use client'

/**
 * components/point-b/StaffPointBView.tsx — «Что видит клиент» in the staff tabs (GIGA User 360 → «Точка Б», the
 * expert portal) — R3 (M3): ONE calculation. The staff route returns the client's own page state (loadPointBState:
 * the model and the APPROVED plan version only), drawn with the client's own components, so the staff never look at a
 * different number than the client (the old V2 view is not used here any more). Actions of the client (invites, «Внести
 * выручку», tabs) are inert here: the overview is drawn in preview mode.
 */
import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { ActionPlanBoard } from '@/components/action-plan/ActionPlanBoard'
import PlanStatusBanner from './PlanStatusBanner'
import { PointBStateController } from './pointBStateController'
import { OverviewView, SectionError, SectionSkeleton } from './tabs/OverviewTab'
import { ScenariosReady } from './tabs/ScenariosTab'

export default function StaffPointBView({ url, reloadKey = 0, actionPlanUserId }: { url: string; reloadKey?: number; actionPlanUserId?: string }) {
  const ctl = useMemo(() => new PointBStateController((input, init) => fetch(input, init), { url }), [url])
  useEffect(() => { void ctl.load() }, [ctl, reloadKey])
  const snap = useSyncExternalStore(ctl.subscribe, ctl.getSnapshot, ctl.getSnapshot)

  if (snap.phase === 'loading') return <SectionSkeleton label="Загружаем расчёт клиента" />
  if (!snap.result) return <SectionError message={snap.error ?? 'Нет данных расчёта'} onRetry={() => void ctl.load()} />
  const plan = snap.plan
  return (
    <section aria-label="Что видит клиент" className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-200">Что видит клиент</h3>
        <p className="text-xs text-slate-500">Тот же расчёт, что на странице клиента: автоматический расчёт модели и только одобренная версия плана.</p>
      </div>
      <PlanStatusBanner
        status={plan.status}
        version={plan.version !== null ? { number: plan.version, approvedAt: plan.approvedAt, expertNotes: null, authorName: plan.authorName } : null}
        prep={plan.prep}
      />
      <OverviewView result={snap.result} plan={plan} finmodel={snap.finmodel ?? null} nextStep={snap.nextStep ?? null} preview />
      {plan.scenarios.length > 0 && <ScenariosReady plan={plan} target={snap.result.gap.targetAnnual} />}
      {/* The client's action plan (the tasks of the approved plan among them) — it was a part of the old V2 view. */}
      {actionPlanUserId && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-200">План действий клиента</h3>
          <ActionPlanBoard userId={actionPlanUserId} />
        </div>
      )}
    </section>
  )
}
