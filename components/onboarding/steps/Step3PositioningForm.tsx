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
  { value: '', label: '— Select —' },
  { value: 'economy', label: 'Economy' },
  { value: 'medium', label: 'Medium' },
  { value: 'premium', label: 'Premium' },
]

/* ─── Component ────────────────────────────────────────────────────────────── */
export default function Step3PositioningForm({ data, onChange }: Step3PositioningFormProps) {
  return (
    <div className="space-y-8">
      {/* ── Target audience ───────────────────────────────────────────────── */}
      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-on-surface mb-4">
          <span className="material-symbols-outlined text-primary text-lg">groups</span>
          Target Audience
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* s5_target_audience (reused) */}
          <div className="md:col-span-2">
            <label htmlFor="s5_target_audience" className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
              Target Audience
            </label>
            <textarea
              id="s5_target_audience"
              rows={3}
              value={str(data.s5_target_audience)}
              onChange={(e) => onChange('s5_target_audience', e.target.value)}
              placeholder="Describe your target audience..."
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
            />
          </div>

          {/* s3n_client_portrait */}
          <div className="md:col-span-2">
            <label htmlFor="s3n_client_portrait" className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
              Client Portrait
            </label>
            <textarea
              id="s3n_client_portrait"
              rows={3}
              value={str(data.s3n_client_portrait)}
              onChange={(e) => onChange('s3n_client_portrait', e.target.value)}
              placeholder="Detailed portrait of ideal client: demographics, behavior, needs..."
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
            />
          </div>

          {/* s3n_price_segment — select */}
          <div>
            <label htmlFor="s3n_price_segment" className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
              Price Segment
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
              Decision Maker
            </label>
            <textarea
              id="s3n_decision_maker"
              rows={2}
              value={str(data.s3n_decision_maker)}
              onChange={(e) => onChange('s3n_decision_maker', e.target.value)}
              placeholder="Who makes the purchase decision..."
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
            />
          </div>

          {/* s3n_purchase_participants */}
          <div className="md:col-span-2">
            <label htmlFor="s3n_purchase_participants" className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
              Purchase Process Participants
            </label>
            <textarea
              id="s3n_purchase_participants"
              rows={2}
              value={str(data.s3n_purchase_participants)}
              onChange={(e) => onChange('s3n_purchase_participants', e.target.value)}
              placeholder="Who else participates in decision making..."
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
            />
          </div>
        </div>
      </section>

      {/* ── Problem & Solution ────────────────────────────────────────────── */}
      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-on-surface mb-4">
          <span className="material-symbols-outlined text-primary text-lg">lightbulb</span>
          Problem and Solution
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* s5_usp (reused) */}
          <div className="md:col-span-2">
            <label htmlFor="s5_usp" className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
              USP (Unique Selling Proposition)
            </label>
            <textarea
              id="s5_usp"
              rows={3}
              value={str(data.s5_usp)}
              onChange={(e) => onChange('s5_usp', e.target.value)}
              placeholder="What makes your offering unique..."
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
            />
          </div>

          {/* s3n_client_problem */}
          <div>
            <label htmlFor="s3n_client_problem" className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
              Client Problem
            </label>
            <textarea
              id="s3n_client_problem"
              rows={3}
              value={str(data.s3n_client_problem)}
              onChange={(e) => onChange('s3n_client_problem', e.target.value)}
              placeholder="What client problem do you solve..."
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
            />
          </div>

          {/* s3n_problem_impact */}
          <div>
            <label htmlFor="s3n_problem_impact" className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
              Problem Impact
            </label>
            <textarea
              id="s3n_problem_impact"
              rows={3}
              value={str(data.s3n_problem_impact)}
              onChange={(e) => onChange('s3n_problem_impact', e.target.value)}
              placeholder="How does this problem affect the client..."
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
            />
          </div>

          {/* s3n_current_solution */}
          <div>
            <label htmlFor="s3n_current_solution" className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
              Client Current Solution
            </label>
            <textarea
              id="s3n_current_solution"
              rows={3}
              value={str(data.s3n_current_solution)}
              onChange={(e) => onChange('s3n_current_solution', e.target.value)}
              placeholder="How the client solves the problem now..."
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
            />
          </div>

          {/* s3n_if_unsolved */}
          <div>
            <label htmlFor="s3n_if_unsolved" className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
              If the Problem is Not Solved
            </label>
            <textarea
              id="s3n_if_unsolved"
              rows={3}
              value={str(data.s3n_if_unsolved)}
              onChange={(e) => onChange('s3n_if_unsolved', e.target.value)}
              placeholder="What happens if the client does not solve the problem..."
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
            />
          </div>
        </div>
      </section>

      {/* ── Results ───────────────────────────────────────────────────────── */}
      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-on-surface mb-4">
          <span className="material-symbols-outlined text-primary text-lg">verified</span>
          Results
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* s3n_life_after_solution */}
          <div>
            <label htmlFor="s3n_life_after_solution" className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
              Life After Solution
            </label>
            <textarea
              id="s3n_life_after_solution"
              rows={3}
              value={str(data.s3n_life_after_solution)}
              onChange={(e) => onChange('s3n_life_after_solution', e.target.value)}
              placeholder="How the client life changes after solving the problem..."
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
            />
          </div>

          {/* s3n_measurable_results */}
          <div>
            <label htmlFor="s3n_measurable_results" className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
              Measurable Results
            </label>
            <textarea
              id="s3n_measurable_results"
              rows={3}
              value={str(data.s3n_measurable_results)}
              onChange={(e) => onChange('s3n_measurable_results', e.target.value)}
              placeholder="What results can be measured..."
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
            />
          </div>

          {/* s3n_short_wins */}
          <div className="md:col-span-2">
            <label htmlFor="s3n_short_wins" className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
              Quick Wins
            </label>
            <textarea
              id="s3n_short_wins"
              rows={3}
              value={str(data.s3n_short_wins)}
              onChange={(e) => onChange('s3n_short_wins', e.target.value)}
              placeholder="What quick results can the client get..."
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
            />
          </div>
        </div>
      </section>

      {/* ── Competitive comparison ────────────────────────────────────────── */}
      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-on-surface mb-4">
          <span className="material-symbols-outlined text-primary text-lg">compare_arrows</span>
          Competitive Comparison
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* s3n_competitor_why_us */}
          <div>
            <label htmlFor="s3n_competitor_why_us" className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
              Why Clients Choose Us
            </label>
            <textarea
              id="s3n_competitor_why_us"
              rows={3}
              value={str(data.s3n_competitor_why_us)}
              onChange={(e) => onChange('s3n_competitor_why_us', e.target.value)}
              placeholder="Why clients choose you over competitors..."
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
            />
          </div>

          {/* s3n_cannot_copy */}
          <div>
            <label htmlFor="s3n_cannot_copy" className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
              What Cannot Be Copied
            </label>
            <textarea
              id="s3n_cannot_copy"
              rows={3}
              value={str(data.s3n_cannot_copy)}
              onChange={(e) => onChange('s3n_cannot_copy', e.target.value)}
              placeholder="What is impossible to copy from your business..."
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
            />
          </div>

          {/* s3n_competitors_better */}
          <div>
            <label htmlFor="s3n_competitors_better" className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
              Where Competitors Are Better
            </label>
            <textarea
              id="s3n_competitors_better"
              rows={3}
              value={str(data.s3n_competitors_better)}
              onChange={(e) => onChange('s3n_competitors_better', e.target.value)}
              placeholder="Where competitors are objectively stronger..."
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
            />
          </div>

          {/* s3n_industry_standard */}
          <div>
            <label htmlFor="s3n_industry_standard" className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
              Industry Standard
            </label>
            <textarea
              id="s3n_industry_standard"
              rows={3}
              value={str(data.s3n_industry_standard)}
              onChange={(e) => onChange('s3n_industry_standard', e.target.value)}
              placeholder="What is the industry standard..."
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
            />
          </div>
        </div>
      </section>
    </div>
  )
}
