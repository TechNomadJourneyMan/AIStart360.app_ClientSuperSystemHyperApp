'use client'

import { Check, Circle } from 'lucide-react'
import { Badge, Panel, Timeline, cx, fmtDateTime, useGigaQuery } from '../kit'
import { eventLabel } from '@/lib/events/registry'
import type { Journey } from '@/lib/admin/journey'

interface EventRow { id: number; event_name: string; page: string | null; source: string; created_at: string }

/** CJM of one user: the stage path (from facts) + key events (from tracking). */
export function JourneyTab({ userId, journey, canActivity }: { userId: string; journey: Journey; canActivity: boolean }) {
  const { data } = useGigaQuery<{ data: EventRow[] }>(canActivity ? `/api/giga-admin/users/${userId}/events?pageviews=0` : null)
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Этапы пути" description={`${journey.completed} из ${journey.total} этапов`}>
        <ol className="space-y-0">
          {journey.stages.map((s, i) => {
            const isCurrent = journey.current?.key === s.key
            const isNext = journey.next?.key === s.key
            return (
              <li key={s.key} className="relative flex gap-3 pb-4 last:pb-0">
                {i < journey.stages.length - 1 && <span className={cx('absolute left-[11px] top-6 h-[calc(100%-12px)] w-px', s.done ? 'bg-emerald-400/40' : 'bg-white/[0.08]')} />}
                <span className={cx('relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border', s.done ? 'border-emerald-400/40 bg-emerald-400/15 text-emerald-300' : isNext ? 'border-blue-400/50 bg-blue-500/15 text-blue-300' : 'border-white/[0.1] text-slate-600')}>
                  {s.done ? <Check size={12} /> : <Circle size={8} />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={cx('text-xs font-medium', s.done ? 'text-slate-100' : 'text-slate-500')}>
                    {s.label}
                    {isCurrent && <Badge tone="green" className="ml-2">текущий этап</Badge>}
                    {isNext && <Badge tone="blue" className="ml-2">следующий</Badge>}
                  </p>
                  <p className="text-[10px] text-slate-600">{s.at ? fmtDateTime(s.at) : 'не пройден'}</p>
                </div>
              </li>
            )
          })}
        </ol>
        {journey.current && journey.next && journey.daysInStage != null && journey.daysInStage >= 14 && (
          <p className="mt-4 rounded-lg border border-amber-500/25 bg-amber-500/[0.08] px-3 py-2 text-[11px] text-amber-200">
            Пользователь {journey.daysInStage} дн. не переходит к этапу «{journey.next.label}» — возможная точка выхода.
          </p>
        )}
      </Panel>
      <Panel title="Ключевые события" description="Без просмотров страниц">
        {canActivity
          ? <Timeline items={(data?.data ?? []).slice(0, 25).map((e) => ({ id: String(e.id), at: e.created_at, title: eventLabel(e.event_name), subtitle: e.page ?? undefined, tone: e.source === 'impersonation' || e.source === 'admin' ? 'amber' as const : 'blue' as const }))} />
          : <p className="text-xs text-slate-500">Нет доступа к активности.</p>}
      </Panel>
    </div>
  )
}
