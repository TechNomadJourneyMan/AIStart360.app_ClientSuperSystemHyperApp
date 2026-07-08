'use client'

// components/gri/page/GriResultPanel.tsx — вкладка «Результат»: серверный итог
// диагностики из gri_assessments — индекс, средние по 7 блокам, TOP-5
// ограничений, план на 90 дней и CTA разбора. Чисто презентационный компонент:
// данные приходят из GriPageShell через props (никаких запросов здесь).
import { GRI_SECTIONS } from '@/lib/gri-assessment/sections'
import type { ActionCard, ActionPlan90d, Top5Limit } from '@/lib/gri-calculator/top5-action-plan'
import type { AssessmentCurrent } from './GriPageShell'

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

const PRIORITY_TONE: Record<ActionCard['priority'], string> = {
  Критично: 'text-red-300 border-red-400/30 bg-red-400/10',
  Высокий: 'text-amber-300 border-amber-400/30 bg-amber-400/10',
  Средний: 'text-primary border-primary/30 bg-primary/10',
}

const HORIZONS: { key: keyof ActionPlan90d; label: string }[] = [
  { key: 'days_1_30', label: '1–30 дней' },
  { key: 'days_31_60', label: '31–60 дней' },
  { key: 'days_61_90', label: '61–90 дней' },
]

// ── Defensive narrowers (top_5_limits / action_plan_90d приходят как unknown) ──
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

function asActionPlan(v: unknown): ActionPlan90d {
  const empty: ActionPlan90d = { days_1_30: [], days_31_60: [], days_61_90: [] }
  if (!v || typeof v !== 'object') return empty
  const p = v as Partial<ActionPlan90d>
  return {
    days_1_30: Array.isArray(p.days_1_30) ? p.days_1_30 : [],
    days_31_60: Array.isArray(p.days_31_60) ? p.days_31_60 : [],
    days_61_90: Array.isArray(p.days_61_90) ? p.days_61_90 : [],
  }
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
  const plan = asActionPlan(assessment.action_plan_90d)

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

      {/* План на 90 дней */}
      <section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
        <p className="text-xs font-mono uppercase tracking-widest text-on-surface-variant">
          План на 90 дней
        </p>
        {plan.days_1_30.length + plan.days_31_60.length + plan.days_61_90.length === 0 ? (
          <p className="mt-4 text-sm text-on-surface-variant">
            План появится после полной диагностики всех блоков.
          </p>
        ) : (
          <div className="mt-4 grid md:grid-cols-3 gap-4">
            {HORIZONS.map(({ key, label }) => {
              const cards = plan[key]
              return (
                <div key={key} className="space-y-2.5">
                  <div className="text-xs font-semibold text-primary">{label}</div>
                  {cards.length === 0 ? (
                    <p className="text-xs text-on-surface-variant">—</p>
                  ) : (
                    cards.map((card, i) => (
                      <div
                        key={`${key}-${i}`}
                        className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 space-y-1.5"
                      >
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full border text-[10px] font-medium ${PRIORITY_TONE[card.priority] ?? ''}`}
                        >
                          {card.priority}
                        </span>
                        <div className="text-sm text-on-surface leading-snug">{card.limitation}</div>
                        <div className="text-xs text-on-surface-variant leading-snug">{card.focus}</div>
                      </div>
                    ))
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

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
    </div>
  )
}
