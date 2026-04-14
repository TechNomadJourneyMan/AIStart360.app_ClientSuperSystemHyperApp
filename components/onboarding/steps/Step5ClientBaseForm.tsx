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
  { key: 's5n_funnel_lead_to_call', label: 'Lead -> Call (%)' },
  { key: 's5n_funnel_call_to_meeting', label: 'Call -> Meeting (%)' },
  { key: 's5n_funnel_meeting_to_proposal', label: 'Meeting -> Proposal (%)' },
  { key: 's5n_funnel_proposal_to_negotiation', label: 'Proposal -> Negotiation (%)' },
  { key: 's5n_funnel_negotiation_to_contract', label: 'Negotiation -> Contract (%)' },
  { key: 's5n_funnel_contract_to_payment', label: 'Contract -> Payment (%)' },
  { key: 's5n_funnel_payment_to_delivery', label: 'Payment -> Delivery (%)' },
  { key: 's5n_funnel_lead_to_sale', label: 'Lead -> Sale Overall (%)' },
] as const

/* ─── Component ────────────────────────────────────────────────────────────── */
export default function Step5ClientBaseForm({ data, onChange }: Step5ClientBaseFormProps) {
  return (
    <div className="space-y-8">
      {/* ── CRM Data ────────────────────────────────────────────────────── */}
      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-on-surface mb-4">
          <span className="material-symbols-outlined text-primary text-lg">database</span>
          CRM Data
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <FieldLabel htmlFor="s3_has_crm">CRM Availability</FieldLabel>
            <input id="s3_has_crm" type="text" value={str(data.s3_has_crm)} onChange={(e) => onChange('s3_has_crm', e.target.value)} placeholder="amoCRM, Bitrix24..." className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all" />
          </div>
          <div>
            <FieldLabel htmlFor="s3_deal_cycle_days">Deal Cycle (days)</FieldLabel>
            <input id="s3_deal_cycle_days" type="number" min={0} value={num(data.s3_deal_cycle_days) || ''} onChange={(e) => onChange('s3_deal_cycle_days', Number(e.target.value) || 0)} placeholder="30" className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all" />
          </div>
          <div>
            <FieldLabel htmlFor="s3_deals_2023">Deals 2023</FieldLabel>
            <input id="s3_deals_2023" type="number" min={0} value={num(data.s3_deals_2023) || ''} onChange={(e) => onChange('s3_deals_2023', Number(e.target.value) || 0)} className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all" />
          </div>
          <div>
            <FieldLabel htmlFor="s3_deals_2024">Deals 2024</FieldLabel>
            <input id="s3_deals_2024" type="number" min={0} value={num(data.s3_deals_2024) || ''} onChange={(e) => onChange('s3_deals_2024', Number(e.target.value) || 0)} className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all" />
          </div>
          <div>
            <FieldLabel htmlFor="s3_deals_2025">Deals 2025</FieldLabel>
            <input id="s3_deals_2025" type="number" min={0} value={num(data.s3_deals_2025) || ''} onChange={(e) => onChange('s3_deals_2025', Number(e.target.value) || 0)} className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all" />
          </div>
          <div>
            <FieldLabel htmlFor="s3_rejections_2023">Rejections 2023</FieldLabel>
            <input id="s3_rejections_2023" type="number" min={0} value={num(data.s3_rejections_2023) || ''} onChange={(e) => onChange('s3_rejections_2023', Number(e.target.value) || 0)} className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all" />
          </div>
          <div>
            <FieldLabel htmlFor="s3_rejections_2024">Rejections 2024</FieldLabel>
            <input id="s3_rejections_2024" type="number" min={0} value={num(data.s3_rejections_2024) || ''} onChange={(e) => onChange('s3_rejections_2024', Number(e.target.value) || 0)} className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all" />
          </div>
          <div>
            <FieldLabel htmlFor="s3_rejections_2025">Rejections 2025</FieldLabel>
            <input id="s3_rejections_2025" type="number" min={0} value={num(data.s3_rejections_2025) || ''} onChange={(e) => onChange('s3_rejections_2025', Number(e.target.value) || 0)} className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all" />
          </div>
          <div>
            <FieldLabel htmlFor="s3_promo_channels">Acquisition Channels</FieldLabel>
            <input id="s3_promo_channels" type="text" value={str(data.s3_promo_channels)} onChange={(e) => onChange('s3_promo_channels', e.target.value)} placeholder="Instagram, Google Ads..." className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all" />
          </div>
          <div>
            <FieldLabel htmlFor="s3_product_count">Number of Products</FieldLabel>
            <input id="s3_product_count" type="number" min={0} value={num(data.s3_product_count) || ''} onChange={(e) => onChange('s3_product_count', Number(e.target.value) || 0)} className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all" />
          </div>
          <div className="md:col-span-2">
            <FieldLabel htmlFor="s3_flagship_product">Flagship Product</FieldLabel>
            <input id="s3_flagship_product" type="text" value={str(data.s3_flagship_product)} onChange={(e) => onChange('s3_flagship_product', e.target.value)} placeholder="Main product name" className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all" />
          </div>
        </div>
      </section>

      {/* ── Conversion Funnel ──────────────────────────────────────────────── */}
      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-on-surface mb-4">
          <span className="material-symbols-outlined text-primary text-lg">filter_alt</span>
          Conversion Funnel
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

      {/* ── ABC/RFM Analysis ─────────────────────────────────────────────────── */}
      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-on-surface mb-4">
          <span className="material-symbols-outlined text-primary text-lg">analytics</span>
          ABC/RFM Analysis
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <FieldLabel htmlFor="s5n_abc_analysis">ABC Analysis</FieldLabel>
            <textarea id="s5n_abc_analysis" rows={3} value={str(data.s5n_abc_analysis)} onChange={(e) => onChange('s5n_abc_analysis', e.target.value)} placeholder="Client distribution by ABC categories..." className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none" />
          </div>
          <div>
            <FieldLabel htmlFor="s5n_rfm_analysis">RFM Analysis</FieldLabel>
            <textarea id="s5n_rfm_analysis" rows={3} value={str(data.s5n_rfm_analysis)} onChange={(e) => onChange('s5n_rfm_analysis', e.target.value)} placeholder="Recency, Frequency, Monetary analysis..." className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none" />
          </div>
          <div>
            <FieldLabel htmlFor="s5n_product_locomotive">Locomotive Product</FieldLabel>
            <input id="s5n_product_locomotive" type="text" value={str(data.s5n_product_locomotive)} onChange={(e) => onChange('s5n_product_locomotive', e.target.value)} placeholder="Product that drives sales" className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all" />
          </div>
          <div>
            <FieldLabel htmlFor="s5n_most_marginal">Most Profitable</FieldLabel>
            <input id="s5n_most_marginal" type="text" value={str(data.s5n_most_marginal)} onChange={(e) => onChange('s5n_most_marginal', e.target.value)} placeholder="Product with highest margin" className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all" />
          </div>
          <div className="md:col-span-2">
            <FieldLabel htmlFor="s5n_entry_product">Entry Product</FieldLabel>
            <input id="s5n_entry_product" type="text" value={str(data.s5n_entry_product)} onChange={(e) => onChange('s5n_entry_product', e.target.value)} placeholder="Product for first client introduction" className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all" />
          </div>
        </div>
      </section>

      {/* ── Client Analysis ──────────────────────────────────────────────── */}
      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-on-surface mb-4">
          <span className="material-symbols-outlined text-primary text-lg">person_search</span>
          Client Analysis
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <FieldLabel htmlFor="s5n_why_bought">Why They Buy</FieldLabel>
            <textarea id="s5n_why_bought" rows={3} value={str(data.s5n_why_bought)} onChange={(e) => onChange('s5n_why_bought', e.target.value)} placeholder="Main purchase reasons..." className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none" />
          </div>
          <div>
            <FieldLabel htmlFor="s5n_deciding_factor">Deciding Factor</FieldLabel>
            <textarea id="s5n_deciding_factor" rows={3} value={str(data.s5n_deciding_factor)} onChange={(e) => onChange('s5n_deciding_factor', e.target.value)} placeholder="What is decisive in purchasing..." className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none" />
          </div>
          <div>
            <FieldLabel htmlFor="s5n_compared_with">Who They Compare With</FieldLabel>
            <textarea id="s5n_compared_with" rows={3} value={str(data.s5n_compared_with)} onChange={(e) => onChange('s5n_compared_with', e.target.value)} placeholder="Which companies they compare with..." className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none" />
          </div>
          <div>
            <FieldLabel htmlFor="s5n_barriers">Purchase Barriers</FieldLabel>
            <textarea id="s5n_barriers" rows={3} value={str(data.s5n_barriers)} onChange={(e) => onChange('s5n_barriers', e.target.value)} placeholder="What prevents clients from buying..." className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none" />
          </div>
          <div>
            <FieldLabel htmlFor="s5n_how_found_us">How They Found Us</FieldLabel>
            <textarea id="s5n_how_found_us" rows={3} value={str(data.s5n_how_found_us)} onChange={(e) => onChange('s5n_how_found_us', e.target.value)} placeholder="Channels through which clients come..." className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none" />
          </div>
          <div>
            <FieldLabel htmlFor="s5n_will_return_nps">Will the Client Return (NPS)</FieldLabel>
            <textarea id="s5n_will_return_nps" rows={3} value={str(data.s5n_will_return_nps)} onChange={(e) => onChange('s5n_will_return_nps', e.target.value)} placeholder="Loyalty and willingness to recommend assessment..." className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none" />
          </div>
          <div>
            <FieldLabel htmlFor="s5n_improve_suggestions">What to Improve</FieldLabel>
            <textarea id="s5n_improve_suggestions" rows={3} value={str(data.s5n_improve_suggestions)} onChange={(e) => onChange('s5n_improve_suggestions', e.target.value)} placeholder="Client improvement suggestions..." className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none" />
          </div>
          <div>
            <FieldLabel htmlFor="s5n_upsell_crosssell">Upsell / Cross-sell</FieldLabel>
            <textarea id="s5n_upsell_crosssell" rows={3} value={str(data.s5n_upsell_crosssell)} onChange={(e) => onChange('s5n_upsell_crosssell', e.target.value)} placeholder="Opportunities for upselling and cross-selling..." className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none" />
          </div>
        </div>
      </section>
    </div>
  )
}
