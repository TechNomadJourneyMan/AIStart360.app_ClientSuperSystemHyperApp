'use client'

import React from 'react'
import { FieldLabel } from '@/components/onboarding/shared'
import { INDUSTRIES, REGIONS, COMPANY_STAGES, BUSINESS_MODELS } from '@/components/onboarding/constants/options'

/* ─── Types ────────────────────────────────────────────────────────────────── */
interface Step1CompanyFormProps {
  data: Record<string, unknown>
  onChange: (key: string, value: unknown) => void
  userId?: string
}

/* ─── Helpers ──────────────────────────────────────────────────────────────── */
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number => (typeof v === 'number' ? v : 0)
const arr = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : [])

/* ─── Component ────────────────────────────────────────────────────────────── */
export default function Step1CompanyForm({ data, onChange }: Step1CompanyFormProps) {
  const toggleRegion = (opt: string) => {
    const current = arr(data.s1_regions)
    onChange(
      's1_regions',
      current.includes(opt) ? current.filter((v) => v !== opt) : [...current, opt],
    )
  }

  return (
    <div className="space-y-8">
      {/* ── Основная информация ─────────────────────────────────────────── */}
      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-on-surface mb-4">
          <span className="material-symbols-outlined text-primary text-lg">apartment</span>
          Основная информация
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <FieldLabel htmlFor="s1_company_name">Название компании (обязательно)</FieldLabel>
            <input id="s1_company_name" type="text" value={str(data.s1_company_name)} onChange={(e) => onChange('s1_company_name', e.target.value)} placeholder="ООО «Компания»" className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all" />
          </div>
          <div>
            <FieldLabel htmlFor="s1_founded_at">Год основания</FieldLabel>
            <input id="s1_founded_at" type="number" min={1900} max={2026} value={num(data.s1_founded_at) || ''} onChange={(e) => onChange('s1_founded_at', Number(e.target.value) || 0)} placeholder="2020" className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all" />
          </div>
          <div>
            <FieldLabel htmlFor="s1_industry">Отрасль (обязательно)</FieldLabel>
            <select id="s1_industry" value={str(data.s1_industry)} onChange={(e) => onChange('s1_industry', e.target.value)} className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all appearance-none">
              <option value="">— Выберите —</option>
              {INDUSTRIES.map((ind) => (<option key={ind} value={ind}>{ind}</option>))}
            </select>
          </div>
          <div>
            <FieldLabel htmlFor="s1_stage">Стадия развития</FieldLabel>
            <select id="s1_stage" value={str(data.s1_stage)} onChange={(e) => onChange('s1_stage', e.target.value)} className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all appearance-none">
              <option value="">— Выберите —</option>
              {COMPANY_STAGES.map((s) => (<option key={s.value} value={s.value}>{s.label}</option>))}
            </select>
          </div>
          <div>
            <FieldLabel htmlFor="s1_employee_count">Кол-во сотрудников</FieldLabel>
            <input id="s1_employee_count" type="number" min={0} value={num(data.s1_employee_count) || ''} onChange={(e) => onChange('s1_employee_count', Number(e.target.value) || 0)} placeholder="10" className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all" />
          </div>
          <div>
            <FieldLabel htmlFor="s1_business_model">Бизнес-модель</FieldLabel>
            <select id="s1_business_model" value={str(data.s1_business_model)} onChange={(e) => onChange('s1_business_model', e.target.value)} className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all appearance-none">
              <option value="">— Выберите —</option>
              {BUSINESS_MODELS.map((m) => (<option key={m.value} value={m.value}>{m.label}</option>))}
            </select>
          </div>
          <div>
            <FieldLabel htmlFor="s1_years_on_market">Лет на рынке</FieldLabel>
            <input id="s1_years_on_market" type="number" min={0} value={num(data.s1_years_on_market) || ''} onChange={(e) => onChange('s1_years_on_market', Number(e.target.value) || 0)} placeholder="5" className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all" />
          </div>
          <div>
            <FieldLabel htmlFor="s1_website">Веб-сайт</FieldLabel>
            <input id="s1_website" type="text" value={str(data.s1_website)} onChange={(e) => onChange('s1_website', e.target.value)} placeholder="https://example.com" className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all" />
          </div>
          <div className="md:col-span-2">
            <FieldLabel htmlFor="s1_social_media">Социальные сети</FieldLabel>
            <input id="s1_social_media" type="text" value={str(data.s1_social_media)} onChange={(e) => onChange('s1_social_media', e.target.value)} placeholder="Ссылки на Instagram, Telegram, и т.д." className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all" />
          </div>
          {/* Regions multi-select */}
          <div className="md:col-span-2">
            <FieldLabel>Регионы</FieldLabel>
            <div className="flex flex-wrap gap-2">
              {REGIONS.map((opt) => (
                <button key={opt} type="button" onClick={() => toggleRegion(opt)} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${arr(data.s1_regions).includes(opt) ? 'bg-primary/20 border-primary/50 text-primary' : 'bg-surface-container border-white/[0.08] text-on-surface-variant hover:border-white/20'}`}>
                  {opt}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Продукты ──────────────────────────────────────────────────────── */}
      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-on-surface mb-4">
          <span className="material-symbols-outlined text-primary text-lg">inventory_2</span>
          Продукты и конкуренты
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <FieldLabel htmlFor="s1_products_list">Список продуктов / услуг</FieldLabel>
            <textarea id="s1_products_list" rows={3} value={str(data.s1_products_list)} onChange={(e) => onChange('s1_products_list', e.target.value)} placeholder="Перечислите основные продукты или услуги..." className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none" />
          </div>
          <div>
            <FieldLabel htmlFor="s1_competitors_list">Основные конкуренты</FieldLabel>
            <textarea id="s1_competitors_list" rows={3} value={str(data.s1_competitors_list)} onChange={(e) => onChange('s1_competitors_list', e.target.value)} placeholder="Перечислите основных конкурентов..." className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none" />
          </div>
        </div>
      </section>

      {/* ── Контакты ──────────────────────────────────────────────────────── */}
      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-on-surface mb-4">
          <span className="material-symbols-outlined text-primary text-lg">contact_phone</span>
          Контактное лицо
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <FieldLabel htmlFor="s1_contact_name">ФИО (обязательно)</FieldLabel>
            <input id="s1_contact_name" type="text" value={str(data.s1_contact_name)} onChange={(e) => onChange('s1_contact_name', e.target.value)} placeholder="Иванов Иван Иванович" className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all" />
          </div>
          <div>
            <FieldLabel htmlFor="s1_contact_position">Должность</FieldLabel>
            <input id="s1_contact_position" type="text" value={str(data.s1_contact_position)} onChange={(e) => onChange('s1_contact_position', e.target.value)} placeholder="Директор" className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all" />
          </div>
          <div>
            <FieldLabel htmlFor="s1_contact_phone">Телефон (обязательно)</FieldLabel>
            <input id="s1_contact_phone" type="text" value={str(data.s1_contact_phone)} onChange={(e) => onChange('s1_contact_phone', e.target.value)} placeholder="+7 (777) 123-45-67" className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all" />
          </div>
          <div>
            <FieldLabel htmlFor="s1_contact_email">Email (обязательно)</FieldLabel>
            <input id="s1_contact_email" type="email" value={str(data.s1_contact_email)} onChange={(e) => onChange('s1_contact_email', e.target.value)} placeholder="info@company.kz" className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all" />
          </div>
        </div>
      </section>
    </div>
  )
}
