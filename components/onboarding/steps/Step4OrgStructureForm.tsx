'use client'

import React from 'react'
import { FieldLabel, BoolToggle, DynamicTable } from '@/components/onboarding/shared'
import { REPORTING_TOOLS } from '@/components/onboarding/constants/options'

/* ─── Types ────────────────────────────────────────────────────────────────── */
interface Step4OrgStructureFormProps {
  data: Record<string, unknown>
  onChange: (key: string, value: unknown) => void
  userId?: string
}

/* ─── Helpers ──────────────────────────────────────────────────────────────── */
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number => (typeof v === 'number' ? v : 0)
const bool = (v: unknown): boolean => (typeof v === 'boolean' ? v : false)
const rows = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? (v as Record<string, unknown>[]) : [{ department: '', head: '', manager_count: 0, dept_goals: '', kpi: '' }]

/* ─── Table columns ───────────────────────────────────────────────────────── */
const STAFFING_COLUMNS = [
  { key: 'department', label: 'Отдел', type: 'text' as const },
  { key: 'head', label: 'Руководитель', type: 'text' as const },
  { key: 'manager_count', label: 'Кол-во менеджеров', type: 'number' as const },
  { key: 'dept_goals', label: 'Цели отдела', type: 'text' as const },
  { key: 'kpi', label: 'KPI', type: 'text' as const },
]

const PLANNING_OPTIONS = [
  { value: 'one_person', label: 'Один человек' },
  { value: 'team', label: 'Команда' },
]

const CONTROL_OPTIONS = [
  { value: 'reports', label: 'Отчёты' },
  { value: 'tasks', label: 'Задачи' },
  { value: 'kpi', label: 'KPI' },
  { value: 'fire_fighting', label: 'Тушение пожаров' },
]

const FREQ_OPTIONS = [
  { value: 'daily', label: 'Ежедневно' },
  { value: 'weekly', label: 'Еженедельно' },
  { value: 'monthly', label: 'Ежемесячно' },
]

/* ─── Component ────────────────────────────────────────────────────────────── */
export default function Step4OrgStructureForm({ data, onChange }: Step4OrgStructureFormProps) {
  return (
    <div className="space-y-8">
      {/* ── Секция A: Структура ───────────────────────────────────────────── */}
      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-on-surface mb-4">
          <span className="material-symbols-outlined text-primary text-lg">account_tree</span>
          Структура
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <FieldLabel htmlFor="s4_dept_count">Кол-во отделов</FieldLabel>
            <input id="s4_dept_count" type="number" min={0} value={num(data.s4_dept_count) || ''} onChange={(e) => onChange('s4_dept_count', Number(e.target.value) || 0)} placeholder="5" className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all" />
          </div>
          <div className="flex items-end">
            <BoolToggle label="Есть орг. структура" value={bool(data.s4_has_org_chart)} onChange={(v) => onChange('s4_has_org_chart', v)} />
          </div>
        </div>

        {/* Staffing table */}
        <div className="mt-4">
          <FieldLabel>Штатное расписание</FieldLabel>
          <DynamicTable columns={STAFFING_COLUMNS} rows={rows(data.s4n_staffing_table)} onChange={(r) => onChange('s4n_staffing_table', r)} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
          <BoolToggle label="Структура соответствует задачам" value={bool(data.s4n_structure_matches)} onChange={(v) => onChange('s4n_structure_matches', v)} />
          <BoolToggle label="Есть открытые вакансии" value={bool(data.s4n_open_vacancies)} onChange={(v) => onChange('s4n_open_vacancies', v)} />
          <BoolToggle label="Совмещение ролей" value={bool(data.s4n_multi_roles)} onChange={(v) => onChange('s4n_multi_roles', v)} />
        </div>
      </section>

      {/* ── Секция B: Управление ──────────────────────────────────────────── */}
      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-on-surface mb-4">
          <span className="material-symbols-outlined text-primary text-lg">settings</span>
          Управление
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <FieldLabel htmlFor="s4m_strategic_planning">Стратегическое планирование</FieldLabel>
            <input id="s4m_strategic_planning" type="text" value={str(data.s4m_strategic_planning)} onChange={(e) => onChange('s4m_strategic_planning', e.target.value)} placeholder="Опишите процесс планирования..." className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all" />
          </div>
          <div>
            <FieldLabel htmlFor="s4m_planning_team_or_solo">Планирование</FieldLabel>
            <select id="s4m_planning_team_or_solo" value={str(data.s4m_planning_team_or_solo)} onChange={(e) => onChange('s4m_planning_team_or_solo', e.target.value)} className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all appearance-none">
              <option value="">— Выберите —</option>
              {PLANNING_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
            </select>
          </div>
          <div>
            <FieldLabel htmlFor="s4m_control_method">Метод контроля</FieldLabel>
            <select id="s4m_control_method" value={str(data.s4m_control_method)} onChange={(e) => onChange('s4m_control_method', e.target.value)} className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all appearance-none">
              <option value="">— Выберите —</option>
              {CONTROL_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
            </select>
          </div>
          <div>
            <FieldLabel htmlFor="s4m_communication">Каналы коммуникации</FieldLabel>
            <input id="s4m_communication" type="text" value={str(data.s4m_communication)} onChange={(e) => onChange('s4m_communication', e.target.value)} placeholder="Telegram, WhatsApp, встречи..." className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all" />
          </div>
          <BoolToggle label="Синхронизация между отделами" value={bool(data.s4m_dept_sync)} onChange={(v) => onChange('s4m_dept_sync', v)} />
          <BoolToggle label="Регулярные совещания" value={bool(data.s4_has_regular_meetings)} onChange={(v) => onChange('s4_has_regular_meetings', v)} />
          <BoolToggle label="Совещания структурированы" value={bool(data.s4m_meeting_structure)} onChange={(v) => onChange('s4m_meeting_structure', v)} />
          <div>
            <FieldLabel htmlFor="s4m_meeting_efficiency">Эффективность совещаний</FieldLabel>
            <input id="s4m_meeting_efficiency" type="text" value={str(data.s4m_meeting_efficiency)} onChange={(e) => onChange('s4m_meeting_efficiency', e.target.value)} placeholder="Высокая / Средняя / Низкая" className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all" />
          </div>
        </div>
      </section>

      {/* ── Отчётность ────────────────────────────────────────────────────── */}
      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-on-surface mb-4">
          <span className="material-symbols-outlined text-primary text-lg">assessment</span>
          Отчётность и делегирование
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <FieldLabel htmlFor="s4m_report_types">Виды отчётов</FieldLabel>
            <input id="s4m_report_types" type="text" value={str(data.s4m_report_types)} onChange={(e) => onChange('s4m_report_types', e.target.value)} placeholder="Финансовые, операционные, маркетинговые..." className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all" />
          </div>
          <div>
            <FieldLabel htmlFor="s4m_report_automated">Инструмент отчётности</FieldLabel>
            <select id="s4m_report_automated" value={str(data.s4m_report_automated)} onChange={(e) => onChange('s4m_report_automated', e.target.value)} className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all appearance-none">
              <option value="">— Выберите —</option>
              {REPORTING_TOOLS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
            </select>
          </div>
          <div>
            <FieldLabel htmlFor="s4m_report_frequency">Частота отчётности</FieldLabel>
            <select id="s4m_report_frequency" value={str(data.s4m_report_frequency)} onChange={(e) => onChange('s4m_report_frequency', e.target.value)} className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all appearance-none">
              <option value="">— Выберите —</option>
              {FREQ_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
            </select>
          </div>
          <div>
            <FieldLabel htmlFor="s4m_hours_on_ops">Часов/день на операционку</FieldLabel>
            <input id="s4m_hours_on_ops" type="number" min={0} max={24} value={num(data.s4m_hours_on_ops) || ''} onChange={(e) => onChange('s4m_hours_on_ops', Number(e.target.value) || 0)} placeholder="4" className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all" />
          </div>
          <div className="md:col-span-2">
            <FieldLabel htmlFor="s4m_delegation_readiness">Готовность делегировать (1-10)</FieldLabel>
            <div className="flex items-center gap-3">
              <input id="s4m_delegation_readiness" type="range" min={1} max={10} step={1} value={num(data.s4m_delegation_readiness) || 5} onChange={(e) => onChange('s4m_delegation_readiness', Number(e.target.value))} className="flex-1 accent-primary" />
              <span className="text-sm font-medium text-on-surface w-8 text-center tabular-nums">{num(data.s4m_delegation_readiness) || 5}</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
