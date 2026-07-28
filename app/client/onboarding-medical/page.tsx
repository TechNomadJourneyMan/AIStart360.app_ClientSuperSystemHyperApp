'use client'

// Single-page medical intake (8 fields) as on in.aistart360.app/9 landing.
// Saves to survey_answers + companies via /api/v1/onboarding/medical endpoints.
// If the user has a patient-base file — also uploads to Supabase Storage and
// kicks off the data-quality validator (next chunk).

import { useCallback, useEffect, useState, type ChangeEvent } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { MEDICAL_INTAKE_FIELDS, type IntakeField } from '@/lib/intake-schemas'
import type { DataQualityReport, DataQualityIssue } from '@/lib/data-quality'
import { CLIENT_DASHBOARD_PATH } from '@/lib/role-landing'

export default function OnboardingMedicalPage() {
  const router = useRouter()
  const [values, setValues] = useState<Record<string, string>>({})
  const [file, setFile] = useState<File | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [qualityReport, setQualityReport] = useState<DataQualityReport | null>(null)

  // Bootstrap user + pre-fill with their known email + hydrate saved answers
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const sb = createClient()
      const { data: { user } } = await sb.auth.getUser()
      if (!user) { router.replace('/login'); return }
      if (cancelled) return
      setUserId(user.id)

      // Load previously saved medical_* answers so user doesn't re-enter
      const { data: rows } = await sb
        .from('survey_answers')
        .select('question_key, answer')
        .eq('user_id', user.id)
        .like('question_key', 'medical_%')

      const saved: Record<string, string> = {}
      for (const r of rows ?? []) {
        const key = (r.question_key as string).replace(/^medical_/, '')
        const a = r.answer as { value?: unknown } | null
        const v = a?.value
        if (typeof v === 'string') saved[key] = v
      }

      if (cancelled) return
      setValues((v) => {
        const base: Record<string, string> = { ...saved }
        if (!base.email) base.email = user.email || ''
        // anything user already typed in this session wins
        return { ...base, ...v }
      })
    })()
    return () => { cancelled = true }
  }, [router])

  const updateValue = useCallback((key: string, v: string) => {
    setValues((prev) => ({ ...prev, [key]: v }))
  }, [])

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null
    if (f && f.size > 5 * 1024 * 1024) {
      setError(`Файл больше 5 МБ (${(f.size / 1024 / 1024).toFixed(1)} МБ). Уменьшите или используйте ссылку.`)
      return
    }
    setError(null)
    setFile(f)
  }

  const validate = (): string | null => {
    for (const f of MEDICAL_INTAKE_FIELDS) {
      if (!f.required) continue
      if (f.type === 'file') continue // file is optional in phase 1 even if listed
      if (!(values[f.key] ?? '').trim()) return `Заполните поле «${f.label}»`
    }
    const email = values.email?.trim() ?? ''
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Некорректный email'
    const phone = values.phone?.trim() ?? ''
    if (phone && phone.replace(/\D/g, '').length < 10) return 'Телефон слишком короткий'
    return null
  }

  const submit = async () => {
    const err = validate()
    if (err) { setError(err); return }
    if (!userId) { setError('Сессия не найдена, перезайдите'); return }

    setSubmitting(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('answers', JSON.stringify(values))
      if (file) form.append('patient_base', file)

      const res = await fetch('/api/v1/onboarding/medical', {
        method: 'POST',
        body: form,
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      const body = (await res.json()) as { qualityReport?: DataQualityReport | null }
      setQualityReport(body.qualityReport ?? null)
      setSuccess(true)
      // If there are critical quality issues — let user see them before redirect
      const hasCriticalIssues = body.qualityReport?.issues.some((i) => i.severity === 'critical')
      if (!hasCriticalIssues) {
        setTimeout(() => router.replace(CLIENT_DASHBOARD_PATH), 3500)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось отправить')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-surface py-10 px-6">
      <div className="max-w-2xl mx-auto">
        <Link
          href="/client/welcome"
          className="inline-flex items-center gap-1 text-xs text-on-surface-variant hover:text-primary mb-6"
        >
          <span className="material-symbols-outlined text-[16px]">arrow_back</span>
          Сменить тип бизнеса
        </Link>

        <header className="mb-8">
          <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-3">
            AI-усиление для клиник · Анкета
          </p>
          <h1 className="font-headline text-3xl font-extrabold text-on-surface">
            Расскажите о клинике
          </h1>
          <p className="text-on-surface-variant mt-2 text-sm">
            8 полей, 2–3 минуты. После отправки мы проанализируем базу и подготовим
            персональную стратегию роста выручки по 9 AI-связкам.
          </p>
        </header>

        <form
          onSubmit={(e) => { e.preventDefault(); submit() }}
          className="space-y-5 bg-surface-container-low rounded-2xl border border-white/[0.06] p-6"
        >
          {MEDICAL_INTAKE_FIELDS.map((f) => (
            <FieldRow
              key={f.key}
              field={f}
              value={values[f.key] ?? ''}
              onChange={(v) => updateValue(f.key, v)}
              file={file}
              onFileChange={handleFileChange}
              disabled={submitting || success}
            />
          ))}

          {error && (
            <div className="rounded-xl bg-error/5 border border-error/20 p-3 text-sm text-error">
              {error}
            </div>
          )}

          {success && (
            <div className="rounded-xl bg-primary/5 border border-primary/20 p-3 text-sm text-primary inline-flex items-center gap-2">
              <span className="material-symbols-outlined text-base">check_circle</span>
              Анкета отправлена! {qualityReport ? 'Отчёт по качеству данных ниже.' : 'Переводим в кабинет…'}
            </div>
          )}

          {qualityReport && <QualityReportBlock report={qualityReport} />}

          <div className="pt-3 flex items-center justify-between gap-3">
            <p className="text-[11px] text-on-surface-variant/70">
              Нажимая «Отправить» — соглашаетесь на обработку данных клиники согласно
              закону РК «О персональных данных».
            </p>
            <button
              type="submit"
              disabled={submitting || success}
              className="inline-flex items-center gap-2 rounded-xl bg-primary text-on-primary text-sm font-medium px-5 py-2.5 hover:bg-primary/90 transition-all disabled:opacity-50 flex-shrink-0"
            >
              <span className="material-symbols-outlined text-base">
                {submitting ? 'progress_activity' : 'send'}
              </span>
              {submitting ? 'Отправка...' : 'Отправить'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Field renderer ─────────────────────────────────────────────────────────

interface FieldRowProps {
  field: IntakeField
  value: string
  onChange: (v: string) => void
  file: File | null
  onFileChange: (e: ChangeEvent<HTMLInputElement>) => void
  disabled: boolean
}

function FieldRow({ field, value, onChange, file, onFileChange, disabled }: FieldRowProps) {
  const label = (
    <label className="block text-sm font-medium text-on-surface mb-1.5">
      {field.label}
      {field.required && <span className="text-error ml-1">*</span>}
    </label>
  )

  if (field.type === 'file') {
    return (
      <div>
        {label}
        <div className="rounded-xl border border-white/[0.08] border-dashed bg-surface-container p-4">
          <input
            type="file"
            id={field.key}
            accept=".xlsx,.xls,.csv,.pdf"
            onChange={onFileChange}
            disabled={disabled}
            className="block w-full text-xs text-on-surface-variant file:mr-3 file:rounded-lg file:border-0 file:bg-primary/10 file:text-primary file:px-3 file:py-1.5 file:text-xs file:font-medium hover:file:bg-primary/20 cursor-pointer disabled:opacity-50"
          />
          {file && (
            <p className="text-[11px] text-primary mt-2 inline-flex items-center gap-1">
              <span className="material-symbols-outlined text-[14px]">check</span>
              {file.name} · {(file.size / 1024).toFixed(0)} КБ
            </p>
          )}
        </div>
        {field.hint && (
          <p className="text-[10px] text-on-surface-variant mt-1.5">{field.hint}</p>
        )}
      </div>
    )
  }

  if (field.type === 'textarea') {
    return (
      <div>
        {label}
        <textarea
          id={field.key}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          maxLength={field.maxLength}
          disabled={disabled}
          rows={3}
          className="w-full rounded-xl bg-surface-container border border-white/[0.08] text-sm text-on-surface px-3 py-2 focus:outline-none focus:border-primary/40 resize-none disabled:opacity-50"
        />
        {field.hint && (
          <p className="text-[10px] text-on-surface-variant mt-1.5">{field.hint}</p>
        )}
      </div>
    )
  }

  return (
    <div>
      {label}
      <input
        id={field.key}
        type={field.type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.placeholder}
        maxLength={field.maxLength}
        disabled={disabled}
        className="w-full rounded-xl bg-surface-container border border-white/[0.08] text-sm text-on-surface px-3 py-2 focus:outline-none focus:border-primary/40 disabled:opacity-50"
      />
      {field.hint && (
        <p className="text-[10px] text-on-surface-variant mt-1.5">{field.hint}</p>
      )}
    </div>
  )
}

// ── Data-quality report UI ──────────────────────────────────────────────────

const ISSUE_STYLE: Record<DataQualityIssue['severity'], { bg: string; text: string; icon: string }> = {
  critical: { bg: 'bg-error/10 border-error/20',       text: 'text-error',        icon: 'error' },
  high:     { bg: 'bg-error/5 border-error/15',        text: 'text-error/90',     icon: 'warning' },
  medium:   { bg: 'bg-amber-500/5 border-amber-500/20', text: 'text-amber-300',   icon: 'info' },
  low:      { bg: 'bg-white/[0.03] border-white/[0.06]', text: 'text-on-surface-variant', icon: 'info' },
  info:     { bg: 'bg-blue-500/5 border-blue-500/20',  text: 'text-blue-300',     icon: 'lightbulb' },
}

function QualityReportBlock({ report }: { report: DataQualityReport }) {
  const critical = report.issues.filter((i) => i.severity === 'critical')
  const high = report.issues.filter((i) => i.severity === 'high')
  const others = report.issues.filter((i) => i.severity !== 'critical' && i.severity !== 'high')

  return (
    <div className="rounded-xl bg-surface-container border border-white/[0.06] p-4 mt-3">
      <div className="flex items-start gap-3 pb-3 border-b border-white/[0.04]">
        <span
          className={`material-symbols-outlined text-2xl flex-shrink-0 ${
            report.ok ? 'text-primary' : 'text-error'
          }`}
        >
          {report.ok ? 'check_circle' : 'warning'}
        </span>
        <div>
          <p className="text-sm font-medium text-on-surface">
            Файл: {report.rowCount} строк, {report.columnCount} колонок
          </p>
          <p className="text-xs text-on-surface-variant mt-0.5">{report.summary}</p>
        </div>
      </div>

      {report.issues.length > 0 && (
        <ul className="space-y-2 mt-3">
          {[...critical, ...high, ...others].map((issue, i) => {
            const s = ISSUE_STYLE[issue.severity]
            const pct = issue.count != null && issue.total ? Math.round((issue.count / issue.total) * 100) : null
            return (
              <li key={i} className={`flex items-start gap-2 rounded-lg border p-2.5 text-xs ${s.bg} ${s.text}`}>
                <span className="material-symbols-outlined text-[15px] flex-shrink-0 mt-0.5">{s.icon}</span>
                <div>
                  <p>
                    {issue.message}
                    {issue.count != null && (
                      <span className="ml-1 font-mono text-[11px] opacity-80">
                        — {issue.count}{issue.total ? `/${issue.total}` : ''}{pct !== null ? ` (${pct}%)` : ''}
                      </span>
                    )}
                  </p>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <details className="mt-3">
        <summary className="text-[11px] text-on-surface-variant cursor-pointer hover:text-on-surface">
          Найденные колонки
        </summary>
        <div className="mt-2 text-[11px] text-on-surface-variant font-mono space-y-0.5">
          {Object.entries(report.detectedColumns).map(([k, v]) => (
            <div key={k}>
              <span className={v ? 'text-primary' : 'text-on-surface-variant/50'}>
                {v ? '✓' : '✗'}
              </span>{' '}
              {k} → <span className="text-on-surface">{v ?? '(не найдено)'}</span>
            </div>
          ))}
        </div>
      </details>
    </div>
  )
}
