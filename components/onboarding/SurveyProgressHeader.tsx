'use client'

import { pointAMinimum, surveyDepth } from '@/lib/survey/progress'
import { POINT_A_KEY_QUESTIONS_LABEL } from '@/lib/survey/point-a-minimum'

/**
 * Honest progress under the wizard header (survey audit 2026-10-22, MVP item 5):
 * «Ключевые вопросы Точки А: 7 из 15» (was «Минимум для Точки А» — renamed in
 * R3-PA: closing them does not by itself give a score) — and «Глубина: 23 %» by answered fields
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
        {/* R3-PA (N7): key questions, not «the minimum» — the score has its own rule (≥ 60 % of the blocks' weight + Финансы / Продажи), shown at the review step and on the Point A page. */}
        <span title={ready ? 'Ключевые вопросы закрыты. Оценка появится по правилу: блоки с данными покрывают ≥ 60 % веса и среди них есть «Финансы» или «Продажи» — проверка перед отправкой покажет, чего не хватает' : `Не хватает: ${missing}`}>
          <span className={`material-symbols-outlined align-middle text-[13px] mr-1 ${ready ? 'text-primary' : 'text-on-surface-variant/60'}`} aria-hidden="true">
            {ready ? 'task_alt' : 'flag'}
          </span>
          {POINT_A_KEY_QUESTIONS_LABEL}: <b className="text-on-surface">{min.answered} из {min.total}</b>
          {ready && <span className="ml-1 text-primary">— закрыты</span>}
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
