'use client'

import React from 'react'

/* ─── Types ────────────────────────────────────────────────────────────────── */
interface Step2GoalsFormProps {
  data: Record<string, unknown>
  onChange: (key: string, value: unknown) => void
}

/* ─── Helpers ──────────────────────────────────────────────────────────────── */
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const arr = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : [])

/* ─── Constants ────────────────────────────────────────────────────────────── */
const GROWTH_BLOCKERS = [
  'Деньги / Финансирование',
  'Команда / Кадры',
  'Процессы / Операции',
  'Технологии / IT',
  'Рынок / Конкуренция',
  'Маркетинг / Продажи',
  'Другое',
]

/* ─── Component ────────────────────────────────────────────────────────────── */
export default function Step2GoalsForm({ data, onChange }: Step2GoalsFormProps) {
  const toggleBlocker = (opt: string) => {
    const current = arr(data.s6_growth_blockers)
    onChange(
      's6_growth_blockers',
      current.includes(opt)
        ? current.filter((v) => v !== opt)
        : [...current, opt],
    )
  }

  return (
    <div className="space-y-8">
      {/* ── Short-term goals ──────────────────────────────────────────────── */}
      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-on-surface mb-4">
          <span className="material-symbols-outlined text-primary text-lg">flag</span>
          Цели на 12 месяцев
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* goal_12m_what */}
          <div>
            <label htmlFor="s2n_goal_12m_what" className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
              Что хотите достичь
            </label>
            <textarea
              id="s2n_goal_12m_what"
              rows={3}
              value={str(data.s2n_goal_12m_what)}
              onChange={(e) => onChange('s2n_goal_12m_what', e.target.value)}
              placeholder="Опишите цель на ближайшие 12 месяцев..."
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
            />
          </div>

          {/* goal_12m_metrics */}
          <div>
            <label htmlFor="s2n_goal_12m_metrics" className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
              Метрики достижения
            </label>
            <textarea
              id="s2n_goal_12m_metrics"
              rows={3}
              value={str(data.s2n_goal_12m_metrics)}
              onChange={(e) => onChange('s2n_goal_12m_metrics', e.target.value)}
              placeholder="По каким метрикам будете оценивать результат..."
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
            />
          </div>
        </div>
      </section>

      {/* ── Long-term goals ───────────────────────────────────────────────── */}
      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-on-surface mb-4">
          <span className="material-symbols-outlined text-primary text-lg">rocket_launch</span>
          Цели на 3 года
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* goal_3y_what */}
          <div>
            <label htmlFor="s2n_goal_3y_what" className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
              Что хотите достичь за 3 года
            </label>
            <textarea
              id="s2n_goal_3y_what"
              rows={3}
              value={str(data.s2n_goal_3y_what)}
              onChange={(e) => onChange('s2n_goal_3y_what', e.target.value)}
              placeholder="Опишите стратегическую цель на 3 года..."
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
            />
          </div>

          {/* goal_3y_metrics */}
          <div>
            <label htmlFor="s2n_goal_3y_metrics" className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
              Метрики на 3 года
            </label>
            <textarea
              id="s2n_goal_3y_metrics"
              rows={3}
              value={str(data.s2n_goal_3y_metrics)}
              onChange={(e) => onChange('s2n_goal_3y_metrics', e.target.value)}
              placeholder="Измеримые показатели на 3 года..."
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
            />
          </div>
        </div>
      </section>

      {/* ── Growth efforts ────────────────────────────────────────────────── */}
      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-on-surface mb-4">
          <span className="material-symbols-outlined text-primary text-lg">trending_up</span>
          Рост
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* tried_for_growth */}
          <div>
            <label htmlFor="s2n_tried_for_growth" className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
              Что уже пробовали для роста
            </label>
            <textarea
              id="s2n_tried_for_growth"
              rows={3}
              value={str(data.s2n_tried_for_growth)}
              onChange={(e) => onChange('s2n_tried_for_growth', e.target.value)}
              placeholder="Какие инструменты / подходы пробовали..."
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
            />
          </div>

          {/* what_blocks_growth */}
          <div>
            <label htmlFor="s2n_what_blocks_growth" className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
              Что мешает расти
            </label>
            <textarea
              id="s2n_what_blocks_growth"
              rows={3}
              value={str(data.s2n_what_blocks_growth)}
              onChange={(e) => onChange('s2n_what_blocks_growth', e.target.value)}
              placeholder="Основные препятствия для роста..."
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
            />
          </div>
        </div>
      </section>

      {/* ── Pain points (reused s6_ fields) ───────────────────────────────── */}
      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-on-surface mb-4">
          <span className="material-symbols-outlined text-primary text-lg">priority_high</span>
          Боли и барьеры
        </h3>
        <div className="grid grid-cols-1 gap-4">
          {/* s6_main_pain */}
          <div>
            <label htmlFor="s6_main_pain" className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
              Главная боль бизнеса
            </label>
            <textarea
              id="s6_main_pain"
              rows={3}
              value={str(data.s6_main_pain)}
              onChange={(e) => onChange('s6_main_pain', e.target.value)}
              placeholder="Что больше всего болит в бизнесе прямо сейчас..."
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
            />
          </div>

          {/* s6_growth_blockers — multi-select */}
          <div>
            <label className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
              Барьеры роста
            </label>
            <div className="flex flex-wrap gap-2">
              {GROWTH_BLOCKERS.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => toggleBlocker(opt)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                    arr(data.s6_growth_blockers).includes(opt)
                      ? 'bg-primary/20 border-primary/50 text-primary'
                      : 'bg-surface-container border-white/[0.08] text-on-surface-variant hover:border-white/20'
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>

          {/* s6_expectations */}
          <div>
            <label htmlFor="s6_expectations" className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
              Ожидания от платформы
            </label>
            <textarea
              id="s6_expectations"
              rows={3}
              value={str(data.s6_expectations)}
              onChange={(e) => onChange('s6_expectations', e.target.value)}
              placeholder="Что ожидаете от AIStart360..."
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
            />
          </div>
        </div>
      </section>
    </div>
  )
}
