'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Badge, fmtAgo, gigaFetch } from '../kit'
import { PROFILE_STATUS } from '@/lib/admin/labels'

export interface SurveyPreview {
  id: string; name: string | null; email: string | null; phone: string | null; status: string; role: string
  company: string | null; industry: string; employees: string; revenue: string; goal12m: string; contact: string
  percent: number; startedSteps: number; totalSteps: number; answers: number; startedAt: string | null; updatedAt: string | null
  sections: Array<{ id: string; title: string; filled: number; total: number }>
}

// Shared per-page cache: hovering the same row twice does not refetch.
const cache = new Map<string, SurveyPreview>()

export function SurveyPreviewCard({ userId }: { userId: string }) {
  const [data, setData] = useState<SurveyPreview | null>(cache.get(userId) ?? null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (cache.has(userId)) return
    let alive = true
    gigaFetch<{ data: SurveyPreview }>(`/api/giga-admin/surveys/${userId}/preview`)
      .then((r) => { cache.set(userId, r.data); if (alive) setData(r.data) })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : 'Ошибка') })
    return () => { alive = false }
  }, [userId])

  if (error) return <p className="text-xs text-red-300">{error}</p>
  if (!data) return <div className="flex items-center gap-2 py-4 text-xs text-slate-500"><Loader2 size={13} className="animate-spin" /> Загрузка…</div>

  const facts: Array<[string, string]> = [
    ['Отрасль', data.industry],
    ['Сотрудников', data.employees],
    ['Выручка', data.revenue],
    ['Цель 12 мес', data.goal12m],
    ['Контакт', data.contact],
    ['Телефон', data.phone ?? ''],
  ].filter(([, v]) => v) as Array<[string, string]>

  return (
    <div className="space-y-2.5">
      <div>
        <p className="truncate text-sm font-semibold text-slate-100">{data.company || data.name || data.email}</p>
        <p className="truncate text-[11px] text-slate-500">{[data.name, data.email].filter(Boolean).join(' · ')}</p>
        <div className="mt-1.5 flex flex-wrap gap-1">
          <Badge tone={PROFILE_STATUS[data.status]?.tone}>{PROFILE_STATUS[data.status]?.label ?? data.status}</Badge>
          <Badge tone={data.startedSteps >= data.totalSteps ? 'green' : data.startedSteps ? 'blue' : 'neutral'}>анкета {data.percent}%</Badge>
          <Badge>ответов: {data.answers}</Badge>
        </div>
      </div>
      {facts.length > 0 && (
        <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-2 gap-y-1 text-[11px]">
          {facts.map(([k, v]) => (
            <div key={k} className="contents"><dt className="text-slate-500">{k}</dt><dd className="truncate text-slate-200" title={v}>{v}</dd></div>
          ))}
        </dl>
      )}
      <div className="space-y-1">
        {data.sections.map((s) => (
          <div key={s.id} className="flex items-center gap-2">
            <span className="w-28 shrink-0 truncate text-[10px] text-slate-500">{s.title}</span>
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
              <div className="h-full rounded-full bg-blue-400/70" style={{ width: `${s.total ? (s.filled / s.total) * 100 : 0}%` }} />
            </div>
            <span className="w-9 text-right font-mono text-[10px] text-slate-500">{s.filled}/{s.total}</span>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-slate-600">
        {data.updatedAt ? `Изменена ${fmtAgo(data.updatedAt)}` : 'Анкета не начата'} · нажмите, чтобы открыть
      </p>
    </div>
  )
}

export function invalidateSurveyPreview(userId: string): void {
  cache.delete(userId)
}
