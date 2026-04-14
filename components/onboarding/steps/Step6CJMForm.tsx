'use client'

import React from 'react'
import { FieldLabel, DynamicTable, FileUploadField } from '@/components/onboarding/shared'

/* ─── Types ────────────────────────────────────────────────────────────────── */
interface Step6CJMFormProps {
  data: Record<string, unknown>
  onChange: (key: string, value: unknown) => void
  userId?: string
}

/* ─── Helpers ──────────────────────────────────────────────────────────────── */
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const rows = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v)
    ? (v as Record<string, unknown>[])
    : [{ stage_name: '', goal: '', actions: '', barriers: '', materials: '' }]

/* ─── Table columns ───────────────────────────────────────────────────────── */
const CJM_COLUMNS = [
  { key: 'stage_name', label: 'Stage', type: 'text' as const },
  { key: 'goal', label: 'Stage Goal', type: 'text' as const },
  { key: 'actions', label: 'Client Actions', type: 'text' as const },
  { key: 'barriers', label: 'Barriers', type: 'text' as const },
  { key: 'materials', label: 'Materials', type: 'text' as const },
]

/* ─── Component ────────────────────────────────────────────────────────────── */
export default function Step6CJMForm({ data, onChange, userId }: Step6CJMFormProps) {
  return (
    <div className="space-y-8">
      {/* ── Карта пути клиента ─────────────────────────────────────────────── */}
      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-on-surface mb-4">
          <span className="material-symbols-outlined text-primary text-lg">route</span>
          Customer Journey Map (CJM)
        </h3>
        <DynamicTable
          columns={CJM_COLUMNS}
          rows={rows(data.s6n_journey_table)}
          onChange={(r) => onChange('s6n_journey_table', r)}
        />
      </section>

      {/* ── Funnel Analysis ─────────────────────────────────────────────────── */}
      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-on-surface mb-4">
          <span className="material-symbols-outlined text-primary text-lg">troubleshoot</span>
          Funnel Analysis
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <FieldLabel htmlFor="s6n_weak_funnel_points">At which stages do we lose the most clients</FieldLabel>
            <textarea
              id="s6n_weak_funnel_points"
              rows={3}
              value={str(data.s6n_weak_funnel_points)}
              onChange={(e) => onChange('s6n_weak_funnel_points', e.target.value)}
              placeholder="Describe the weak points of the funnel..."
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
            />
          </div>
          <div className="md:col-span-2">
            <FieldLabel htmlFor="s6n_post_sale_touchpoints">Post-Sale Touchpoints</FieldLabel>
            <textarea
              id="s6n_post_sale_touchpoints"
              rows={3}
              value={str(data.s6n_post_sale_touchpoints)}
              onChange={(e) => onChange('s6n_post_sale_touchpoints', e.target.value)}
              placeholder="How do you maintain contact after the sale..."
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
            />
          </div>
        </div>
      </section>

      {/* ── Scripts ───────────────────────────────────────────────────────── */}
      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-on-surface mb-4">
          <span className="material-symbols-outlined text-primary text-lg">description</span>
          Scripts
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FileUploadField
            label="First Contact Script"
            fieldKey="s6n_script_first_contact"
            userId={userId ?? ''}
            value={str(data.s6n_script_first_contact) || undefined}
            onChange={(url) => onChange('s6n_script_first_contact', url)}
          />
          <FileUploadField
            label="Meeting Script"
            fieldKey="s6n_script_meeting"
            userId={userId ?? ''}
            value={str(data.s6n_script_meeting) || undefined}
            onChange={(url) => onChange('s6n_script_meeting', url)}
          />
          <FileUploadField
            label="Commercial Proposal Script"
            fieldKey="s6n_script_proposal"
            userId={userId ?? ''}
            value={str(data.s6n_script_proposal) || undefined}
            onChange={(url) => onChange('s6n_script_proposal', url)}
          />
        </div>
      </section>
    </div>
  )
}
