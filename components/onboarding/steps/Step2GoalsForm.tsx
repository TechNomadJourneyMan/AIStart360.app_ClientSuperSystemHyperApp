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
  'Money / Funding',
  'Team / HR',
  'Processes / Operations',
  'Technology / IT',
  'Market / Competition',
  'Marketing / Sales',
  'Other',
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
          Goals for 12 Months
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* goal_12m_what */}
          <div>
            <label htmlFor="s2n_goal_12m_what" className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
              What you want to achieve
            </label>
            <textarea
              id="s2n_goal_12m_what"
              rows={3}
              value={str(data.s2n_goal_12m_what)}
              onChange={(e) => onChange('s2n_goal_12m_what', e.target.value)}
              placeholder="Describe your goal for the next 12 months..."
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
            />
          </div>

          {/* goal_12m_metrics */}
          <div>
            <label htmlFor="s2n_goal_12m_metrics" className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
              Achievement Metrics
            </label>
            <textarea
              id="s2n_goal_12m_metrics"
              rows={3}
              value={str(data.s2n_goal_12m_metrics)}
              onChange={(e) => onChange('s2n_goal_12m_metrics', e.target.value)}
              placeholder="What metrics will you use to measure results..."
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
            />
          </div>
        </div>
      </section>

      {/* ── Long-term goals ───────────────────────────────────────────────── */}
      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-on-surface mb-4">
          <span className="material-symbols-outlined text-primary text-lg">rocket_launch</span>
          Goals for 3 Years
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* goal_3y_what */}
          <div>
            <label htmlFor="s2n_goal_3y_what" className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
              What you want to achieve in 3 years
            </label>
            <textarea
              id="s2n_goal_3y_what"
              rows={3}
              value={str(data.s2n_goal_3y_what)}
              onChange={(e) => onChange('s2n_goal_3y_what', e.target.value)}
              placeholder="Describe your strategic goal for 3 years..."
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
            />
          </div>

          {/* goal_3y_metrics */}
          <div>
            <label htmlFor="s2n_goal_3y_metrics" className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
              Metrics for 3 Years
            </label>
            <textarea
              id="s2n_goal_3y_metrics"
              rows={3}
              value={str(data.s2n_goal_3y_metrics)}
              onChange={(e) => onChange('s2n_goal_3y_metrics', e.target.value)}
              placeholder="Measurable indicators for 3 years..."
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
            />
          </div>
        </div>
      </section>

      {/* ── Growth efforts ────────────────────────────────────────────────── */}
      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-on-surface mb-4">
          <span className="material-symbols-outlined text-primary text-lg">trending_up</span>
          Growth
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* tried_for_growth */}
          <div>
            <label htmlFor="s2n_tried_for_growth" className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
              What you have tried for growth
            </label>
            <textarea
              id="s2n_tried_for_growth"
              rows={3}
              value={str(data.s2n_tried_for_growth)}
              onChange={(e) => onChange('s2n_tried_for_growth', e.target.value)}
              placeholder="What tools / approaches have you tried..."
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
            />
          </div>

          {/* what_blocks_growth */}
          <div>
            <label htmlFor="s2n_what_blocks_growth" className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
              What blocks growth
            </label>
            <textarea
              id="s2n_what_blocks_growth"
              rows={3}
              value={str(data.s2n_what_blocks_growth)}
              onChange={(e) => onChange('s2n_what_blocks_growth', e.target.value)}
              placeholder="Main obstacles to growth..."
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
            />
          </div>
        </div>
      </section>

      {/* ── Pain points (reused s6_ fields) ───────────────────────────────── */}
      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-on-surface mb-4">
          <span className="material-symbols-outlined text-primary text-lg">priority_high</span>
          Pain Points and Barriers
        </h3>
        <div className="grid grid-cols-1 gap-4">
          {/* s6_main_pain */}
          <div>
            <label htmlFor="s6_main_pain" className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
              Main business pain point
            </label>
            <textarea
              id="s6_main_pain"
              rows={3}
              value={str(data.s6_main_pain)}
              onChange={(e) => onChange('s6_main_pain', e.target.value)}
              placeholder="What hurts the most in your business right now..."
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
            />
          </div>

          {/* s6_growth_blockers — multi-select */}
          <div>
            <label className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
              Growth Barriers
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
              Platform Expectations
            </label>
            <textarea
              id="s6_expectations"
              rows={3}
              value={str(data.s6_expectations)}
              onChange={(e) => onChange('s6_expectations', e.target.value)}
              placeholder="What do you expect from AIStart360..."
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
            />
          </div>
        </div>
      </section>
    </div>
  )
}
