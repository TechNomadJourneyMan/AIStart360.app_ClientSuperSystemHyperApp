'use client'

// components/gri/page/Plan90Checklist.tsx — интерактивный план 90 дней
// (Фаза 5, идея №4): те же три горизонта, что раньше рендерил GriResultPanel
// статически, но каждая карточка — чек-бокс «шаг выполнен». Прогресс хранится
// в public.gri_plan_progress через /api/v1/gri/plan-progress (optimistic toggle
// + rollback). Если миграция 047 не применена или нет assessment.id — тот же
// план рендерится read-only, без галочек.
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import type { ActionCard } from '@/lib/gri-calculator/top5-action-plan'
import {
  computePlanPct,
  filterKnownKeys,
  flattenPlanSteps,
  HORIZON_KEYS,
  type HorizonKey,
  type PlanStep,
} from '@/lib/gri/plan-progress'

const HORIZON_LABEL: Record<HorizonKey, string> = {
  days_1_30: '1–30 дней',
  days_31_60: '31–60 дней',
  days_61_90: '61–90 дней',
}

// Тона приоритетов — как в GriResultPanel до замены статического блока.
const PRIORITY_TONE: Record<ActionCard['priority'], string> = {
  Критично: 'text-red-300 border-red-400/30 bg-red-400/10',
  Высокий: 'text-amber-300 border-amber-400/30 bg-amber-400/10',
  Средний: 'text-primary border-primary/30 bg-primary/10',
}

export default function Plan90Checklist({
  assessment,
}: {
  // Структурный проп: AssessmentCurrent из GriPageShell подходит как есть;
  // id в его типе нет, но строка gri_assessments приходит из select('*').
  assessment: { action_plan_90d: unknown; id?: unknown }
}) {
  const assessmentId = typeof assessment.id === 'string' ? assessment.id : null
  const steps = useMemo(
    () => flattenPlanSteps(assessment.action_plan_90d),
    [assessment.action_plan_90d],
  )

  const [done, setDone] = useState<Set<string>>(new Set())
  const [unavailable, setUnavailable] = useState(false)
  const [loaded, setLoaded] = useState(false)

  // ── загрузка сохранённых галочек ────────────────────────────────────────────
  useEffect(() => {
    if (!assessmentId) {
      setUnavailable(true)
      setLoaded(true)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(
          `/api/v1/gri/plan-progress?assessment_id=${encodeURIComponent(assessmentId)}`,
          { credentials: 'include' },
        )
        const json = await res.json().catch(() => null)
        if (cancelled) return
        if (!res.ok || !json?.ok || json.unavailable) {
          setUnavailable(true)
          return
        }
        const keys: string[] = Array.isArray(json.done)
          ? json.done.filter((k: unknown): k is string => typeof k === 'string')
          : []
        setDone(new Set(keys))
      } catch {
        if (!cancelled) setUnavailable(true)
      } finally {
        if (!cancelled) setLoaded(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [assessmentId])

  // ── optimistic toggle + rollback ────────────────────────────────────────────
  const toggle = useCallback(
    async (key: string) => {
      if (!assessmentId || unavailable) return
      const next = !done.has(key)
      const apply = (s: Set<string>, add: boolean) => {
        const copy = new Set(s)
        if (add) copy.add(key)
        else copy.delete(key)
        return copy
      }
      setDone((prev) => apply(prev, next))
      try {
        const res = await fetch('/api/v1/gri/plan-progress', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ assessment_id: assessmentId, step_key: key, done: next }),
        })
        const json = await res.json().catch(() => null)
        if (!res.ok || !json?.ok) {
          setDone((prev) => apply(prev, !next)) // rollback
          if (json?.error === 'migration_047_required') {
            setUnavailable(true)
            toast.error('Чек-лист пока недоступен — отметки не сохраняются')
          } else {
            toast.error('Не удалось сохранить отметку — попробуйте ещё раз')
          }
        }
      } catch {
        setDone((prev) => apply(prev, !next)) // rollback (сеть)
        toast.error('Не удалось сохранить отметку — попробуйте ещё раз')
      }
    },
    [assessmentId, unavailable, done],
  )

  // ── прогресс (только ключи, существующие в текущем плане) ──────────────────
  const knownDone = useMemo(() => filterKnownKeys(done, steps), [done, steps])
  const total = steps.length
  const doneCount = knownDone.length
  const pct = computePlanPct(knownDone, total)
  const interactive = loaded && !unavailable && !!assessmentId

  return (
    <section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
      <p className="text-xs font-mono uppercase tracking-widest text-on-surface-variant">
        План на 90 дней
      </p>

      {total === 0 ? (
        <p className="mt-4 text-sm text-on-surface-variant">
          План появится после полной диагностики всех блоков.
        </p>
      ) : (
        <>
          {interactive && (
            <div className="mt-3 space-y-1.5">
              <p className="text-xs text-on-surface-variant tabular-nums">
                Выполнено {doneCount} из {total} ({pct}%)
              </p>
              <div
                className="h-1.5 rounded-full bg-white/[0.08] overflow-hidden"
                role="progressbar"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Прогресс плана на 90 дней"
              >
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300"
                  style={{ width: `${pct}%` }}
                />
              </div>
              {pct >= 30 && pct < 100 && (
                <p className="pt-1 text-xs text-on-surface-variant">
                  Отличный темп! Выполнили несколько шагов — снимите «Пульс недели»,
                  чтобы увидеть сдвиг.{' '}
                  <Link href="/pulse" className="text-primary hover:underline whitespace-nowrap">
                    Снять пульс →
                  </Link>
                </p>
              )}
            </div>
          )}

          <div className="mt-4 grid md:grid-cols-3 gap-4">
            {HORIZON_KEYS.map((horizon) => {
              const cards = steps.filter((s) => s.horizon === horizon)
              return (
                <div key={horizon} className="space-y-2.5">
                  <div className="text-xs font-semibold text-primary">
                    {HORIZON_LABEL[horizon]}
                  </div>
                  {cards.length === 0 ? (
                    <p className="text-xs text-on-surface-variant">—</p>
                  ) : (
                    cards.map((step) =>
                      interactive ? (
                        <StepCheckbox
                          key={step.key}
                          step={step}
                          checked={done.has(step.key)}
                          onToggle={() => void toggle(step.key)}
                        />
                      ) : (
                        <StaticCard key={step.key} card={step.card} />
                      ),
                    )
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </section>
  )
}

// ── карточка-чекбокс ──────────────────────────────────────────────────────────
function StepCheckbox({
  step,
  checked,
  onToggle,
}: {
  step: PlanStep
  checked: boolean
  onToggle: () => void
}) {
  const { card } = step
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={checked}
      className={`w-full text-left rounded-xl border p-3 transition-colors ${
        checked
          ? 'border-primary/30 bg-primary/[0.06]'
          : 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.14]'
      }`}
    >
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden
          className={`mt-0.5 shrink-0 w-5 h-5 rounded-md border flex items-center justify-center transition-colors ${
            checked ? 'border-primary bg-primary text-[#003824]' : 'border-white/[0.20]'
          }`}
        >
          {checked && (
            <span className="material-symbols-outlined text-sm leading-none">check</span>
          )}
        </span>
        <span className="flex-1 min-w-0 space-y-1.5">
          <span
            className={`inline-block px-2 py-0.5 rounded-full border text-[10px] font-medium ${PRIORITY_TONE[card.priority] ?? ''}`}
          >
            {card.priority}
          </span>
          <span
            className={`block text-sm leading-snug ${
              checked ? 'text-on-surface-variant line-through' : 'text-on-surface'
            }`}
          >
            {card.limitation}
          </span>
          <span className="block text-xs text-on-surface-variant leading-snug">
            {card.focus}
          </span>
        </span>
      </div>
    </button>
  )
}

// ── read-only карточка (unavailable / нет id — как раньше) ───────────────────
function StaticCard({ card }: { card: ActionCard }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 space-y-1.5">
      <span
        className={`inline-block px-2 py-0.5 rounded-full border text-[10px] font-medium ${PRIORITY_TONE[card.priority] ?? ''}`}
      >
        {card.priority}
      </span>
      <div className="text-sm text-on-surface leading-snug">{card.limitation}</div>
      <div className="text-xs text-on-surface-variant leading-snug">{card.focus}</div>
    </div>
  )
}
