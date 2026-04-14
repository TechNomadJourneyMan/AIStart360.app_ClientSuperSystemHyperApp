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
  { key: 'department', label: 'Department', type: 'text' as const },
  { key: 'head', label: 'Head', type: 'text' as const },
  { key: 'manager_count', label: 'Number of Managers', type: 'number' as const },
  { key: 'dept_goals', label: 'Department Goals', type: 'text' as const },
  { key: 'kpi', label: 'KPI', type: 'text' as const },
]

const PLANNING_OPTIONS = [
  { value: 'one_person', label: 'One Person' },
  { value: 'team', label: 'Team' },
]

const CONTROL_OPTIONS = [
  { value: 'reports', label: 'Reports' },
  { value: 'tasks', label: 'Tasks' },
  { value: 'kpi', label: 'KPI' },
  { value: 'fire_fighting', label: 'Fire Fighting' },
]

const FREQ_OPTIONS = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
]

/* ─── Component ────────────────────────────────────────────────────────────── */
export default function Step4OrgStructureForm({ data, onChange }: Step4OrgStructureFormProps) {
  return (
    <div className="space-y-8">
      {/* ── Секция A: Structure ───────────────────────────────────────────── */}
      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-on-surface mb-4">
          <span className="material-symbols-outlined text-primary text-lg">account_tree</span>
          Structure
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <FieldLabel htmlFor="s4_dept_count">Number of Departments</FieldLabel>
            <input id="s4_dept_count" type="number" min={0} value={num(data.s4_dept_count) || ''} onChange={(e) => onChange('s4_dept_count', Number(e.target.value) || 0)} placeholder="5" className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all" />
          </div>
          <div className="flex items-end">
            <BoolToggle label="Has Org Chart" value={bool(data.s4_has_org_chart)} onChange={(v) => onChange('s4_has_org_chart', v)} />
          </div>
        </div>

        {/* Staffing table */}
        <div className="mt-4">
          <FieldLabel>Staffing Table</FieldLabel>
          <DynamicTable columns={STAFFING_COLUMNS} rows={rows(data.s4n_staffing_table)} onChange={(r) => onChange('s4n_staffing_table', r)} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
          <BoolToggle label="Structure Matches Tasks" value={bool(data.s4n_structure_matches)} onChange={(v) => onChange('s4n_structure_matches', v)} />
          <BoolToggle label="Has Open Vacancies" value={bool(data.s4n_open_vacancies)} onChange={(v) => onChange('s4n_open_vacancies', v)} />
          <BoolToggle label="Role Overlap" value={bool(data.s4n_multi_roles)} onChange={(v) => onChange('s4n_multi_roles', v)} />
        </div>
      </section>

      {/* ── Секция B: Management ──────────────────────────────────────────── */}
      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-on-surface mb-4">
          <span className="material-symbols-outlined text-primary text-lg">settings</span>
          Management
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <FieldLabel htmlFor="s4m_strategic_planning">Strategic Planning</FieldLabel>
            <input id="s4m_strategic_planning" type="text" value={str(data.s4m_strategic_planning)} onChange={(e) => onChange('s4m_strategic_planning', e.target.value)} placeholder="Describe the planning process..." className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all" />
          </div>
          <div>
            <FieldLabel htmlFor="s4m_planning_team_or_solo">Planning</FieldLabel>
            <select id="s4m_planning_team_or_solo" value={str(data.s4m_planning_team_or_solo)} onChange={(e) => onChange('s4m_planning_team_or_solo', e.target.value)} className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all appearance-none">
              <option value="">— Select —</option>
              {PLANNING_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
            </select>
          </div>
          <div>
            <FieldLabel htmlFor="s4m_control_method">Control Method</FieldLabel>
            <select id="s4m_control_method" value={str(data.s4m_control_method)} onChange={(e) => onChange('s4m_control_method', e.target.value)} className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all appearance-none">
              <option value="">— Select —</option>
              {CONTROL_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
            </select>
          </div>
          <div>
            <FieldLabel htmlFor="s4m_communication">Communication Channels</FieldLabel>
            <input id="s4m_communication" type="text" value={str(data.s4m_communication)} onChange={(e) => onChange('s4m_communication', e.target.value)} placeholder="Telegram, WhatsApp, meetings..." className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all" />
          </div>
          <BoolToggle label="Cross-Department Sync" value={bool(data.s4m_dept_sync)} onChange={(v) => onChange('s4m_dept_sync', v)} />
          <BoolToggle label="Regular Meetings" value={bool(data.s4_has_regular_meetings)} onChange={(v) => onChange('s4_has_regular_meetings', v)} />
          <BoolToggle label="Meetings are Structured" value={bool(data.s4m_meeting_structure)} onChange={(v) => onChange('s4m_meeting_structure', v)} />
          <div>
            <FieldLabel htmlFor="s4m_meeting_efficiency">Meeting Efficiency</FieldLabel>
            <input id="s4m_meeting_efficiency" type="text" value={str(data.s4m_meeting_efficiency)} onChange={(e) => onChange('s4m_meeting_efficiency', e.target.value)} placeholder="High / Medium / Low" className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all" />
          </div>
        </div>
      </section>

      {/* ── Отчётность ────────────────────────────────────────────────────── */}
      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-on-surface mb-4">
          <span className="material-symbols-outlined text-primary text-lg">assessment</span>
          Reporting and Delegation
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <FieldLabel htmlFor="s4m_report_types">Report Types</FieldLabel>
            <input id="s4m_report_types" type="text" value={str(data.s4m_report_types)} onChange={(e) => onChange('s4m_report_types', e.target.value)} placeholder="Financial, operational, marketing..." className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all" />
          </div>
          <div>
            <FieldLabel htmlFor="s4m_report_automated">Reporting Tool</FieldLabel>
            <select id="s4m_report_automated" value={str(data.s4m_report_automated)} onChange={(e) => onChange('s4m_report_automated', e.target.value)} className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all appearance-none">
              <option value="">— Select —</option>
              {REPORTING_TOOLS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
            </select>
          </div>
          <div>
            <FieldLabel htmlFor="s4m_report_frequency">Reporting Frequency</FieldLabel>
            <select id="s4m_report_frequency" value={str(data.s4m_report_frequency)} onChange={(e) => onChange('s4m_report_frequency', e.target.value)} className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all appearance-none">
              <option value="">— Select —</option>
              {FREQ_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
            </select>
          </div>
          <div>
            <FieldLabel htmlFor="s4m_hours_on_ops">Hours/day on Operations</FieldLabel>
            <input id="s4m_hours_on_ops" type="number" min={0} max={24} value={num(data.s4m_hours_on_ops) || ''} onChange={(e) => onChange('s4m_hours_on_ops', Number(e.target.value) || 0)} placeholder="4" className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all" />
          </div>
          <div className="md:col-span-2">
            <FieldLabel htmlFor="s4m_delegation_readiness">Delegation Readiness (1-10)</FieldLabel>
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
