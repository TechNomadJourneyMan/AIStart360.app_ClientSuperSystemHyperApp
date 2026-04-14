'use client'

import React from 'react'

/* ─── Types ────────────────────────────────────────────────────────────────── */
interface Step10PersonalFormProps {
  data: Record<string, unknown>
  onChange: (key: string, value: unknown) => void
}

/* ─── Helpers ──────────────────────────────────────────────────────────────── */
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number => (typeof v === 'number' ? v : 0)

/* ─── Component ────────────────────────────────────────────────────────────── */
export default function Step10PersonalForm({ data, onChange }: Step10PersonalFormProps) {
  return (
    <div className="space-y-8">
      {/* ── Motivation ─────────────────────────────────────────────────────── */}
      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-on-surface mb-4">
          <span className="material-symbols-outlined text-primary text-lg">psychology</span>
          Мотивация
        </h3>
        <div className="grid grid-cols-1 gap-4">
          {/* why_opened */}
          <div>
            <label htmlFor="s10_why_opened" className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
              Почему открыли бизнес
            </label>
            <textarea
              id="s10_why_opened"
              rows={3}
              value={str(data.s10_why_opened)}
              onChange={(e) => onChange('s10_why_opened', e.target.value)}
              placeholder="Что стало причиной создания бизнеса..."
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
            />
          </div>
        </div>
      </section>

      {/* ── Best results ───────────────────────────────────────────────────── */}
      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-on-surface mb-4">
          <span className="material-symbols-outlined text-primary text-lg">emoji_events</span>
          Лучшие результаты
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* best_result_2y */}
          <div>
            <label htmlFor="s10_best_result_2y" className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
              Лучший результат за 2 года
            </label>
            <textarea
              id="s10_best_result_2y"
              rows={3}
              value={str(data.s10_best_result_2y)}
              onChange={(e) => onChange('s10_best_result_2y', e.target.value)}
              placeholder="Самый значимый результат за 2 года..."
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
            />
          </div>

          {/* best_result_5y */}
          <div>
            <label htmlFor="s10_best_result_5y" className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
              Лучший результат за 5 лет
            </label>
            <textarea
              id="s10_best_result_5y"
              rows={3}
              value={str(data.s10_best_result_5y)}
              onChange={(e) => onChange('s10_best_result_5y', e.target.value)}
              placeholder="Самый значимый результат за 5 лет..."
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
            />
          </div>

          {/* best_result_10y */}
          <div className="md:col-span-2">
            <label htmlFor="s10_best_result_10y" className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
              Лучший результат за 10 лет
            </label>
            <textarea
              id="s10_best_result_10y"
              rows={3}
              value={str(data.s10_best_result_10y)}
              onChange={(e) => onChange('s10_best_result_10y', e.target.value)}
              placeholder="Самый значимый результат за 10 лет..."
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
            />
          </div>
        </div>
      </section>

      {/* ── Vision ─────────────────────────────────────────────────────────── */}
      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-on-surface mb-4">
          <span className="material-symbols-outlined text-primary text-lg">visibility</span>
          Видение компании
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* company_vision_2y */}
          <div>
            <label htmlFor="s10_company_vision_2y" className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
              Видение на 2 года
            </label>
            <textarea
              id="s10_company_vision_2y"
              rows={3}
              value={str(data.s10_company_vision_2y)}
              onChange={(e) => onChange('s10_company_vision_2y', e.target.value)}
              placeholder="Какой вы видите компанию через 2 года..."
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
            />
          </div>

          {/* company_vision_5y */}
          <div>
            <label htmlFor="s10_company_vision_5y" className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
              Видение на 5 лет
            </label>
            <textarea
              id="s10_company_vision_5y"
              rows={3}
              value={str(data.s10_company_vision_5y)}
              onChange={(e) => onChange('s10_company_vision_5y', e.target.value)}
              placeholder="Какой вы видите компанию через 5 лет..."
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
            />
          </div>

          {/* company_vision_10y */}
          <div className="md:col-span-2">
            <label htmlFor="s10_company_vision_10y" className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
              Видение на 10 лет
            </label>
            <textarea
              id="s10_company_vision_10y"
              rows={3}
              value={str(data.s10_company_vision_10y)}
              onChange={(e) => onChange('s10_company_vision_10y', e.target.value)}
              placeholder="Какой вы видите компанию через 10 лет..."
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
            />
          </div>
        </div>
      </section>

      {/* ── Problems & Assessment ──────────────────────────────────────────── */}
      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-on-surface mb-4">
          <span className="material-symbols-outlined text-primary text-lg">report_problem</span>
          Проблемы и оценка
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* problems_faced */}
          <div>
            <label htmlFor="s10_problems_faced" className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
              С какими проблемами столкнулись
            </label>
            <textarea
              id="s10_problems_faced"
              rows={3}
              value={str(data.s10_problems_faced)}
              onChange={(e) => onChange('s10_problems_faced', e.target.value)}
              placeholder="Опишите ключевые проблемы..."
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
            />
          </div>

          {/* who_to_blame */}
          <div>
            <label htmlFor="s10_who_to_blame" className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
              Кто виноват
            </label>
            <textarea
              id="s10_who_to_blame"
              rows={3}
              value={str(data.s10_who_to_blame)}
              onChange={(e) => onChange('s10_who_to_blame', e.target.value)}
              placeholder="Кто, по вашему мнению, ответственен за проблемы..."
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
            />
          </div>

          {/* dept_assessment */}
          <div>
            <label htmlFor="s10_dept_assessment" className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
              Оценка отделов
            </label>
            <textarea
              id="s10_dept_assessment"
              rows={3}
              value={str(data.s10_dept_assessment)}
              onChange={(e) => onChange('s10_dept_assessment', e.target.value)}
              placeholder="Как оцениваете работу отделов..."
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
            />
          </div>

          {/* what_depts_lack */}
          <div>
            <label htmlFor="s10_what_depts_lack" className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
              Чего не хватает отделам
            </label>
            <textarea
              id="s10_what_depts_lack"
              rows={3}
              value={str(data.s10_what_depts_lack)}
              onChange={(e) => onChange('s10_what_depts_lack', e.target.value)}
              placeholder="Каких ресурсов или навыков не хватает..."
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
            />
          </div>
        </div>
      </section>

      {/* ── Market perception ──────────────────────────────────────────────── */}
      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-on-surface mb-4">
          <span className="material-symbols-outlined text-primary text-lg">diversity_3</span>
          Рыночное восприятие
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* competitor_comparison */}
          <div>
            <label htmlFor="s10_competitor_comparison" className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
              Сравнение с конкурентами
            </label>
            <textarea
              id="s10_competitor_comparison"
              rows={3}
              value={str(data.s10_competitor_comparison)}
              onChange={(e) => onChange('s10_competitor_comparison', e.target.value)}
              placeholder="Как вы оцениваете себя на фоне конкурентов..."
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
            />
          </div>

          {/* brand_perception */}
          <div>
            <label htmlFor="s10_brand_perception" className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
              Как воспринимают бренд
            </label>
            <textarea
              id="s10_brand_perception"
              rows={3}
              value={str(data.s10_brand_perception)}
              onChange={(e) => onChange('s10_brand_perception', e.target.value)}
              placeholder="Как клиенты и рынок воспринимают ваш бренд..."
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
            />
          </div>

          {/* when_they_buy */}
          <div className="md:col-span-2">
            <label htmlFor="s10_when_they_buy" className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
              Когда у вас покупают
            </label>
            <textarea
              id="s10_when_they_buy"
              rows={3}
              value={str(data.s10_when_they_buy)}
              onChange={(e) => onChange('s10_when_they_buy', e.target.value)}
              placeholder="В каких ситуациях клиенты принимают решение о покупке..."
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
            />
          </div>
        </div>
      </section>

      {/* ── Delegation ─────────────────────────────────────────────────────── */}
      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-on-surface mb-4">
          <span className="material-symbols-outlined text-primary text-lg">supervisor_account</span>
          Делегирование
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* hours_on_ops — number */}
          <div>
            <label htmlFor="s10_hours_on_ops" className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
              Часов в день на операционку
            </label>
            <input
              id="s10_hours_on_ops"
              type="number"
              min={0}
              max={24}
              value={num(data.s10_hours_on_ops)}
              onChange={(e) => onChange('s10_hours_on_ops', Number(e.target.value) || 0)}
              placeholder="0"
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
            />
          </div>

          {/* delegation_ready — 1-10 slider/number */}
          <div>
            <label htmlFor="s10_delegation_ready" className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
              Готовность делегировать (1-10)
            </label>
            <div className="flex items-center gap-3">
              <input
                id="s10_delegation_ready"
                type="range"
                min={1}
                max={10}
                step={1}
                value={num(data.s10_delegation_ready) || 5}
                onChange={(e) => onChange('s10_delegation_ready', Number(e.target.value))}
                className="flex-1 accent-primary"
              />
              <span className="text-sm font-medium text-on-surface w-8 text-center tabular-nums">
                {num(data.s10_delegation_ready) || 5}
              </span>
            </div>
          </div>

          {/* what_stops_delegating */}
          <div className="md:col-span-2">
            <label htmlFor="s10_what_stops_delegating" className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
              Что мешает делегировать
            </label>
            <textarea
              id="s10_what_stops_delegating"
              rows={3}
              value={str(data.s10_what_stops_delegating)}
              onChange={(e) => onChange('s10_what_stops_delegating', e.target.value)}
              placeholder="Что мешает вам передавать задачи команде..."
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
            />
          </div>
        </div>
      </section>
    </div>
  )
}
