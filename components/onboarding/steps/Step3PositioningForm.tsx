'use client'

import React from 'react'

/* ─── Types ────────────────────────────────────────────────────────────────── */
interface Step3PositioningFormProps {
  data: Record<string, unknown>
  onChange: (key: string, value: unknown) => void
}

/* ─── Helpers ──────────────────────────────────────────────────────────────── */
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/* ─── Constants ────────────────────────────────────────────────────────────── */
const PRICE_SEGMENTS = [
  { value: '', label: '— Выберите —' },
  { value: 'economy', label: 'Эконом' },
  { value: 'medium', label: 'Средний' },
  { value: 'premium', label: 'Премиум' },
]

/* ─── Component ────────────────────────────────────────────────────────────── */
export default function Step3PositioningForm({ data, onChange }: Step3PositioningFormProps) {
  return (
    <div className="space-y-8">
      {/* ── Target audience ───────────────────────────────────────────────── */}
      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-on-surface mb-4">
          <span className="material-symbols-outlined text-primary text-lg">groups</span>
          Целевая аудитория
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* s5_target_audience (reused) */}
          <div className="md:col-span-2">
            <label htmlFor="s5_target_audience" className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
              Целевая аудитория
            </label>
            <textarea
              id="s5_target_audience"
              rows={3}
              value={str(data.s5_target_audience)}
              onChange={(e) => onChange('s5_target_audience', e.target.value)}
              placeholder="Опишите вашу целевую аудиторию..."
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
            />
          </div>

          {/* s3n_client_portrait */}
          <div className="md:col-span-2">
            <label htmlFor="s3n_client_portrait" className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
              Портрет клиента
            </label>
            <textarea
              id="s3n_client_portrait"
              rows={3}
              value={str(data.s3n_client_portrait)}
              onChange={(e) => onChange('s3n_client_portrait', e.target.value)}
              placeholder="Детальный портрет идеального клиента: демография, поведение, потребности..."
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
            />
          </div>

          {/* s3n_price_segment — select */}
          <div>
            <label htmlFor="s3n_price_segment" className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
              Ценовой сегмент
            </label>
            <select
              id="s3n_price_segment"
              value={str(data.s3n_price_segment)}
              onChange={(e) => onChange('s3n_price_segment', e.target.value)}
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all appearance-none"
            >
              {PRICE_SEGMENTS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* s3n_decision_maker */}
          <div>
            <label htmlFor="s3n_decision_maker" className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
              Лицо, принимающее решение
            </label>
            <textarea
              id="s3n_decision_maker"
              rows={2}
              value={str(data.s3n_decision_maker)}
              onChange={(e) => onChange('s3n_decision_maker', e.target.value)}
              placeholder="Кто принимает решение о покупке..."
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
            />
          </div>

          {/* s3n_purchase_participants */}
          <div className="md:col-span-2">
            <label htmlFor="s3n_purchase_participants" className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
              Участники процесса покупки
            </label>
            <textarea
              id="s3n_purchase_participants"
              rows={2}
              value={str(data.s3n_purchase_participants)}
              onChange={(e) => onChange('s3n_purchase_participants', e.target.value)}
              placeholder="Кто ещё участвует в принятии решения..."
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
            />
          </div>
        </div>
      </section>

      {/* ── Problem & Solution ────────────────────────────────────────────── */}
      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-on-surface mb-4">
          <span className="material-symbols-outlined text-primary text-lg">lightbulb</span>
          Проблема и решение
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* s5_usp (reused) */}
          <div className="md:col-span-2">
            <label htmlFor="s5_usp" className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
              УТП (уникальное торговое предложение)
            </label>
            <textarea
              id="s5_usp"
              rows={3}
              value={str(data.s5_usp)}
              onChange={(e) => onChange('s5_usp', e.target.value)}
              placeholder="В чём уникальность вашего предложения..."
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
            />
          </div>

          {/* s3n_client_problem */}
          <div>
            <label htmlFor="s3n_client_problem" className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
              Проблема клиента
            </label>
            <textarea
              id="s3n_client_problem"
              rows={3}
              value={str(data.s3n_client_problem)}
              onChange={(e) => onChange('s3n_client_problem', e.target.value)}
              placeholder="Какую проблему клиента вы решаете..."
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
            />
          </div>

          {/* s3n_problem_impact */}
          <div>
            <label htmlFor="s3n_problem_impact" className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
              Влияние проблемы
            </label>
            <textarea
              id="s3n_problem_impact"
              rows={3}
              value={str(data.s3n_problem_impact)}
              onChange={(e) => onChange('s3n_problem_impact', e.target.value)}
              placeholder="Как эта проблема влияет на клиента..."
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
            />
          </div>

          {/* s3n_current_solution */}
          <div>
            <label htmlFor="s3n_current_solution" className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
              Текущее решение клиента
            </label>
            <textarea
              id="s3n_current_solution"
              rows={3}
              value={str(data.s3n_current_solution)}
              onChange={(e) => onChange('s3n_current_solution', e.target.value)}
              placeholder="Как клиент решает проблему сейчас..."
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
            />
          </div>

          {/* s3n_if_unsolved */}
          <div>
            <label htmlFor="s3n_if_unsolved" className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
              Если проблему не решать
            </label>
            <textarea
              id="s3n_if_unsolved"
              rows={3}
              value={str(data.s3n_if_unsolved)}
              onChange={(e) => onChange('s3n_if_unsolved', e.target.value)}
              placeholder="Что произойдёт, если клиент не решит проблему..."
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
            />
          </div>
        </div>
      </section>

      {/* ── Results ───────────────────────────────────────────────────────── */}
      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-on-surface mb-4">
          <span className="material-symbols-outlined text-primary text-lg">verified</span>
          Результаты
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* s3n_life_after_solution */}
          <div>
            <label htmlFor="s3n_life_after_solution" className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
              Жизнь после решения
            </label>
            <textarea
              id="s3n_life_after_solution"
              rows={3}
              value={str(data.s3n_life_after_solution)}
              onChange={(e) => onChange('s3n_life_after_solution', e.target.value)}
              placeholder="Как изменится жизнь клиента после решения проблемы..."
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
            />
          </div>

          {/* s3n_measurable_results */}
          <div>
            <label htmlFor="s3n_measurable_results" className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
              Измеримые результаты
            </label>
            <textarea
              id="s3n_measurable_results"
              rows={3}
              value={str(data.s3n_measurable_results)}
              onChange={(e) => onChange('s3n_measurable_results', e.target.value)}
              placeholder="Какие результаты можно измерить..."
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
            />
          </div>

          {/* s3n_short_wins */}
          <div className="md:col-span-2">
            <label htmlFor="s3n_short_wins" className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
              Быстрые победы
            </label>
            <textarea
              id="s3n_short_wins"
              rows={3}
              value={str(data.s3n_short_wins)}
              onChange={(e) => onChange('s3n_short_wins', e.target.value)}
              placeholder="Какие быстрые результаты может получить клиент..."
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
            />
          </div>
        </div>
      </section>

      {/* ── Competitive comparison ────────────────────────────────────────── */}
      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-on-surface mb-4">
          <span className="material-symbols-outlined text-primary text-lg">compare_arrows</span>
          Сравнение с конкурентами
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* s3n_competitor_why_us */}
          <div>
            <label htmlFor="s3n_competitor_why_us" className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
              Почему выбирают нас
            </label>
            <textarea
              id="s3n_competitor_why_us"
              rows={3}
              value={str(data.s3n_competitor_why_us)}
              onChange={(e) => onChange('s3n_competitor_why_us', e.target.value)}
              placeholder="Почему клиенты выбирают вас, а не конкурентов..."
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
            />
          </div>

          {/* s3n_cannot_copy */}
          <div>
            <label htmlFor="s3n_cannot_copy" className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
              Что нельзя скопировать
            </label>
            <textarea
              id="s3n_cannot_copy"
              rows={3}
              value={str(data.s3n_cannot_copy)}
              onChange={(e) => onChange('s3n_cannot_copy', e.target.value)}
              placeholder="Что невозможно скопировать у вашего бизнеса..."
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
            />
          </div>

          {/* s3n_competitors_better */}
          <div>
            <label htmlFor="s3n_competitors_better" className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
              В чём конкуренты лучше
            </label>
            <textarea
              id="s3n_competitors_better"
              rows={3}
              value={str(data.s3n_competitors_better)}
              onChange={(e) => onChange('s3n_competitors_better', e.target.value)}
              placeholder="Где конкуренты объективно сильнее..."
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
            />
          </div>

          {/* s3n_industry_standard */}
          <div>
            <label htmlFor="s3n_industry_standard" className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
              Отраслевой стандарт
            </label>
            <textarea
              id="s3n_industry_standard"
              rows={3}
              value={str(data.s3n_industry_standard)}
              onChange={(e) => onChange('s3n_industry_standard', e.target.value)}
              placeholder="Что является стандартом в отрасли..."
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
            />
          </div>
        </div>
      </section>
    </div>
  )
}
