'use client'

import React from 'react'
import { FieldLabel, DynamicTable, MultiSelect } from '@/components/onboarding/shared'
import { MARKETING_CHANNELS } from '@/components/onboarding/constants/options'

/* ─── Types ────────────────────────────────────────────────────────────────── */
interface Step7MarketingFormProps {
  data: Record<string, unknown>
  onChange: (key: string, value: unknown) => void
  userId?: string
}

/* ─── Helpers ──────────────────────────────────────────────────────────────── */
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number => (typeof v === 'number' ? v : 0)
const arr = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : [])
const rows = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v)
    ? (v as Record<string, unknown>[])
    : [{ channel: '', budget_monthly: 0, effectiveness_pct: 0, sales_monthly: 0, roi: 0 }]
const bool = (v: unknown): boolean => (typeof v === 'boolean' ? v : false)

/* ─── Table columns ───────────────────────────────────────────────────────── */
const CHANNELS_TABLE_COLUMNS = [
  { key: 'channel', label: 'Канал', type: 'text' as const },
  { key: 'budget_monthly', label: 'Бюджет/мес', type: 'number' as const },
  { key: 'effectiveness_pct', label: 'Эффективность %', type: 'number' as const },
  { key: 'sales_monthly', label: 'Продаж/мес', type: 'number' as const },
  { key: 'roi', label: 'ROI', type: 'number' as const },
]

/* ─── Competitor block ────────────────────────────────────────────────────── */
function CompetitorBlock({
  index,
  nameKey,
  analysisKey,
  data,
  onChange,
}: {
  index: number
  nameKey: string
  analysisKey: string
  data: Record<string, unknown>
  onChange: (key: string, value: unknown) => void
}) {
  return (
    <div className="p-4 rounded-xl border border-white/[0.08] bg-surface-container space-y-3">
      <div>
        <FieldLabel htmlFor={nameKey}>Конкурент {index}</FieldLabel>
        <input
          id={nameKey}
          type="text"
          value={str(data[nameKey])}
          onChange={(e) => onChange(nameKey, e.target.value)}
          placeholder={`Название конкурента ${index}`}
          className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
        />
      </div>
      <div>
        <FieldLabel htmlFor={analysisKey}>Детальный анализ</FieldLabel>
        <textarea
          id={analysisKey}
          rows={5}
          value={str(data[analysisKey])}
          onChange={(e) => onChange(analysisKey, e.target.value)}
          placeholder="Материалы, ценовой диапазон, ассортимент, позиционирование, УТП, ЦА, география, каналы, контент, SEO, реклама..."
          className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
        />
      </div>
    </div>
  )
}

/* ─── Component ────────────────────────────────────────────────────────────── */
export default function Step7MarketingForm({ data, onChange }: Step7MarketingFormProps) {
  return (
    <div className="space-y-8">
      {/* ── Маркетинговые каналы ──────────────────────────────────────────── */}
      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-on-surface mb-4">
          <span className="material-symbols-outlined text-primary text-lg">campaign</span>
          Маркетинговые каналы
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div className="md:col-span-2">
            <MultiSelect
              label="Используемые каналы"
              options={[...MARKETING_CHANNELS]}
              selected={arr(data.s5_marketing_channels)}
              onChange={(v) => onChange('s5_marketing_channels', v)}
            />
          </div>
          <div>
            <FieldLabel htmlFor="s5_marketing_budget_pct">Бюджет на маркетинг (% от выручки)</FieldLabel>
            <div className="relative">
              <input id="s5_marketing_budget_pct" type="number" min={0} max={100} value={num(data.s5_marketing_budget_pct) || ''} onChange={(e) => onChange('s5_marketing_budget_pct', Number(e.target.value) || 0)} placeholder="10" className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 pr-10 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all" />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-on-surface-variant">%</span>
            </div>
          </div>
          <div className="flex items-end">
            <div className="flex items-center justify-between bg-surface-container rounded-xl border border-white/[0.08] px-4 py-3 w-full">
              <span className="text-sm text-on-surface">Есть конкурентный анализ</span>
              <button type="button" onClick={() => onChange('s5_has_competitor_analysis', !bool(data.s5_has_competitor_analysis))} className={`w-12 h-6 rounded-full transition-all flex items-center px-1 ${bool(data.s5_has_competitor_analysis) ? 'bg-primary' : 'bg-surface-container-high'}`}>
                <span className={`w-4 h-4 rounded-full bg-white transition-all ${bool(data.s5_has_competitor_analysis) ? 'translate-x-6' : 'translate-x-0'}`} />
              </button>
            </div>
          </div>
        </div>

        {/* Channels performance table */}
        <FieldLabel>Эффективность каналов</FieldLabel>
        <DynamicTable
          columns={CHANNELS_TABLE_COLUMNS}
          rows={rows(data.s7n_channels_table)}
          onChange={(r) => onChange('s7n_channels_table', r)}
        />
      </section>

      {/* ── Контент-стратегия ──────────────────────────────────────────────── */}
      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-on-surface mb-4">
          <span className="material-symbols-outlined text-primary text-lg">edit_note</span>
          Контент-стратегия
        </h3>
        <div>
          <FieldLabel htmlFor="s7n_content_strategy">Описание контент-стратегии</FieldLabel>
          <textarea id="s7n_content_strategy" rows={4} value={str(data.s7n_content_strategy)} onChange={(e) => onChange('s7n_content_strategy', e.target.value)} placeholder="Какой контент создаёте, частота, форматы, платформы..." className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none" />
        </div>
      </section>

      {/* ── Глубокий анализ конкурентов ────────────────────────────────────── */}
      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-on-surface mb-4">
          <span className="material-symbols-outlined text-primary text-lg">compare_arrows</span>
          Глубокий анализ конкурентов
        </h3>
        <div className="grid grid-cols-1 gap-4">
          <CompetitorBlock index={1} nameKey="s5_competitor_1" analysisKey="s7n_competitor_1_analysis" data={data} onChange={onChange} />
          <CompetitorBlock index={2} nameKey="s5_competitor_2" analysisKey="s7n_competitor_2_analysis" data={data} onChange={onChange} />
          <CompetitorBlock index={3} nameKey="s5_competitor_3" analysisKey="s7n_competitor_3_analysis" data={data} onChange={onChange} />
        </div>
      </section>
    </div>
  )
}
