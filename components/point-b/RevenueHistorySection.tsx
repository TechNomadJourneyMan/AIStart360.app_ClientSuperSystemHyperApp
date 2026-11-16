'use client'

/**
 * components/point-b/RevenueHistorySection.tsx — «Выручка по месяцам» on the «Финмодель» tab (R3, M2): the revenue of
 * the last 24 finished months, typed before the plan is approved. 12 months in a row give the overview its forecast
 * «при текущем ходе» and a verdict. Behaviour: revenueHistoryController.ts. Project tokens only.
 */
import { useEffect, useId, useMemo, useRef, useSyncExternalStore } from 'react'
import { BTN_GHOST, BTN_PRIMARY, CARD, CHIP, Icon } from '@/components/point-a-v4/ui'
import { cn } from '@/lib/utils'
import { RevenueHistoryController, SOURCE_LABEL, isLocked, runText, type RevenueHistorySnapshot } from './revenueHistoryController'

const INPUT =
  'w-full rounded-xl border border-white/[0.1] bg-white/[0.04] px-3 py-2 pr-8 text-base sm:text-sm text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-60'

export function RevenueHistoryView({ snap, onValue, onSave, onRetry }: {
  snap: RevenueHistorySnapshot
  onValue: (period: string, text: string) => void
  onSave: () => void
  onRetry: () => void
}) {
  const uid = useId()
  if (snap.phase === 'locked') return null
  return (
    <section aria-labelledby={`${uid}-title`} className={CARD}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id={`${uid}-title`} className="font-headline text-lg font-bold text-on-surface">Выручка по месяцам</h2>
          <p className="mt-0.5 text-sm text-on-surface-variant">
            Выручка за каждый из последних месяцев, в тенге. По 12 месяцам подряд «Обзор» покажет, куда придёт бизнес при текущем ходе и успеваете ли вы к цели.
          </p>
        </div>
        {snap.phase === 'ready' && (
          <span className={cn(CHIP, snap.needed === 0 && !snap.stale ? 'bg-primary/[0.12] text-primary' : 'bg-white/[0.06] text-on-surface-variant')}>
            <Icon name="calendar_month" className="text-[14px]" />
            {snap.run} из {snap.minMonths}
          </span>
        )}
      </div>

      {snap.phase === 'loading' && <div className="mt-3 h-40 animate-pulse rounded-xl bg-white/[0.04]" aria-busy="true" aria-label="Загружаем выручку по месяцам" />}

      {snap.phase === 'error' && snap.rows.length === 0 && (
        <div role="alert" className="mt-3 rounded-xl border border-error/30 bg-error/[0.06] p-3 text-sm text-on-surface">
          {snap.error}
          <div><button type="button" onClick={onRetry} className={cn(BTN_GHOST, 'mt-2')}>Повторить</button></div>
        </div>
      )}

      {snap.rows.length > 0 && (
        <form
          className="mt-3 space-y-3"
          onSubmit={(e) => { e.preventDefault(); onSave() }}
          noValidate
        >
          <p className="text-xs text-on-surface-variant">{runText(snap)}</p>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3" aria-label="Месяцы">
            {[...snap.rows].reverse().map((r) => {
              const id = `${uid}-${r.period}`
              const invalid = snap.field === r.period
              return (
                <li key={r.period}>
                  <label htmlFor={id} className="mb-1 flex items-center justify-between gap-2 text-xs font-medium text-on-surface-variant">
                    <span>{r.label}</span>
                    {r.source && <span className="text-[11px] font-normal text-on-surface-variant/80">{SOURCE_LABEL[r.source]}</span>}
                  </label>
                  <div className="relative">
                    <input
                      id={id}
                      inputMode="decimal"
                      autoComplete="off"
                      value={r.text}
                      onChange={(e) => onValue(r.period, e.target.value)}
                      disabled={snap.saving || isLocked(r)}
                      readOnly={isLocked(r)}
                      placeholder="—"
                      aria-invalid={invalid || undefined}
                      aria-describedby={invalid ? `${uid}-err` : undefined}
                      className={cn(INPUT, invalid && 'border-error/60')}
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-on-surface-variant">₸</span>
                  </div>
                </li>
              )
            })}
          </ul>
          <div aria-live="polite" className="space-y-1">
            {snap.error && <p id={`${uid}-err`} role="alert" className="text-xs text-error">{snap.error}</p>}
            {snap.message && <p className="text-xs text-primary">{snap.message}</p>}
          </div>
          <button type="submit" disabled={snap.saving} className={BTN_PRIMARY}>
            {snap.saving ? 'Сохраняем…' : 'Сохранить выручку'}
          </button>
        </form>
      )}
    </section>
  )
}

export default function RevenueHistorySection({ onSaved }: { onSaved?: () => void }) {
  const saved = useRef(onSaved)
  saved.current = onSaved
  const ctl = useMemo(() => new RevenueHistoryController((input, init) => fetch(input, init), { onSaved: () => saved.current?.() }), [])
  useEffect(() => { void ctl.load() }, [ctl])
  const snap = useSyncExternalStore(ctl.subscribe, ctl.getSnapshot, ctl.getSnapshot)
  return <RevenueHistoryView snap={snap} onValue={(p, t) => ctl.setValue(p, t)} onSave={() => void ctl.save()} onRetry={() => void ctl.load()} />
}
