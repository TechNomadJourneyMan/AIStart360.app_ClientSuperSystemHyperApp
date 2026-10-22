'use client'

/**
 * components/point-b/MonthlyFactForm.tsx — «Факт за месяц» of the monthly reconciliation (plan Ф6b, spec §13): only the key
 * KPIs of the approved plan; the values are saved as facts with the source «ежемесячная сверка» and the plan-fact of
 * the month is recalculated. Used by the client tab and by the staff panels (their own URL). `preview` keeps a save in
 * memory (the dev preview page). Project tokens only — the PO will replace the design.
 */
import { useMemo, useSyncExternalStore } from 'react'
import { BTN_PRIMARY, CARD, CARD_TITLE, Icon } from '@/components/point-a-v4/ui'
import { periodLabel } from '@/lib/point-b/planfact/kpis'
import type { KpiValues, PlanKpi } from '@/lib/point-b/planfact/types'
import { cn } from '@/lib/utils'
import { CLIENT_FACTS_URL, MonthlyFactController, NOTE_MAX, type FactFormSnapshot } from './monthlyFactController'
import { factFields } from './planFactModel'

const IN_MEMORY: typeof fetch = async (_input, init) => {
  const body = JSON.parse(String(init?.body ?? '{}')) as { period?: string }
  return new Response(JSON.stringify({ ok: true, data: { period: body.period, saved: [], cleared: [], checkpoint: { status: 'done', overall: 'on_track' } } }), { status: 200 })
}

export interface MonthlyFactFormViewProps {
  snap: FactFormSnapshot
  kpis: PlanKpi[]
  /** Who fills it: the owner sees «вы», the staff see «клиент». */
  audience: 'client' | 'staff'
  done: boolean
  onValue?: (kpi: PlanKpi, raw: string) => void
  onNote?: (note: string) => void
  onSubmit?: () => void
}

export function MonthlyFactFormView({ snap, kpis, audience, done, onValue, onNote, onSubmit }: MonthlyFactFormViewProps) {
  const fields = factFields(kpis, {})
  const month = periodLabel(snap.period)
  const saving = snap.phase === 'saving'
  return (
    <section aria-labelledby="pb-fact-form" className={CARD}>
      <form
        noValidate
        onSubmit={(e) => { e.preventDefault(); onSubmit?.() }}
        className="space-y-4"
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 id="pb-fact-form" className="font-headline text-lg font-bold text-on-surface">Факт за месяц · {month}</h2>
            <p className="mt-1 text-sm text-on-surface-variant">
              {audience === 'client'
                ? 'Внесите ключевые показатели плана за прошедший месяц — мы сравним их с планом и покажем, на курсе ли вы.'
                : 'Ключевые показатели плана клиента за месяц. Сохраняются как факт с источником «ежемесячная сверка».'}
            </p>
          </div>
          {done && (
            <span className="inline-flex items-center gap-1 rounded-lg bg-primary/10 px-2 py-1 text-xs text-primary">
              <Icon name="task_alt" className="text-sm" />
              Сверка за месяц внесена
            </span>
          )}
        </div>

        {fields.length === 0 ? (
          <p className="text-sm text-on-surface-variant">В одобренном плане нет показателей, которые сверяются по месяцам.</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {fields.map((f) => {
              const id = `pb-fact-${f.kpi}`
              const err = snap.field === f.kpi ? snap.error : null
              return (
                <div key={f.kpi} className="min-w-0">
                  <label htmlFor={id} className={CARD_TITLE}>{f.label}</label>
                  <div className="mt-1 flex items-center gap-2">
                    <input
                      id={id}
                      name={f.kpi}
                      inputMode={f.inputMode}
                      autoComplete="off"
                      value={snap.values[f.kpi] ?? ''}
                      onChange={(e) => onValue?.(f.kpi, e.target.value)}
                      aria-invalid={err ? true : undefined}
                      aria-describedby={`${id}-hint${err ? ` ${id}-err` : ''}`}
                      disabled={saving}
                      className={cn(
                        'w-full min-w-0 rounded-xl border bg-white/[0.03] px-3 py-2 text-base text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                        err ? 'border-error/60' : 'border-white/[0.1]',
                      )}
                    />
                    <span className="shrink-0 text-sm text-on-surface-variant">{f.suffix}</span>
                  </div>
                  <p id={`${id}-hint`} className="mt-0.5 text-xs text-on-surface-variant">{f.hint}</p>
                  {err && <p id={`${id}-err`} role="alert" className="mt-0.5 text-xs text-error">{err}</p>}
                </div>
              )
            })}
          </div>
        )}

        <div className="min-w-0">
          <label htmlFor="pb-fact-note" className={CARD_TITLE}>Комментарий (необязательно)</label>
          <textarea
            id="pb-fact-note"
            rows={2}
            maxLength={NOTE_MAX}
            value={snap.note}
            onChange={(e) => onNote?.(e.target.value)}
            disabled={saving}
            aria-invalid={snap.field === 'note' ? true : undefined}
            className="mt-1 w-full min-w-0 rounded-xl border border-white/[0.1] bg-white/[0.03] px-3 py-2 text-base text-on-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          />
          {snap.field === 'note' && snap.error && <p role="alert" className="mt-0.5 text-xs text-error">{snap.error}</p>}
        </div>

        {snap.error && snap.field !== 'note' && !kpis.includes(snap.field as PlanKpi) && (
          <p role="alert" className="text-sm text-error">{snap.error}</p>
        )}
        {snap.message && <p role="status" className="text-sm text-primary">{snap.message}</p>}

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={saving || fields.length === 0} className={cn(BTN_PRIMARY, 'disabled:opacity-60')}>
            {saving ? 'Сохраняем…' : 'Сохранить факт'}
          </button>
          <p className="text-xs text-on-surface-variant">Источник значений: «ежемесячная сверка». Пустое поле — значение не меняется.</p>
        </div>
      </form>
    </section>
  )
}

export default function MonthlyFactForm({
  kpis, period, initial, done, audience = 'client', url = CLIENT_FACTS_URL, onSaved, preview,
}: {
  kpis: PlanKpi[]
  period: string
  initial: KpiValues
  done: boolean
  audience?: 'client' | 'staff'
  url?: string
  onSaved?: () => void
  preview?: boolean
}) {
  const ctl = useMemo(
    () => new MonthlyFactController(preview ? IN_MEMORY : (input, init) => fetch(input, init), { url, kpis, period, initial, onSaved }),
    // A new month or a new plan starts the form over.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [url, period, kpis.join(','), preview],
  )
  const snap = useSyncExternalStore(ctl.subscribe, ctl.getSnapshot, ctl.getSnapshot)
  return (
    <MonthlyFactFormView
      snap={snap}
      kpis={kpis}
      audience={audience}
      done={done || snap.phase === 'saved'}
      onValue={(k, v) => ctl.setValue(k, v)}
      onNote={(n) => ctl.setNote(n)}
      onSubmit={() => void ctl.submit()}
    />
  )
}
