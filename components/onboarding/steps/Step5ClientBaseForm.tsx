'use client'

import React from 'react'
import { FieldLabel } from '@/components/onboarding/shared'

/* ─── Types ────────────────────────────────────────────────────────────────── */
interface Step5ClientBaseFormProps {
  data: Record<string, unknown>
  onChange: (key: string, value: unknown) => void
  userId?: string
}

/* ─── Helpers ──────────────────────────────────────────────────────────────── */
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number => (typeof v === 'number' ? v : 0)

/* ─── Funnel fields ───────────────────────────────────────────────────────── */
const FUNNEL_FIELDS = [
  { key: 's5n_funnel_lead_to_call', label: 'Лид -> Звонок (%)' },
  { key: 's5n_funnel_call_to_meeting', label: 'Звонок -> Встреча (%)' },
  { key: 's5n_funnel_meeting_to_proposal', label: 'Встреча -> КП (%)' },
  { key: 's5n_funnel_proposal_to_negotiation', label: 'КП -> Переговоры (%)' },
  { key: 's5n_funnel_negotiation_to_contract', label: 'Переговоры -> Договор (%)' },
  { key: 's5n_funnel_contract_to_payment', label: 'Договор -> Оплата (%)' },
  { key: 's5n_funnel_payment_to_delivery', label: 'Оплата -> Поставка (%)' },
  { key: 's5n_funnel_lead_to_sale', label: 'Лид -> Продажа общ. (%)' },
] as const

/* ─── Component ────────────────────────────────────────────────────────────── */
export default function Step5ClientBaseForm({ data, onChange }: Step5ClientBaseFormProps) {
  return (
    <div className="space-y-8">
      {/* ── Данные CRM ────────────────────────────────────────────────────── */}
      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-on-surface mb-4">
          <span className="material-symbols-outlined text-primary text-lg">database</span>
          Данные CRM
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <FieldLabel htmlFor="s3_has_crm">Наличие CRM</FieldLabel>
            <input id="s3_has_crm" type="text" value={str(data.s3_has_crm)} onChange={(e) => onChange('s3_has_crm', e.target.value)} placeholder="amoCRM, Bitrix24..." className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all" />
          </div>
          <div>
            <FieldLabel htmlFor="s3_deal_cycle_days">Цикл сделки (дней)</FieldLabel>
            <input id="s3_deal_cycle_days" type="number" min={0} value={num(data.s3_deal_cycle_days) || ''} onChange={(e) => onChange('s3_deal_cycle_days', Number(e.target.value) || 0)} placeholder="30" className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all" />
          </div>
          <div>
            <FieldLabel htmlFor="s3_deals_2023">Сделок 2023</FieldLabel>
            <input id="s3_deals_2023" type="number" min={0} value={num(data.s3_deals_2023) || ''} onChange={(e) => onChange('s3_deals_2023', Number(e.target.value) || 0)} className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all" />
          </div>
          <div>
            <FieldLabel htmlFor="s3_deals_2024">Сделок 2024</FieldLabel>
            <input id="s3_deals_2024" type="number" min={0} value={num(data.s3_deals_2024) || ''} onChange={(e) => onChange('s3_deals_2024', Number(e.target.value) || 0)} className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all" />
          </div>
          <div>
            <FieldLabel htmlFor="s3_deals_2025">Сделок 2025</FieldLabel>
            <input id="s3_deals_2025" type="number" min={0} value={num(data.s3_deals_2025) || ''} onChange={(e) => onChange('s3_deals_2025', Number(e.target.value) || 0)} className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all" />
          </div>
          <div>
            <FieldLabel htmlFor="s3_rejections_2023">Отказов 2023</FieldLabel>
            <input id="s3_rejections_2023" type="number" min={0} value={num(data.s3_rejections_2023) || ''} onChange={(e) => onChange('s3_rejections_2023', Number(e.target.value) || 0)} className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all" />
          </div>
          <div>
            <FieldLabel htmlFor="s3_rejections_2024">Отказов 2024</FieldLabel>
            <input id="s3_rejections_2024" type="number" min={0} value={num(data.s3_rejections_2024) || ''} onChange={(e) => onChange('s3_rejections_2024', Number(e.target.value) || 0)} className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all" />
          </div>
          <div>
            <FieldLabel htmlFor="s3_rejections_2025">Отказов 2025</FieldLabel>
            <input id="s3_rejections_2025" type="number" min={0} value={num(data.s3_rejections_2025) || ''} onChange={(e) => onChange('s3_rejections_2025', Number(e.target.value) || 0)} className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all" />
          </div>
          <div>
            <FieldLabel htmlFor="s3_promo_channels">Каналы привлечения</FieldLabel>
            <input id="s3_promo_channels" type="text" value={str(data.s3_promo_channels)} onChange={(e) => onChange('s3_promo_channels', e.target.value)} placeholder="Instagram, Google Ads..." className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all" />
          </div>
          <div>
            <FieldLabel htmlFor="s3_product_count">Кол-во продуктов</FieldLabel>
            <input id="s3_product_count" type="number" min={0} value={num(data.s3_product_count) || ''} onChange={(e) => onChange('s3_product_count', Number(e.target.value) || 0)} className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all" />
          </div>
          <div className="md:col-span-2">
            <FieldLabel htmlFor="s3_flagship_product">Флагманский продукт</FieldLabel>
            <input id="s3_flagship_product" type="text" value={str(data.s3_flagship_product)} onChange={(e) => onChange('s3_flagship_product', e.target.value)} placeholder="Название основного продукта" className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all" />
          </div>
        </div>
      </section>

      {/* ── Воронка конверсии ──────────────────────────────────────────────── */}
      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-on-surface mb-4">
          <span className="material-symbols-outlined text-primary text-lg">filter_alt</span>
          Воронка конверсии
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {FUNNEL_FIELDS.map((f) => (
            <div key={f.key}>
              <FieldLabel htmlFor={f.key}>{f.label}</FieldLabel>
              <div className="relative">
                <input id={f.key} type="number" min={0} max={100} step={0.1} value={num(data[f.key]) || ''} onChange={(e) => onChange(f.key, Number(e.target.value) || 0)} placeholder="0" className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 pr-10 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all" />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-on-surface-variant">%</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── ABC/RFM анализ ─────────────────────────────────────────────────── */}
      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-on-surface mb-4">
          <span className="material-symbols-outlined text-primary text-lg">analytics</span>
          ABC/RFM анализ
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <FieldLabel htmlFor="s5n_abc_analysis">ABC-анализ</FieldLabel>
            <textarea id="s5n_abc_analysis" rows={3} value={str(data.s5n_abc_analysis)} onChange={(e) => onChange('s5n_abc_analysis', e.target.value)} placeholder="Распределение клиентов по ABC-категориям..." className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none" />
          </div>
          <div>
            <FieldLabel htmlFor="s5n_rfm_analysis">RFM-анализ</FieldLabel>
            <textarea id="s5n_rfm_analysis" rows={3} value={str(data.s5n_rfm_analysis)} onChange={(e) => onChange('s5n_rfm_analysis', e.target.value)} placeholder="Recency, Frequency, Monetary анализ..." className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none" />
          </div>
          <div>
            <FieldLabel htmlFor="s5n_product_locomotive">Продукт-локомотив</FieldLabel>
            <input id="s5n_product_locomotive" type="text" value={str(data.s5n_product_locomotive)} onChange={(e) => onChange('s5n_product_locomotive', e.target.value)} placeholder="Продукт, который тянет продажи" className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all" />
          </div>
          <div>
            <FieldLabel htmlFor="s5n_most_marginal">Самый маржинальный</FieldLabel>
            <input id="s5n_most_marginal" type="text" value={str(data.s5n_most_marginal)} onChange={(e) => onChange('s5n_most_marginal', e.target.value)} placeholder="Продукт с наибольшей маржой" className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all" />
          </div>
          <div className="md:col-span-2">
            <FieldLabel htmlFor="s5n_entry_product">Входной продукт</FieldLabel>
            <input id="s5n_entry_product" type="text" value={str(data.s5n_entry_product)} onChange={(e) => onChange('s5n_entry_product', e.target.value)} placeholder="Продукт для первого знакомства с клиентом" className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all" />
          </div>
        </div>
      </section>

      {/* ── Клиентский анализ ──────────────────────────────────────────────── */}
      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-on-surface mb-4">
          <span className="material-symbols-outlined text-primary text-lg">person_search</span>
          Клиентский анализ
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <FieldLabel htmlFor="s5n_why_bought">Почему покупают</FieldLabel>
            <textarea id="s5n_why_bought" rows={3} value={str(data.s5n_why_bought)} onChange={(e) => onChange('s5n_why_bought', e.target.value)} placeholder="Основные причины покупки..." className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none" />
          </div>
          <div>
            <FieldLabel htmlFor="s5n_deciding_factor">Решающий фактор</FieldLabel>
            <textarea id="s5n_deciding_factor" rows={3} value={str(data.s5n_deciding_factor)} onChange={(e) => onChange('s5n_deciding_factor', e.target.value)} placeholder="Что является решающим при покупке..." className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none" />
          </div>
          <div>
            <FieldLabel htmlFor="s5n_compared_with">С кем сравнивают</FieldLabel>
            <textarea id="s5n_compared_with" rows={3} value={str(data.s5n_compared_with)} onChange={(e) => onChange('s5n_compared_with', e.target.value)} placeholder="С какими компаниями сравнивают..." className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none" />
          </div>
          <div>
            <FieldLabel htmlFor="s5n_barriers">Барьеры покупки</FieldLabel>
            <textarea id="s5n_barriers" rows={3} value={str(data.s5n_barriers)} onChange={(e) => onChange('s5n_barriers', e.target.value)} placeholder="Что мешает клиентам купить..." className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none" />
          </div>
          <div>
            <FieldLabel htmlFor="s5n_how_found_us">Как нашли нас</FieldLabel>
            <textarea id="s5n_how_found_us" rows={3} value={str(data.s5n_how_found_us)} onChange={(e) => onChange('s5n_how_found_us', e.target.value)} placeholder="Каналы, через которые приходят клиенты..." className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none" />
          </div>
          <div>
            <FieldLabel htmlFor="s5n_will_return_nps">Вернётся ли клиент (NPS)</FieldLabel>
            <textarea id="s5n_will_return_nps" rows={3} value={str(data.s5n_will_return_nps)} onChange={(e) => onChange('s5n_will_return_nps', e.target.value)} placeholder="Оценка лояльности и готовности рекомендовать..." className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none" />
          </div>
          <div>
            <FieldLabel htmlFor="s5n_improve_suggestions">Что улучшить</FieldLabel>
            <textarea id="s5n_improve_suggestions" rows={3} value={str(data.s5n_improve_suggestions)} onChange={(e) => onChange('s5n_improve_suggestions', e.target.value)} placeholder="Предложения клиентов по улучшению..." className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none" />
          </div>
          <div>
            <FieldLabel htmlFor="s5n_upsell_crosssell">Upsell / Cross-sell</FieldLabel>
            <textarea id="s5n_upsell_crosssell" rows={3} value={str(data.s5n_upsell_crosssell)} onChange={(e) => onChange('s5n_upsell_crosssell', e.target.value)} placeholder="Возможности для допродаж и перекрёстных продаж..." className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none" />
          </div>
        </div>
      </section>
    </div>
  )
}
