'use client'

import React from 'react'

/* ─── Types ────────────────────────────────────────────────────────────────── */
interface Step12ToolsFormProps {
  data: Record<string, unknown>
  onChange: (key: string, value: unknown) => void
}

/* ─── Helpers ──────────────────────────────────────────────────────────────── */
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const bool = (v: unknown): boolean => (typeof v === 'boolean' ? v : false)

/* ─── Option lists ─────────────────────────────────────────────────────────── */
const CRM_OPTIONS = [
  { value: '', label: '— Выберите —' },
  { value: 'none', label: 'Нет' },
  { value: 'bitrix24', label: 'Bitrix24' },
  { value: 'amocrm', label: 'AmoCRM' },
  { value: '1c', label: '1C' },
  { value: 'excel', label: 'Excel' },
  { value: 'other', label: 'Другая' },
]

const EDM_OPTIONS = [
  { value: '', label: '— Выберите —' },
  { value: 'none', label: 'Нет' },
  { value: '1c_doc', label: '1С:Документооборот' },
  { value: 'elma', label: 'ELMA' },
  { value: 'docsvision', label: 'DocsVision' },
  { value: 'other', label: 'Другой' },
]

const ERP_OPTIONS = [
  { value: '', label: '— Выберите —' },
  { value: 'none', label: 'Нет' },
  { value: '1c_erp', label: '1С:ERP' },
  { value: 'sap', label: 'SAP' },
  { value: 'oracle', label: 'Oracle' },
  { value: 'other', label: 'Другая' },
]

const BI_OPTIONS = [
  { value: '', label: '— Выберите —' },
  { value: 'none', label: 'Нет' },
  { value: 'power_bi', label: 'Power BI' },
  { value: 'tableau', label: 'Tableau' },
  { value: 'google_ds', label: 'Google Data Studio / Looker' },
  { value: 'excel', label: 'Excel' },
  { value: 'other', label: 'Другой' },
]

const MESSENGER_OPTIONS = [
  { value: '', label: '— Выберите —' },
  { value: 'telegram', label: 'Telegram' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'slack', label: 'Slack' },
  { value: 'teams', label: 'Microsoft Teams' },
  { value: 'other', label: 'Другой' },
]

const TELEPHONY_OPTIONS = [
  { value: '', label: '— Выберите —' },
  { value: 'none', label: 'Нет' },
  { value: 'mango', label: 'Mango Office' },
  { value: 'sipuni', label: 'Sipuni' },
  { value: 'zadarma', label: 'Zadarma' },
  { value: 'asterisk', label: 'Asterisk' },
  { value: 'other', label: 'Другая' },
]

const PROJECT_MGMT_OPTIONS = [
  { value: '', label: '— Выберите —' },
  { value: 'none', label: 'Нет' },
  { value: 'trello', label: 'Trello' },
  { value: 'jira', label: 'Jira' },
  { value: 'notion', label: 'Notion' },
  { value: 'asana', label: 'Asana' },
  { value: 'bitrix24', label: 'Bitrix24' },
  { value: 'other', label: 'Другой' },
]

const MARKETING_PLATFORM_OPTIONS = [
  { value: '', label: '— Выберите —' },
  { value: 'none', label: 'Нет' },
  { value: 'google_ads', label: 'Google Ads' },
  { value: 'yandex_direct', label: 'Яндекс.Директ' },
  { value: 'meta_ads', label: 'Meta Ads (Facebook/Instagram)' },
  { value: 'sendpulse', label: 'SendPulse' },
  { value: 'other', label: 'Другие' },
]

/* ─── Reusable select ──────────────────────────────────────────────────────── */
function ToolSelect({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all appearance-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  )
}

/* ─── Component ────────────────────────────────────────────────────────────── */
export default function Step12ToolsForm({ data, onChange }: Step12ToolsFormProps) {
  return (
    <div className="space-y-8">
      {/* ── Core systems ──────────────────────────────────────────────────── */}
      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-on-surface mb-4">
          <span className="material-symbols-outlined text-primary text-lg">database</span>
          Основные системы
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ToolSelect
            id="s12_crm_tool"
            label="CRM-система"
            value={str(data.s12_crm_tool)}
            options={CRM_OPTIONS}
            onChange={(v) => onChange('s12_crm_tool', v)}
          />
          <ToolSelect
            id="s12_edm"
            label="Электронный документооборот (EDM)"
            value={str(data.s12_edm)}
            options={EDM_OPTIONS}
            onChange={(v) => onChange('s12_edm', v)}
          />
          <ToolSelect
            id="s12_erp"
            label="ERP-система"
            value={str(data.s12_erp)}
            options={ERP_OPTIONS}
            onChange={(v) => onChange('s12_erp', v)}
          />
          <ToolSelect
            id="s12_bi_tool"
            label="BI-инструмент"
            value={str(data.s12_bi_tool)}
            options={BI_OPTIONS}
            onChange={(v) => onChange('s12_bi_tool', v)}
          />
        </div>
      </section>

      {/* ── Communication ─────────────────────────────────────────────────── */}
      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-on-surface mb-4">
          <span className="material-symbols-outlined text-primary text-lg">chat</span>
          Коммуникация
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ToolSelect
            id="s12_messengers"
            label="Мессенджеры"
            value={str(data.s12_messengers)}
            options={MESSENGER_OPTIONS}
            onChange={(v) => onChange('s12_messengers', v)}
          />
          <ToolSelect
            id="s12_telephony"
            label="Телефония"
            value={str(data.s12_telephony)}
            options={TELEPHONY_OPTIONS}
            onChange={(v) => onChange('s12_telephony', v)}
          />
        </div>
      </section>

      {/* ── Project & Marketing ───────────────────────────────────────────── */}
      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-on-surface mb-4">
          <span className="material-symbols-outlined text-primary text-lg">campaign</span>
          Проекты и маркетинг
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ToolSelect
            id="s12_project_mgmt"
            label="Управление проектами"
            value={str(data.s12_project_mgmt)}
            options={PROJECT_MGMT_OPTIONS}
            onChange={(v) => onChange('s12_project_mgmt', v)}
          />
          <ToolSelect
            id="s12_marketing_platforms"
            label="Маркетинговые платформы"
            value={str(data.s12_marketing_platforms)}
            options={MARKETING_PLATFORM_OPTIONS}
            onChange={(v) => onChange('s12_marketing_platforms', v)}
          />
        </div>
      </section>

      {/* ── Automation & IT ────────────────────────────────────────────────── */}
      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-on-surface mb-4">
          <span className="material-symbols-outlined text-primary text-lg">settings_suggest</span>
          Автоматизация и IT
        </h3>
        <div className="grid grid-cols-1 gap-4">
          {/* automation_details — textarea */}
          <div>
            <label htmlFor="s12_automation_details" className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
              Детали автоматизации
            </label>
            <textarea
              id="s12_automation_details"
              rows={4}
              value={str(data.s12_automation_details)}
              onChange={(e) => onChange('s12_automation_details', e.target.value)}
              placeholder="Опишите текущий уровень автоматизации процессов, интеграции между системами..."
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
            />
          </div>

          {/* it_support — boolean toggle */}
          <div className="flex items-center justify-between bg-surface-container rounded-xl border border-white/[0.08] px-4 py-3">
            <span className="text-sm text-on-surface">IT-поддержка (внутренняя или внешняя)</span>
            <button
              type="button"
              onClick={() => onChange('s12_it_support', !bool(data.s12_it_support))}
              className={`w-12 h-6 rounded-full transition-all flex items-center px-1 ${
                bool(data.s12_it_support) ? 'bg-primary' : 'bg-surface-container-high'
              }`}
            >
              <span
                className={`w-4 h-4 rounded-full bg-white transition-all ${
                  bool(data.s12_it_support) ? 'translate-x-6' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
