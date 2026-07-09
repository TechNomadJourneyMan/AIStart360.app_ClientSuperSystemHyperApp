'use client'

// components/gri/page/DecisiveBets.tsx — «5 решающих ставок»: презентационный
// список карточек «ставка → ожидаемый эффект → первый шаг» по мотивам формата
// "5 Game-Changing Bets". Вся логика — в чистом трансформере
// lib/gri/decisive-bets.ts; компонент только рендерит.
import { useMemo } from 'react'
import { computeDecisiveBets } from '@/lib/gri/decisive-bets'

export default function DecisiveBets({
  top5Limits,
  sectionAvgs,
  actionPlan90d,
}: {
  top5Limits: unknown
  sectionAvgs?: Record<string, number> | null
  actionPlan90d?: unknown
}) {
  const bets = useMemo(
    () => computeDecisiveBets(top5Limits, sectionAvgs, actionPlan90d),
    [top5Limits, sectionAvgs, actionPlan90d],
  )

  if (bets.length === 0) return null

  return (
    <section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
      <p className="text-xs font-mono uppercase tracking-widest text-on-surface-variant">
        5 решающих ставок
      </p>
      <p className="mt-1 text-sm text-on-surface-variant">
        Ограничения, работа с которыми даст максимальный сдвиг GRI в ближайшие 90 дней.
      </p>

      <ol className="mt-4 space-y-2.5">
        {bets.map((bet, idx) => (
          <li
            key={`${bet.bet}-${idx}`}
            className="flex gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4"
          >
            <span className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg bg-primary/15 text-primary text-sm font-bold">
              {idx + 1}
            </span>
            <div className="flex-1 min-w-0 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-on-surface">{bet.bet}</span>
                <span className="px-2 py-0.5 rounded-full border border-white/[0.10] bg-white/[0.04] text-[10px] uppercase tracking-wide text-on-surface-variant">
                  {bet.block}
                </span>
              </div>
              <div className="flex items-start gap-1.5 text-sm text-primary">
                <span className="material-symbols-outlined text-base leading-5" aria-hidden>
                  trending_up
                </span>
                <span className="tabular-nums">{bet.expectedEffect}</span>
              </div>
              <div className="flex items-start gap-1.5 text-xs text-on-surface-variant leading-snug">
                <span className="material-symbols-outlined text-base leading-4" aria-hidden>
                  flag
                </span>
                <span>Первый шаг: {bet.firstStep}</span>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
