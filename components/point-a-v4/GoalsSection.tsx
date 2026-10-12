'use client'

/** «Мои цели» (spec §3): gap А→Б, pace, realism and status of every goal. */
import Link from 'next/link'
import type { PointAPageState } from '@/hooks/usePointAState'
import { GoalsBar } from '@/components/dashboard/GoalsBar'
import { CARD, CHIP, Icon, SectionTitle, fmtValue } from './ui'
import { cn } from '@/lib/utils'

const STATUS: Record<string, { text: string; cls: string }> = {
  achieved: { text: 'Достигнута', cls: 'bg-primary/10 text-primary' },
  on_track: { text: 'По плану', cls: 'bg-primary/10 text-primary' },
  at_risk: { text: 'Под угрозой', cls: 'bg-amber-300/10 text-amber-200' },
  behind: { text: 'Отстаём', cls: 'bg-red-300/10 text-red-200' },
  overdue: { text: 'Срок прошёл', cls: 'bg-red-300/10 text-red-200' },
  no_data: { text: 'Нет факта', cls: 'bg-white/[0.04] text-on-surface-variant' },
  unknown: { text: 'Темп не оценить', cls: 'bg-white/[0.04] text-on-surface-variant' },
}

export function GoalsSection({ state }: { state: PointAPageState }) {
  return (
    <section className={CARD} aria-labelledby="pa-goals">
      <SectionTitle icon="flag" aside={<Link href="/client/point-b" className="text-[11px] font-mono text-primary/80 hover:text-primary">План в Точке Б →</Link>}>
        <span id="pa-goals">Мои цели</span>
      </SectionTitle>
      {state.goals.length === 0 && (
        <p className="text-sm text-on-surface-variant mb-3">Цель — значение показателя к сроку. Задайте её — Точка А покажет разрыв, а Точка Б построит план.</p>
      )}
      <ul className="space-y-3 mb-3">
        {state.goals.map(({ goal, evaluation: e }) => {
          const st = STATUS[e.status] ?? STATUS.no_data
          return (
            <li key={goal.id} className="rounded-xl border border-white/[0.06] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-on-surface">{goal.label}</p>
                <span className={cn(CHIP, st.cls)}>{st.text}</span>
              </div>
              <p className="mt-1 text-sm font-mono text-on-surface">
                {fmtValue(e.current, goal.unit)} <Icon name="arrow_forward" className="text-[14px] align-middle text-on-surface-variant" /> {fmtValue(goal.targetValue, goal.unit)}
                <span className="ml-2 text-[11px] text-on-surface-variant">до {new Date(e.deadline).toLocaleDateString('ru-RU')}</span>
              </p>
              {e.progress !== null && (
                <div className="mt-2 h-1.5 rounded-full bg-white/[0.06]" role="progressbar" aria-valuenow={e.progress} aria-valuemin={0} aria-valuemax={100} aria-label="Прогресс к цели">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${e.progress}%` }} />
                </div>
              )}
              <p className="mt-1.5 text-xs text-on-surface-variant">{e.realismText}</p>
            </li>
          )
        })}
      </ul>
      {state.canManage && <GoalsBar />}
    </section>
  )
}
