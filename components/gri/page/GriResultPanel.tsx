'use client'

// components/gri/page/GriResultPanel.tsx — вкладка «Результат»: серверный итог
// диагностики из gri_assessments — индекс, средние по 7 блокам, TOP-5
// ограничений, план на 90 дней и CTA разбора. Чисто презентационный компонент:
// данные приходят из GriPageShell через props (никаких запросов здесь).
import Link from 'next/link'
import { GRI_SECTIONS } from '@/lib/gri-assessment/sections'
import type { Top5Limit } from '@/lib/gri-calculator/top5-action-plan'
import type { AssessmentCurrent } from './GriPageShell'
import DecisiveBets from './DecisiveBets'
import GriBenchmarks from './GriBenchmarks'
import Plan90Checklist from './Plan90Checklist'
import RealityCheckPanel from './RealityCheckPanel'

// Русские подписи 7 блоков GRI (sections.ts хранит английские shortTitle).
const BLOCK_RU: Record<string, string> = {
  'product-demand': 'Продукт и спрос',
  'trust-positioning': 'Доверие и позиционирование',
  'business-model': 'Бизнес-модель',
  'cash-stability': 'Денежная стабильность',
  operations: 'Операции',
  team: 'Команда',
  'owner-readiness': 'Готовность собственника',
}

// ── Defensive narrower (top_5_limits приходит как unknown) ────────────────────
function asTop5Limits(v: unknown): Top5Limit[] {
  if (!Array.isArray(v)) return []
  return v.filter(
    (x): x is Top5Limit =>
      !!x &&
      typeof x === 'object' &&
      typeof (x as Top5Limit).criterionText === 'string' &&
      typeof (x as Top5Limit).score === 'number',
  )
}

export default function GriResultPanel({
  assessment,
  onGoAssess,
}: {
  assessment: AssessmentCurrent | null
  onGoAssess: () => void
}) {
  if (!assessment) {
    return (
      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-10 text-center space-y-3">
        <p className="text-on-surface font-semibold">Диагностика ещё не пройдена</p>
        <p className="text-sm text-on-surface-variant max-w-md mx-auto">
          Пройдите точную диагностику из 7 блоков — здесь появятся ваш индекс,
          главные ограничения и план на 90 дней.
        </p>
        <button
          onClick={onGoAssess}
          className="px-4 py-2.5 rounded-xl bg-primary text-[#003824] text-sm font-semibold hover:bg-primary/90 transition-colors"
        >
          Пройти диагностику
        </button>
      </div>
    )
  }

  const avgs = assessment.section_avgs ?? {}
  const limits = asTop5Limits(assessment.top_5_limits)

  return (
    <div className="space-y-6">
      <section className="grid lg:grid-cols-2 gap-4">
        {/* Средние по блокам */}
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
          <p className="text-xs font-mono uppercase tracking-widest text-on-surface-variant">
            Средние по блокам
          </p>
          <ul className="mt-4 space-y-2.5">
            {GRI_SECTIONS.map((s) => {
              const raw = Number(avgs[s.id] ?? 0)
              const v = Number.isFinite(raw) ? raw : 0
              const tone = v >= 8 ? 'bg-primary' : v >= 6 ? 'bg-amber-400' : 'bg-red-400'
              return (
                <li key={s.id} className="flex items-center gap-3">
                  <span className="flex-1 text-sm text-on-surface truncate">
                    {BLOCK_RU[s.id] ?? s.shortTitle}
                  </span>
                  <span className="w-28 h-1.5 rounded-full bg-white/[0.08] overflow-hidden">
                    <span
                      className={`block h-full rounded-full ${tone}`}
                      style={{ width: `${(v / 10) * 100}%` }}
                    />
                  </span>
                  <span className="w-8 text-right text-sm tabular-nums text-on-surface">
                    {v.toFixed(1)}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>

        {/* TOP-5 ограничений */}
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
          <p className="text-xs font-mono uppercase tracking-widest text-on-surface-variant">
            TOP-5 ограничений
          </p>
          {limits.length === 0 ? (
            <p className="mt-4 text-sm text-on-surface-variant">Нет данных.</p>
          ) : (
            <ol className="mt-4 space-y-2.5">
              {limits.map((limit, idx) => (
                <li
                  key={`${limit.criterionId}-${idx}`}
                  className="flex items-center gap-3 rounded-xl border border-red-400/15 bg-white/[0.02] p-3"
                >
                  <span className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg bg-red-400/15 text-red-300 text-sm font-bold">
                    {idx + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] uppercase tracking-wide text-on-surface-variant truncate">
                      {limit.blockName}
                    </div>
                    <div className="text-sm text-on-surface truncate">{limit.criterionText}</div>
                  </div>
                  <span className="shrink-0 px-2 py-0.5 rounded bg-red-400/90 text-[#3a0000] text-xs font-bold tabular-nums">
                    {limit.score.toFixed(2)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>

      {/* Reality Check (Фаза 5, идея №30, решение ПО): детерминированная сверка
          самооценки GRI с фактами анкеты/Точки А — сам фетчит свой API и
          скрывается, когда данных нет. Ставим ДО плана: сначала честность
          оценки, потом действия. */}
      <RealityCheckPanel />

      {/* План на 90 дней — интерактивный чек-лист (Фаза 5, идея №4). Заменил
          прежний статический блок: тот же дизайн трёх горизонтов, но карточки
          отмечаются галочками, прогресс хранится в gri_plan_progress. */}
      <Plan90Checklist assessment={assessment} />

      {/* CTA — забронировать разбор */}
      <section className="rounded-2xl border border-primary/25 bg-gradient-to-r from-primary/[0.08] to-transparent p-6 text-center space-y-2">
        <p className="font-bold text-on-surface">Получите план действий на 90 дней с экспертом</p>
        <p className="text-sm text-on-surface-variant max-w-xl mx-auto">
          Забронируйте разбор — разложим ограничения по шагам и приоритетам под ваш бизнес.
        </p>
        <a
          href="https://tidycal.com/istart/gtm"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block mt-1 px-5 py-2.5 rounded-xl bg-primary text-[#003824] text-sm font-semibold hover:bg-primary/90 transition-colors"
        >
          📅 Забронировать разбор
        </a>
      </section>

      {/* «5 решающих ставок» + бенчмарки отрасли — только когда есть данные блоков */}
      {Object.keys(avgs).length > 0 && (
        <>
          <DecisiveBets
            top5Limits={assessment.top_5_limits}
            sectionAvgs={avgs}
            actionPlan90d={assessment.action_plan_90d}
          />
          <GriBenchmarks sectionAvgs={avgs} />
        </>
      )}

      {/* Методология — страница делает отдельный исполнитель */}
      <div className="text-center">
        <Link
          href="/gri/methodology"
          className="text-xs text-on-surface-variant hover:text-primary transition-colors"
        >
          Как считается GRI →
        </Link>
      </div>
    </div>
  )
}
