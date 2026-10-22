'use client'

import { pointAMinimum, surveyDepth } from '@/lib/survey/progress'

/**
 * Honest progress under the wizard header (survey audit 2026-10-22, MVP item 5):
 * «Минимум для Точки А: 7 из 15» — what the Point A engine needs, so the owner
 * knows when it is fine to stop — and «Глубина: 23 %» by answered fields
 * (it used to be «started steps / 12»: one toggle made a step «done»).
 * Shared by the wizard and the dev preview.
 */
export default function SurveyProgressHeader({ answers }: { answers: Readonly<Record<string, unknown>> }) {
  const depth = surveyDepth(answers)
  const min = pointAMinimum(answers)
  const ready = min.answered >= min.total
  const missing = min.missing.map((m) => `${m.label} (шаг ${m.step})`).join(', ')
  return (
    <>
      <div className="max-w-3xl mx-auto px-4 pb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-on-surface-variant">
        <span title={ready ? 'Всё, что нужно для расчёта Точки А, есть' : `Не хватает: ${missing}`}>
          <span className={`material-symbols-outlined align-middle text-[13px] mr-1 ${ready ? 'text-primary' : 'text-on-surface-variant/60'}`} aria-hidden="true">
            {ready ? 'task_alt' : 'flag'}
          </span>
          Минимум для Точки А: <b className="text-on-surface">{min.answered} из {min.total}</b>
          {ready && <span className="ml-1 text-primary">— можно формировать</span>}
        </span>
        <span title={`Отвечено ${depth.answered} из ${depth.total} вопросов`}>
          Глубина: <b className="text-on-surface">{depth.percent} %</b>
        </span>
      </div>
      <div className="h-0.5 bg-white/[0.04]" role="progressbar" aria-label="Глубина анкеты" aria-valuemin={0} aria-valuemax={100} aria-valuenow={depth.percent}>
        <div className="h-full bg-gradient-to-r from-primary to-[#00e29e] transition-all duration-500" style={{ width: `${depth.percent}%` }} />
      </div>
    </>
  )
}
