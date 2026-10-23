'use client'

import React from 'react'
import { BoolToggle, FieldLabel, DynamicTable, MultiSelect, NumberField, TermHint } from '@/components/onboarding/shared'
import { MARKETING_CHANNELS } from '@/components/onboarding/constants/options'
import { FieldCalc } from '@/components/survey/FieldCalc'

/* ─── Types ────────────────────────────────────────────────────────────────── */
interface Step7MarketingFormProps {
  data: Record<string, unknown>
  onChange: (key: string, value: unknown) => void
  userId?: string
}

/* ─── Helpers ──────────────────────────────────────────────────────────────── */
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const arr = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : [])
const rows = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v)
    ? (v as Record<string, unknown>[])
    : [{ channel: '', budget_monthly: null, effectiveness_pct: null, sales_monthly: null, roi: null }]
const bool = (v: unknown): boolean => (typeof v === 'boolean' ? v : false)

/* ─── Table columns ───────────────────────────────────────────────────────── */
const CHANNELS_TABLE_COLUMNS = [
  { key: 'channel', label: 'Канал', type: 'text' as const },
  { key: 'budget_monthly', label: 'Бюджет/мес', type: 'number' as const },
  { key: 'effectiveness_pct', label: 'Эффективность %', type: 'number' as const },
  { key: 'sales_monthly', label: 'Продаж/мес', type: 'number' as const },
  { key: 'roi', label: 'Окупаемость, раз (ROI)', type: 'number' as const },
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
          <NumberField id="s5_marketing_budget_pct" label="Бюджет на маркетинг (% от выручки)" value={data.s5_marketing_budget_pct} onChange={(v) => onChange('s5_marketing_budget_pct', v)} unit="%" max={100} placeholder="10" />
          <div className="flex items-end">
            <div className="w-full">
              <BoolToggle label="Есть конкурентный анализ" value={bool(data.s5_has_competitor_analysis)} onChange={(v) => onChange('s5_has_competitor_analysis', v)} />
            </div>
          </div>
        </div>
        <FieldCalc forKey="s5_marketing_budget_pct" answers={data} className="mb-4" />

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

      {/* ── Воронка и AI-коммуникации (loss-map signals) ───────────────────── */}
      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-on-surface mb-4">
          <span className="material-symbols-outlined text-primary text-lg">filter_alt</span>
          Воронка и AI-коммуникации
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <NumberField id="s7_leads_per_month" label="Лидов в месяц (входящие)" value={data.s7_leads_per_month} onChange={(v) => onChange('s7_leads_per_month', v)} unit="в мес" integer placeholder="200" />
          <NumberField id="s7_no_show_rate" label={<>Сколько клиентов записались и не пришли<TermHint term="no-show" /></>} value={data.s7_no_show_rate} onChange={(v) => onChange('s7_no_show_rate', v)} unit="%" max={100} />
          <NumberField id="s7_missed_calls_rate" label="Пропущенных звонков" value={data.s7_missed_calls_rate} onChange={(v) => onChange('s7_missed_calls_rate', v)} unit="%" max={100} />
          <NumberField id="s7_avg_check_target_kzt" label="Целевой средний чек" value={data.s7_avg_check_target_kzt} onChange={(v) => onChange('s7_avg_check_target_kzt', v)} unit="₸" integer allowApprox placeholder="100 000" />
          <NumberField id="s7_repeat_freq_days" label="Частота повторной покупки" value={data.s7_repeat_freq_days} onChange={(v) => onChange('s7_repeat_freq_days', v)} unit="дней" integer placeholder="90" />
          <NumberField id="s7_nps_score" label={<>Как клиенты оценивают вас по 10-балльной шкале?<TermHint term="NPS" /></>} note="Индекс от −100 до 100. Если не измеряли — «Не знаю»." value={data.s7_nps_score} onChange={(v) => onChange('s7_nps_score', v)} integer allowNegative max={100} placeholder="35" />
        </div>
        <FieldCalc ids={['funnel', 'leads_to_goal', 'repeat_rate']} forKey="s7_leads_per_month" answers={data} />
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
