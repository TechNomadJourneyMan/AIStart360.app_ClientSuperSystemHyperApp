/**
 * Очередь эксперта с таймером «осталось N ч» (R2-B). Презентационный
 * компонент: задачи и момент «сейчас» приходят снаружи (страница обновляет его
 * раз в минуту), поэтому он одинаково рисуется на сервере и в тестах.
 */
import Link from 'next/link'
import { STAGE_LABELS, slaStage, slaTimerLabel, type SlaStage, type SlaTimes, type ExpertSlaSource } from '@/lib/expert-sla/policy'
import { expertTaskHref } from '@/lib/expert-sla/links'

export interface ExpertQueueTask extends SlaTimes {
  id: string
  source: ExpertSlaSource
  source_id: string
  client_id: string
  title: string
  sourceLabel: string
  client: { id: string; name: string }
}

const TONE: Record<SlaStage, string> = {
  breached: 'text-error border-error/30 bg-error/10',
  escalated: 'text-error border-error/30 bg-error/10',
  due_soon: 'text-amber-400 border-amber-400/30 bg-amber-400/10',
  ok: 'text-primary border-primary/25 bg-primary/10',
  closed: 'text-on-surface-variant border-white/[0.08] bg-white/[0.03]',
}

export function SlaTimerBadge({ task, now }: { task: SlaTimes; now: Date }) {
  const stage = slaStage(task, now)
  return (
    <span
      data-stage={stage}
      title={STAGE_LABELS[stage]}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium tabular-nums ${TONE[stage]}`}
    >
      <span className="material-symbols-outlined text-[13px]" aria-hidden>schedule</span>
      {slaTimerLabel(task, now)}
    </span>
  )
}

export function ExpertSlaQueueList({ tasks, now, emptyText = 'Задач в очереди нет — всё отвечено.' }: {
  tasks: ExpertQueueTask[]
  now: Date
  emptyText?: string
}) {
  if (!tasks.length) {
    return (
      <div className="rounded-xl border border-dashed border-white/[0.06] py-8 text-center text-sm text-on-surface-variant">
        {emptyText}
      </div>
    )
  }
  return (
    <ul className="space-y-2">
      {tasks.map((t) => {
        const stage = slaStage(t, now)
        return (
          <li key={t.id}>
            <Link
              href={expertTaskHref(t)}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-white/[0.04] bg-surface-container p-3 transition-all hover:border-primary/20 hover:bg-primary/5"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-on-surface">{t.title}</p>
                <p className="truncate text-xs text-on-surface-variant">
                  {`${t.sourceLabel} · ${t.client.name}${!t.first_response_at && stage !== 'breached' ? ' · ждёт реакции' : ''}`}
                </p>
              </div>
              <SlaTimerBadge task={t} now={now} />
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
