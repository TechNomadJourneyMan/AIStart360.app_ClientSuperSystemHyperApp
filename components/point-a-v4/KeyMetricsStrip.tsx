'use client'

/**
 * «Главные метрики» — the top strip of Point A: real values of the metrics
 * the owner cares about most (default set until chosen), with period, source,
 * dynamics and progress to a goal on that metric. «Настроить» picks up to 8
 * from the catalog; saved per company (pa_company_config.client_view.keyMetrics).
 */
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import type { PointAPageState } from '@/hooks/usePointAState'
import { useKeyMetrics } from '@/hooks/usePointAState'
import type { MetricView } from '@/lib/point-a/v4/metric-views'
import { BTN_GHOST, BTN_PRIMARY, CARD, Icon, SectionTitle, fmtValue } from './ui'
import { MiniSpark, TrendChip, metricValue } from './MetricParts'
import { cn } from '@/lib/utils'
import { BodyPortal } from '@/components/ui/body-portal'

const MAX = 8

export function KeyMetricTile({ m, goal }: { m: MetricView; goal?: PointAPageState['goals'][number] }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 min-w-0" title={m.what ?? undefined}>
      <p className="truncate text-[11px] text-on-surface-variant">{m.label}</p>
      <p className={cn('mt-1 font-mono text-lg font-bold leading-tight', m.value === null ? 'text-on-surface-variant' : 'text-on-surface')}>{metricValue(m)}</p>
      <p className="truncate text-[10px] text-on-surface-variant">
        {m.value !== null ? [m.period, m.source].filter(Boolean).join(' · ') : 'нет данных'}
      </p>
      <div className="mt-1.5 flex items-center justify-between gap-1">
        <TrendChip m={m} />
        <MiniSpark values={m.history} />
      </div>
      {goal && goal.evaluation.progress !== null && (
        <div className="mt-2" title={goal.evaluation.realismText}>
          <div className="flex justify-between text-[10px] font-mono text-on-surface-variant">
            <span>цель {fmtValue(goal.goal.targetValue, goal.goal.unit)}</span><span>{Math.round(goal.evaluation.progress)}%</span>
          </div>
          <div className="mt-0.5 h-1 rounded-full bg-white/[0.06]"><div className="h-full rounded-full bg-primary" style={{ width: `${goal.evaluation.progress}%` }} /></div>
        </div>
      )}
    </div>
  )
}

function Picker({ state, onClose, readonly }: { state: PointAPageState; onClose: () => void; readonly?: boolean }) {
  const save = useKeyMetrics()
  const [ids, setIds] = useState<string[]>(state.keyMetrics.map((m) => m.id))
  const [q, setQ] = useState('')
  const byId = useMemo(() => new Map(state.metricCatalog.map((c) => [c.id, c])), [state.metricCatalog])
  const found = useMemo(() => {
    const s = q.trim().toLowerCase()
    return state.metricCatalog.filter((c) => !ids.includes(c.id) && (!s || c.label.toLowerCase().includes(s) || c.group.toLowerCase().includes(s))).slice(0, 40)
  }, [q, ids, state.metricCatalog])
  const move = (i: number, d: -1 | 1) => setIds((list) => {
    const next = list.slice()
    const j = i + d
    if (j < 0 || j >= next.length) return list
    ;[next[i], next[j]] = [next[j], next[i]]
    return next
  })
  const submit = async () => {
    if (readonly) return onClose()
    try {
      await save.mutateAsync(ids)
      toast.success('Главные метрики сохранены')
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось сохранить')
    }
  }
  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div role="dialog" aria-modal="true" aria-label="Главные метрики" onClick={(e) => e.stopPropagation()}
        className="relative z-10 w-full sm:max-w-xl max-h-[90vh] overflow-y-auto bg-surface-container-low rounded-t-2xl sm:rounded-2xl border border-white/[0.08] p-5">
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-headline text-base font-bold text-on-surface">Главные метрики</h3>
          <button type="button" onClick={onClose} aria-label="Закрыть" className="h-8 w-8 rounded-lg text-on-surface-variant hover:bg-white/[0.06]"><Icon name="close" className="text-xl" /></button>
        </div>
        <p className="text-xs text-on-surface-variant mb-3">До {MAX} показателей в верхнем блоке Точки А. На баллы это не влияет.</p>
        <ol className="space-y-1.5 mb-4">
          {ids.map((id, i) => (
            <li key={id} className="flex items-center gap-2 rounded-xl border border-white/[0.06] px-3 py-2">
              <span className="flex-1 min-w-0 truncate text-sm text-on-surface">{byId.get(id)?.label ?? id}</span>
              <button type="button" className="h-8 w-8 rounded-lg text-on-surface-variant hover:bg-white/[0.06] disabled:opacity-30" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Выше"><Icon name="arrow_upward" className="text-[16px]" /></button>
              <button type="button" className="h-8 w-8 rounded-lg text-on-surface-variant hover:bg-white/[0.06] disabled:opacity-30" onClick={() => move(i, 1)} disabled={i === ids.length - 1} aria-label="Ниже"><Icon name="arrow_downward" className="text-[16px]" /></button>
              <button type="button" className="h-8 w-8 rounded-lg text-on-surface-variant hover:bg-white/[0.06]" onClick={() => setIds((l) => l.filter((x) => x !== id))} aria-label={`Убрать «${byId.get(id)?.label ?? id}»`}><Icon name="close" className="text-[16px]" /></button>
            </li>
          ))}
        </ol>
        {ids.length < MAX && (
          <>
            <label className="block mb-2">
              <span className="sr-only">Найти метрику</span>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск: выручка, NPS…"
                className="w-full rounded-xl border border-white/10 bg-surface-container px-3 py-2 text-base sm:text-sm text-on-surface focus:outline-none focus:border-primary/50" />
            </label>
            <ul className="max-h-56 overflow-y-auto space-y-1 mb-4">
              {found.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => setIds((l) => (l.length < MAX ? [...l, c.id] : l))}
                    className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-white/[0.04]">
                    <span className="text-on-surface">{c.label}</span><span className="text-[10px] font-mono text-on-surface-variant">{c.group}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className={BTN_GHOST} onClick={onClose}>Отмена</button>
          <button type="button" className={BTN_PRIMARY} onClick={() => void submit()} disabled={save.isPending || ids.length === 0}>Сохранить</button>
        </div>
      </div>
    </div>
  )
}

export function KeyMetricsStrip({ state, readonly }: { state: PointAPageState; readonly?: boolean }) {
  const [edit, setEdit] = useState(false)
  if (!state.keyMetrics.length && !state.canManage) return null
  const goalOf = (id: string) => state.goals.find((g) => g.goal.metricId === id)
  return (
    <section className={CARD} aria-labelledby="pa-key">
      <SectionTitle icon="monitoring" aside={state.canManage ? (
        <button type="button" className={cn(BTN_GHOST, 'py-1 min-h-[30px]')} onClick={() => setEdit(true)}><Icon name="tune" className="text-[16px]" />Настроить</button>
      ) : undefined}>
        <span id="pa-key">Главные метрики</span>
      </SectionTitle>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {state.keyMetrics.map((m) => <KeyMetricTile key={m.id} m={m} goal={goalOf(m.id)} />)}
      </div>
      {!state.keyMetricsCustom && state.canManage && (
        <p className="mt-2 text-[11px] text-on-surface-variant">Это набор по умолчанию — выберите показатели, за которыми следите сами.</p>
      )}
      {edit && <BodyPortal><Picker state={state} onClose={() => setEdit(false)} readonly={readonly} /></BodyPortal>}
    </section>
  )
}
