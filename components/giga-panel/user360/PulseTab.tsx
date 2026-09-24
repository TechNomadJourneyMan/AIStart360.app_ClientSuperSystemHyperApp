'use client'

import { GRI_SECTIONS } from '@/lib/gri-assessment/sections'
import { EmptyState, ErrorState, Panel, Skeleton, StatTile, fmtDate, useGigaQuery } from '../kit'

/**
 * Пульс клиента: еженедельные чек-ины GRI Pulse (самооценка 7 блоков, 1–10).
 * Показываем только то, что клиент реально отправил, и явные метрики из
 * разбора ИИ, если они записаны. Никаких «рисков», вычисленных из балла.
 */

interface PulseRow { id: string; weekStart: string; scores: Record<string, number>; index: number; note: string | null; createdAt: string }
interface PulseData {
  responses: PulseRow[]
  latest: PulseRow | null
  delta: number | null
  explicit: Record<string, number | string> | null
  unavailable?: boolean
}

const METRIC_LABEL: Record<string, string> = {
  avgCheck: 'Средний чек', volumeChange: 'Изменение объёма, %', riskScore: 'Риск', churnProb: 'Вероятность оттока, %',
  daysSince: 'Дней с последнего заказа', lastOrderAt: 'Последний заказ', orderCycle: 'Цикл заказа, дней', action: 'Рекомендация',
}

const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n).toFixed(2)}`

export function PulseTab({ userId }: { userId: string }) {
  const { data, error, loading, reload } = useGigaQuery<{ data: PulseData }>(`/api/giga-admin/users/${userId}/pulse`)
  const d = data?.data

  if (loading && !d) return <Skeleton className="h-48" />
  if (error) return <ErrorState error={error} onRetry={reload} />
  if (!d) return null

  return (
    <div className="space-y-4">
      {d.unavailable && (
        <p className="rounded-xl border border-amber-500/20 bg-amber-500/[0.06] px-4 py-2.5 text-xs text-amber-200">
          Хранилище Pulse недоступно — показаны только данные разбора ИИ.
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatTile label="Pulse-индекс" value={d.latest ? d.latest.index.toFixed(2) : '—'} hint={d.latest ? `неделя с ${fmtDate(d.latest.weekStart)}` : 'чек-инов не было'} tone="violet" />
        <StatTile label="К прошлой неделе" value={d.delta == null ? '—' : signed(d.delta)} hint={d.delta == null ? 'нужно два чек-ина' : undefined} tone={d.delta != null && d.delta < 0 ? 'red' : 'green'} />
        <StatTile label="Чек-инов" value={d.responses.length} hint="за последние полгода" tone="blue" />
      </div>

      {!d.responses.length && (
        <Panel>
          <EmptyState title="Клиент ещё не отправлял Pulse" text="Еженедельный чек-ин по 7 блокам GRI появится здесь после первой отправки." />
        </Panel>
      )}

      {d.latest && (
        <Panel title="Последний чек-ин по блокам" description={fmtDate(d.latest.createdAt)}>
          <ul className="space-y-1.5">
            {GRI_SECTIONS.map((s) => {
              const v = Number(d.latest?.scores?.[s.id] ?? 0)
              return (
                <li key={s.id} className="flex items-center gap-3 text-xs">
                  <span className="w-48 shrink-0 truncate text-slate-400">{s.shortTitle ?? s.title}</span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                    <span className="block h-full rounded-full bg-violet-400/70" style={{ width: `${Math.max(0, Math.min(10, v)) * 10}%` }} />
                  </span>
                  <span className="w-8 text-right tabular-nums text-slate-200">{v ? v : '—'}</span>
                </li>
              )
            })}
          </ul>
          {d.latest.note && <p className="mt-3 whitespace-pre-wrap rounded-xl bg-white/[0.03] p-3 text-xs text-slate-300">«{d.latest.note}»</p>}
        </Panel>
      )}

      {d.responses.length > 1 && (
        <Panel title="История чек-инов">
          <ul className="divide-y divide-white/[0.05] text-xs">
            {d.responses.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-1.5 text-slate-400">
                <span>Неделя с {fmtDate(r.weekStart)}</span>
                {r.note && <span className="min-w-0 flex-1 truncate text-slate-500">{r.note}</span>}
                <span className="tabular-nums text-slate-200">{r.index.toFixed(2)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {d.explicit && (
        <Panel title="Метрики из разбора ИИ" description="Только значения, явно записанные в разборе">
          <dl className="grid gap-2 sm:grid-cols-2">
            {Object.entries(d.explicit).map(([k, v]) => (
              <div key={k} className="rounded-xl bg-white/[0.03] px-3 py-2">
                <dt className="text-[11px] text-slate-500">{METRIC_LABEL[k] ?? k}</dt>
                <dd className="text-sm text-slate-200">{k === 'lastOrderAt' ? fmtDate(String(v)) : String(v)}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      )}
    </div>
  )
}
