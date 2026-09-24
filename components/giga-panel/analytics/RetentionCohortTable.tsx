'use client'

/**
 * Retention heatmap: weekly registration cohorts × D1/D7/D30 and W1..W8.
 * Cell intensity = retention % (inline opacity); «—» = the day/week has not
 * come yet for this cohort (not the same as 0%).
 */
import { COHORT_WEEKS, cohortCellOpacity, fmtPct, type CohortRow } from '@/lib/analytics/reports'

const weekLabel = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })

function Cell({ value, title }: { value: number | null; title: string }) {
  return (
    <td className="p-0.5">
      <div
        className="relative flex h-7 min-w-[2.75rem] items-center justify-center overflow-hidden rounded-md text-[10px] tabular-nums"
        title={title}
        data-testid="cohort-cell"
        data-value={value ?? ''}
      >
        {value !== null && (
          <span className="absolute inset-0 bg-emerald-400" style={{ opacity: cohortCellOpacity(value) }} aria-hidden />
        )}
        <span className={value === null ? 'relative text-slate-700' : 'relative font-medium text-white'}>{fmtPct(value)}</span>
      </div>
    </td>
  )
}

export function RetentionCohortTable({ cohorts }: { cohorts: CohortRow[] }) {
  if (!cohorts.length) {
    return <p className="py-8 text-center text-xs text-slate-600">Когорт пока нет: нужны регистрации клиентов и хотя бы одна ночная свёртка активности.</p>
  }
  const weeks = Array.from({ length: COHORT_WEEKS }, (_, i) => i + 1)
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-0 text-left">
        <thead>
          <tr className="text-[10px] uppercase tracking-wide text-slate-500">
            <th className="px-2 py-1.5 font-medium">Неделя регистрации</th>
            <th className="px-2 py-1.5 text-right font-medium">Клиентов</th>
            <th className="px-1 py-1.5 text-center font-medium" title="Вернулись на следующий день или позже">D1</th>
            <th className="px-1 py-1.5 text-center font-medium" title="Были активны на 7-й день или позже">D7</th>
            <th className="px-1 py-1.5 text-center font-medium" title="Были активны на 30-й день или позже">D30</th>
            {weeks.map((w) => (
              <th key={w} className="px-1 py-1.5 text-center font-medium" title={`Активны на ${w}-й неделе после регистрации (дни ${w * 7}–${w * 7 + 6})`}>W{w}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cohorts.map((c) => (
            <tr key={c.cohort_start} className="text-xs text-slate-300">
              <td className="whitespace-nowrap px-2 py-1">с {weekLabel(c.cohort_start)}</td>
              <td className="px-2 py-1 text-right tabular-nums text-slate-400">{c.cohort_size}</td>
              <Cell value={c.d1} title={`D1 · когорта ${c.cohort_size}`} />
              <Cell value={c.d7} title={`D7 · когорта ${c.cohort_size}`} />
              <Cell value={c.d30} title={`D30 · когорта ${c.cohort_size}`} />
              {weeks.map((w) => <Cell key={w} value={c.weeks[w - 1] ?? null} title={`W${w} · когорта ${c.cohort_size}`} />)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
