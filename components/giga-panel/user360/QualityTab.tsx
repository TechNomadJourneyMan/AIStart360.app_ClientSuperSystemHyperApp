'use client'

import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react'
import { Badge, EmptyState, ErrorState, Panel, Skeleton, StatTile, useGigaQuery } from '../kit'
import { SURVEY_LABELS } from '@/lib/survey-labels'

/**
 * Противоречия и пробелы в данных клиента.
 *
 * Те же проверки, что видит сам клиент в ассистенте, — но собранные в одном
 * месте, чтобы сотрудник понимал, почему диагностика выглядит странно, и знал,
 * что именно переспросить.
 */

interface Issue {
  id: string
  severity: 'error' | 'warning' | 'info'
  section: string
  field?: string
  code: string
  message_ru: string
  hint_ru?: string
}

const SEV = {
  error: { label: 'критично', tone: 'red' as const, Icon: XCircle, cls: 'text-red-400' },
  warning: { label: 'внимание', tone: 'amber' as const, Icon: AlertTriangle, cls: 'text-amber-400' },
  info: { label: 'мелочь', tone: 'neutral' as const, Icon: Info, cls: 'text-slate-400' },
}

export function QualityTab({ userId }: { userId: string }) {
  const { data, error, loading, reload } = useGigaQuery<{ data: { issues: Issue[]; counts: Record<string, number> } }>(
    `/api/giga-admin/users/${userId}/quality`,
  )
  const d = data?.data

  return (
    <div className="space-y-4">
      <ErrorState error={error} onRetry={reload} />
      {loading && !d && <Skeleton className="h-64" />}
      {d && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <StatTile label="Критичных" value={d.counts.error ?? 0} hint="ломают расчёт" tone={d.counts.error ? 'red' : 'green'} />
            <StatTile label="Требуют внимания" value={d.counts.warning ?? 0} hint="искажают выводы" tone="amber" />
            <StatTile label="Мелочей" value={d.counts.info ?? 0} hint="можно уточнить позже" />
          </div>

          {!d.issues.length ? (
            <Panel>
              <EmptyState
                icon={<CheckCircle2 size={22} className="text-emerald-400" />}
                title="Противоречий не найдено"
                text="Данные согласованы — диагностике можно доверять."
              />
            </Panel>
          ) : (
            <Panel title="Что не сходится" description="Проверки детерминированные: одни и те же данные всегда дают один и тот же результат.">
              <ul className="divide-y divide-white/[0.05]">
                {d.issues.map((i) => {
                  const sev = SEV[i.severity] ?? SEV.info
                  const Icon = sev.Icon
                  return (
                    <li key={i.id} className="flex gap-3 py-3">
                      <Icon size={15} className={`mt-0.5 shrink-0 ${sev.cls}`} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-slate-200">{i.message_ru}</p>
                        {i.hint_ru && <p className="mt-0.5 text-xs text-slate-500">{i.hint_ru}</p>}
                        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-slate-600">
                          <Badge tone={sev.tone}>{sev.label}</Badge>
                          {i.field && <span>{SURVEY_LABELS[i.field] ?? i.field}</span>}
                          <span className="font-mono">{i.code}</span>
                        </p>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </Panel>
          )}
        </>
      )}
    </div>
  )
}
