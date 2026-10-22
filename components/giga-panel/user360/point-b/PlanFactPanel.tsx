'use client'

/**
 * components/giga-panel/user360/point-b/PlanFactPanel.tsx — «План-факт и пересчёт» of a client for the expert / admin
 * (plan Ф6b, spec §14, §15.4): the button «Пересчитать» (staff only — the server checks it; the client has no button),
 * its result and time, the latest runs, then the plan-fact as the client sees it (verdict, goal progress, months) with
 * the «Факт за месяц» form filled by the expert, and every version of the plan with the full comparison.
 * Used in User 360 → «Точка Б» (GIGA URLs) and in the expert portal (expert URLs). Behaviour lives in
 * planFactPanelController.ts; this file only draws it.
 */
import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { RefreshCw } from 'lucide-react'
import { PlanFactView } from '@/components/point-b/tabs/PlanFactTab'
import { Badge, Button, EmptyState, ErrorState, Panel, Skeleton } from '../../kit'
import {
  PlanFactPanelController, expertPlanFactUrls, gigaPlanFactUrls, runLine, type PlanFactPanelSnapshot, type PlanFactUrls,
} from './planFactPanelController'

const TITLE = 'План-факт и пересчёт'

const timeOf = (iso: string | null): string | null => {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isNaN(t) ? null : new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

export function PlanFactPanelView({ snap, factUrl, onRecompute, onRetry, onSaved }: {
  snap: PlanFactPanelSnapshot
  factUrl: string
  onRecompute?: () => void
  onRetry?: () => void
  onSaved?: () => void
}) {
  const running = snap.recompute.phase === 'running'
  const at = timeOf(snap.recompute.at)
  const actions = (
    <Button variant="primary" size="sm" icon={<RefreshCw size={13} />} onClick={onRecompute} loading={running} disabled={running || snap.phase === 'loading'}>
      {running ? 'Пересчитываем…' : 'Пересчитать'}
    </Button>
  )
  return (
    <Panel
      title={TITLE}
      description="Прогноз и сверка «план — факт» по одобренной версии. Пересчёт идёт по расписанию два раза в неделю; кнопка — не чаще раза в 10 минут. План сам не меняется: при отставании создаётся черновик пересмотра для вас."
      actions={actions}
    >
      <div className="space-y-4">
        {snap.recompute.message && (
          <p role="status" className={snap.recompute.phase === 'error' ? 'text-xs text-red-300' : 'text-xs text-emerald-300'}>
            {snap.recompute.phase === 'done' && at ? `Пересчитано в ${at}: ` : ''}{snap.recompute.message}
          </p>
        )}
        {snap.runs.length > 0 && (
          <div className="text-[11px] text-slate-500">
            <span className="text-slate-400">Последние пересчёты: </span>
            {snap.runs.slice(0, 3).map((r) => runLine(r)).join('; ')}
          </div>
        )}
        {snap.phase === 'loading' && <Skeleton className="h-40 w-full" />}
        {snap.phase === 'error' && <ErrorState error={{ message: snap.error ?? 'Не удалось загрузить план-факт' }} onRetry={onRetry} />}
        {snap.phase === 'ready' && !snap.published && (
          <EmptyState title="Одобренного плана нет" text="План-факт и пересчёт работают для одобренной версии плана. Версии ниже — в работе." />
        )}
        {snap.phase === 'ready' && snap.planFact && (
          <>
            {snap.planFact.reconciliation.period && (
              <Badge tone={snap.planFact.reconciliation.done ? 'green' : 'amber'}>
                {snap.planFact.reconciliation.done ? 'Сверка за прошлый месяц внесена' : 'Сверки за прошлый месяц нет'}
              </Badge>
            )}
            <PlanFactView state={snap.planFact} audience="staff" factUrl={factUrl} onSaved={onSaved} />
          </>
        )}
      </div>
    </Panel>
  )
}

export function PlanFactPanel({ userId, portal = 'giga' }: { userId: string; portal?: 'giga' | 'expert' }) {
  const urls: PlanFactUrls = useMemo(() => (portal === 'expert' ? expertPlanFactUrls(userId) : gigaPlanFactUrls(userId)), [userId, portal])
  const ctl = useMemo(() => new PlanFactPanelController((input, init) => fetch(input, init), urls), [urls])
  useEffect(() => { void ctl.load() }, [ctl])
  const snap = useSyncExternalStore(ctl.subscribe, ctl.getSnapshot, ctl.getSnapshot)
  return (
    <PlanFactPanelView
      snap={snap}
      factUrl={urls.facts}
      onRecompute={() => void ctl.recompute()}
      onRetry={() => void ctl.load()}
      onSaved={() => void ctl.load()}
    />
  )
}
