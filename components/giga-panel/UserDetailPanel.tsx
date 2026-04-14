'use client'

import { useState, useEffect } from 'react'
import {
  FileText, Loader2, Pencil, Save, X, ExternalLink, Download,
  Paperclip, File, FileBarChart, FileSpreadsheet,
} from 'lucide-react'
import { SURVEY_LABELS, SURVEY_STEP_LABELS, formatSurveyValue, getStepFromKey } from '@/lib/survey-labels'

// ─── Shared user detail panel (survey + diagnostics + documents + actions) ────
// Used in: RequestsModule, CRMModule, ClientsModule

interface Props {
  userId: string
}

const DOC_ICONS: Record<string, React.ReactNode> = {
  'p&l': <FileBarChart size={14} className="text-emerald-400" />,
  'balance': <FileSpreadsheet size={14} className="text-blue-400" />,
  'crm': <FileSpreadsheet size={14} className="text-violet-400" />,
}

function formatFileSize(bytes: number | null): string {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function UserDetailPanel({ userId }: Props) {
  const [data, setData] = useState<{
    answers: Record<string, unknown>
    company: Record<string, unknown> | null
    completedSteps: number[]
  } | null>(null)
  const [diag, setDiag] = useState<Record<string, unknown> | null>(null)
  const [docs, setDocs] = useState<Array<{
    id: string; file_name: string; file_url: string; doc_type: string
    file_size: number | null; parse_status: string
  }>>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [editValues, setEditValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [impersonating, setImpersonating] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [surveyRes, diagRes, docsRes] = await Promise.all([
          fetch(`/api/giga-admin/requests/${userId}/survey`),
          fetch(`/api/giga-admin/requests/${userId}/diagnostics`),
          fetch(`/api/giga-admin/requests/${userId}/documents`),
        ])
        const [surveyJson, diagJson, docsJson] = await Promise.all([
          surveyRes.json(), diagRes.json(), docsRes.json(),
        ])
        if (!cancelled) {
          setData(surveyJson.data ?? null)
          setDiag(diagJson.data ?? null)
          setDocs(docsJson.data ?? [])
        }
      } catch {}
      if (!cancelled) setLoading(false)
    })()
    return () => { cancelled = true }
  }, [userId])

  const startEditing = () => {
    const vals: Record<string, string> = {}
    // Pre-fill from existing answers if available
    if (data?.answers) {
      for (const [k, v] of Object.entries(data.answers)) {
        vals[k] = typeof v === 'object' ? JSON.stringify(v) : String(v ?? '')
      }
    }
    // If empty, add all known survey fields with empty values
    if (Object.keys(vals).length === 0) {
      const allFields = Object.keys(SURVEY_LABELS)
      for (const k of allFields) vals[k] = ''
      // Set completedSteps so UI renders all steps
      if (data) {
        setData({ ...data, completedSteps: [1, 2, 3, 4, 5, 6] })
      } else {
        setData({ answers: {}, company: null, completedSteps: [1, 2, 3, 4, 5, 6] })
      }
    }
    setEditValues(vals)
    setEditing(true)
  }

  const cancelEditing = () => { setEditing(false); setEditValues({}) }

  const saveEdits = async () => {
    setSaving(true)
    try {
      const answers: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(editValues)) {
        const num = Number(v)
        answers[k] = !isNaN(num) && v.trim() !== '' && !v.includes(' ') ? num : v
      }
      const res = await fetch(`/api/giga-admin/requests/${userId}/survey`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers }),
      })
      if (res.ok) {
        setData(prev => prev ? { ...prev, answers } : prev)
        setEditing(false)
      }
    } catch {}
    setSaving(false)
  }

  const getImpersonateUrl = async (redirectTo?: string): Promise<string | null> => {
    try {
      const res = await fetch('/api/giga-admin/impersonate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, redirectTo }),
      })
      const d = await res.json()
      return d.url ?? null
    } catch { return null }
  }

  const openAsUser = async () => {
    setImpersonating(true)
    const url = await getImpersonateUrl()
    if (url) window.open(url, '_blank')
    setImpersonating(false)
  }

  const openOnboarding = async () => {
    setImpersonating(true)
    const url = await getImpersonateUrl('/client/onboarding')
    if (url) window.open(url, '_blank')
    setImpersonating(false)
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 justify-center">
        <Loader2 size={14} className="text-slate-500 animate-spin" />
        <span className="text-[11px] text-slate-500">Loading data...</span>
      </div>
    )
  }

  const scoreColor = (s: number) => s >= 70 ? 'text-emerald-400' : s >= 40 ? 'text-amber-400' : 'text-red-400'

  return (
    <div className="px-4 py-4 space-y-4">
      {/* Action buttons */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={openAsUser} disabled={impersonating}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-blue-500/10 border border-blue-500/20 text-blue-300 hover:bg-blue-500/20 transition-all disabled:opacity-50">
          {impersonating ? <Loader2 size={12} className="animate-spin" /> : <ExternalLink size={12} />}
          Open Portal
        </button>
        <button onClick={openOnboarding} disabled={impersonating}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-violet-500/10 border border-violet-500/20 text-violet-300 hover:bg-violet-500/20 transition-all disabled:opacity-50">
          {impersonating ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />}
          Fill Survey on Behalf
        </button>
        {!editing && (
          <button onClick={startEditing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-amber-500/10 border border-amber-500/20 text-amber-300 hover:bg-amber-500/20 transition-all">
            <Pencil size={12} />
            {data && data.completedSteps.length > 0 ? 'Edit Survey' : 'Create Survey'}
          </button>
        )}
        {editing && (
          <>
            <button onClick={saveEdits} disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 hover:bg-emerald-500/20 transition-all disabled:opacity-50">
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              Save
            </button>
            <button onClick={cancelEditing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-white/[0.05] border border-white/[0.08] text-slate-400 hover:text-slate-300 transition-all">
              <X size={12} />
              Cancel
            </button>
          </>
        )}
      </div>

      {/* Diagnostics */}
      {diag && (
        <div className="p-3 rounded-xl bg-violet-500/5 border border-violet-500/10">
          <div className="flex items-center gap-1.5 mb-2">
            <FileText size={12} className="text-violet-400" />
            <span className="text-[11px] font-semibold text-violet-300 uppercase tracking-wider">Diagnostics Results</span>
          </div>
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div className="text-center">
              <p className="text-[9px] text-slate-600 uppercase">Score</p>
              <p className={`text-lg font-mono font-bold ${scoreColor((diag.overall_score as number) ?? 0)}`}>{(diag.overall_score as number) ?? 0}</p>
            </div>
            <div className="text-center">
              <p className="text-[9px] text-slate-600 uppercase">Health</p>
              <p className={`text-lg font-mono font-bold ${scoreColor((diag.health_index as number) ?? 0)}`}>{(diag.health_index as number) ?? 0}</p>
            </div>
            <div className="text-center">
              <p className="text-[9px] text-slate-600 uppercase">Stage</p>
              <p className="text-sm font-mono font-bold text-blue-300">{(diag.stage as string) ?? '—'}</p>
            </div>
          </div>
          {['finance', 'sales', 'operations', 'marketing', 'strategy'].map(key => {
            const block = diag[`${key}_score`] as { score?: number } | null
            const s = block?.score ?? 0
            const labels: Record<string, string> = { finance: 'Finance', sales: 'Sales', operations: 'Operations', marketing: 'Marketing', strategy: 'Strategy' }
            return (
              <div key={key} className="flex items-center gap-2">
                <span className="text-[10px] text-slate-500 w-20">{labels[key]}</span>
                <div className="flex-1 h-1 bg-white/[0.04] rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${s}%`, background: s >= 70 ? '#6effc0' : s >= 40 ? '#fbbf24' : '#ef4444' }} />
                </div>
                <span className={`text-[10px] font-mono font-bold w-8 text-right ${scoreColor(s)}`}>{s}</span>
              </div>
            )
          })}
        </div>
      )}

      {/* Survey answers */}
      {data && data.completedSteps.length > 0 ? (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <FileText size={12} className="text-blue-400" />
            <span className="text-[11px] font-semibold text-blue-300 uppercase tracking-wider">
              Survey Data {editing && <span className="text-amber-400 ml-1">(editing)</span>}
            </span>
          </div>
          {data.completedSteps.map(step => {
            const fields = Object.entries(editing ? editValues : data.answers)
              .filter(([k]) => getStepFromKey(k) === step)
              .map(([k, v]) => ({ key: k, label: SURVEY_LABELS[k] || k, value: editing ? String(v ?? '') : formatSurveyValue(k, v) }))
            if (!fields.length) return null
            return (
              <div key={step} className="p-2.5 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                  {SURVEY_STEP_LABELS[step] || `Step ${step}`}
                </p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                  {fields.map(f => (
                    <div key={f.key} className="flex flex-col py-0.5">
                      <span className="text-[9px] text-slate-600">{f.label}</span>
                      {editing ? (
                        <input type="text" value={editValues[f.key] ?? ''}
                          onChange={e => setEditValues(prev => ({ ...prev, [f.key]: e.target.value }))}
                          className="mt-0.5 px-2 py-1 rounded bg-white/[0.05] border border-white/[0.1] text-[11px] text-slate-200 focus:border-blue-500/40 focus:outline-none transition-all" />
                      ) : (
                        <span className="text-[11px] text-slate-300 leading-tight">{f.value}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.04] text-center">
          <p className="text-[11px] text-slate-500 mb-2">Survey not completed</p>
          <p className="text-[10px] text-slate-600">Click 'Create Survey' or 'Fill Survey on Behalf' above</p>
        </div>
      )}

      {/* Documents */}
      {docs.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <Paperclip size={12} className="text-emerald-400" />
            <span className="text-[11px] font-semibold text-emerald-300 uppercase tracking-wider">Documents ({docs.length})</span>
          </div>
          {docs.map(doc => {
            const icon = DOC_ICONS[doc.doc_type?.toLowerCase()] ?? <File size={14} className="text-slate-400" />
            return (
              <div key={doc.id} className="flex items-center gap-2.5 p-2 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                {icon}
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-slate-300 truncate">{doc.file_name}</p>
                  <span className="text-[9px] text-slate-600">{formatFileSize(doc.file_size)}</span>
                </div>
                {doc.file_url && (
                  <a href={doc.file_url} target="_blank" rel="noopener noreferrer" className="p-1 rounded hover:bg-white/[0.05]">
                    <Download size={12} className="text-slate-500 hover:text-slate-300" />
                  </a>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
