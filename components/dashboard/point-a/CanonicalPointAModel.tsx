'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { FormEvent, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  type CanonicalPointAField,
  type CanonicalPointAValue,
  type ManualPointAContext,
  type PointAResolutionStatus,
  useCanonicalPointA,
} from '@/hooks/useCanonicalPointA'

type DisplayStatus =
  | PointAResolutionStatus
  | 'automatic'
  | 'confirmed'
  | 'manual'
  | 'survey'
  | 'stale'

const STATUS_META: Record<DisplayStatus, { label: string; icon: string; className: string }> = {
  resolved: {
    label: 'Определено',
    icon: 'check_circle',
    className: 'border-primary/20 bg-primary/[0.08] text-primary',
  },
  conflict: {
    label: 'Есть конфликт',
    icon: 'difference',
    className: 'border-error/20 bg-error/[0.08] text-error',
  },
  needs_confirmation: {
    label: 'Нужно подтверждение',
    icon: 'help',
    className: 'border-amber-400/20 bg-amber-400/[0.08] text-amber-300',
  },
  empty: {
    label: 'Нет данных',
    icon: 'remove_circle_outline',
    className: 'border-white/[0.06] bg-surface-container-high text-on-surface-variant',
  },
  automatic: {
    label: 'Найдено автоматически',
    icon: 'auto_awesome',
    className: 'border-sky-400/20 bg-sky-400/[0.08] text-sky-300',
  },
  confirmed: {
    label: 'Подтверждено',
    icon: 'verified',
    className: 'border-primary/20 bg-primary/[0.08] text-primary',
  },
  manual: {
    label: 'Введено вручную',
    icon: 'edit_note',
    className: 'border-violet-400/20 bg-violet-400/[0.08] text-violet-300',
  },
  survey: {
    label: 'Из анкеты',
    icon: 'fact_check',
    className: 'border-primary/20 bg-primary/[0.08] text-primary',
  },
  stale: {
    label: 'Устарело',
    icon: 'schedule',
    className: 'border-amber-400/20 bg-amber-400/[0.08] text-amber-300',
  },
}

const SOURCE_LABELS: Record<string, string> = {
  survey: 'Анкета',
  manual: 'Введено вручную',
  document: 'Документ',
  computed: 'Расчёт',
  external: 'Внешний источник',
}

const EVENT_LABELS: Record<string, string> = {
  created: 'Добавлено значение',
  corrected: 'Значение обновлено',
  confirmed: 'Значение подтверждено',
  conflict_detected: 'Обнаружен конфликт',
  conflict_resolved: 'Конфликт разрешён',
  source_retracted: 'Источник удалён, данные пересчитаны',
}

function normalizedConfidence(value: CanonicalPointAValue): number | null {
  if (value.confidence === null || value.confidence === undefined) return null
  const parsed = Number(value.confidence)
  if (!Number.isFinite(parsed)) return null
  return Math.round((parsed <= 1 ? parsed * 100 : parsed) * 10) / 10
}

function displayValue(value: CanonicalPointAValue | null): string {
  if (!value) return '—'
  const raw = value.normalized_value ?? value.raw_value
  if (raw === null || raw === undefined || raw === '') return '—'
  if (typeof raw === 'boolean') return raw ? 'Да' : 'Нет'
  if (typeof raw === 'number') {
    return new Intl.NumberFormat('ru-KZ', { maximumFractionDigits: 2 }).format(raw)
  }
  if (Array.isArray(raw)) return raw.map(String).join(', ')
  if (typeof raw === 'object') return JSON.stringify(raw)
  return String(raw)
}

function valueSuffix(value: CanonicalPointAValue | null): string {
  if (!value) return ''
  const parts = [value.unit, value.currency].filter(Boolean)
  return parts.length ? ` ${parts.join(' · ')}` : ''
}

function sourceName(value: CanonicalPointAValue): string {
  const source = value.point_a_sources
  if (!source) return SOURCE_LABELS[value.extraction_kind] ?? 'Источник не указан'
  return source.source_name || SOURCE_LABELS[source.source_type] || 'Источник данных'
}

function periodLabel(value: CanonicalPointAValue): string | null {
  if (value.period_quarter && value.period_year) return `${value.period_quarter} ${value.period_year}`
  if (value.period_year) return String(value.period_year)
  if (value.period_key && value.period_key !== 'current') return value.period_key
  return null
}

function updatedAtLabel(value: string | null | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('ru-KZ', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function valueDisplayStatus(field: CanonicalPointAField): DisplayStatus {
  if (field.resolutionStatus !== 'resolved') return field.resolutionStatus
  const selected = field.selected
  if (!selected) return 'empty'
  if (selected.status === 'confirmed') return 'confirmed'
  const updatedAt = new Date(field.updatedAt ?? selected.updated_at).getTime()
  if (
    Number.isFinite(updatedAt)
    && Date.now() - updatedAt > 365 * 24 * 60 * 60 * 1000
    && (selected.period_key === 'current' || !selected.period_year)
  ) return 'stale'
  const sourceType = selected.point_a_sources?.source_type
  if (sourceType === 'manual') return 'manual'
  if (sourceType === 'survey') return 'survey'
  if (
    sourceType === 'document'
    || ['ocr', 'text', 'table'].includes(selected.extraction_kind)
  ) return 'automatic'
  return 'resolved'
}

function StatusBadge({ status }: { status: DisplayStatus }) {
  const meta = STATUS_META[status]
  return (
    <span className={`inline-flex items-center gap-1 rounded-xl border px-2.5 py-1 text-[10px] font-mono ${meta.className}`}>
      <span className="material-symbols-outlined text-[13px]">{meta.icon}</span>
      {meta.label}
    </span>
  )
}

function Confidence({ value }: { value: CanonicalPointAValue }) {
  const confidence = normalizedConfidence(value)
  if (confidence === null) return null
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-mono text-on-surface-variant">
      <span className="material-symbols-outlined text-[13px] text-primary/70">analytics</span>
      Уверенность {confidence}%
    </span>
  )
}

function ManualValueForm({
  fieldKey,
  initialValue,
  busy,
  context,
  onSave,
  onCancel,
}: {
  fieldKey: string
  initialValue: string
  busy: boolean
  context?: ManualPointAContext
  onSave: (fieldKey: string, value: string, context?: ManualPointAContext) => Promise<boolean>
  onCancel: () => void
}) {
  const [value, setValue] = useState(initialValue)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!value.trim()) return
    if (await onSave(fieldKey, value.trim(), context)) onCancel()
  }

  return (
    <motion.form
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      onSubmit={submit}
      className="overflow-hidden"
    >
      <div className="mt-4 rounded-xl border border-primary/20 bg-primary/[0.04] p-3">
        <label htmlFor={`manual-${fieldKey}`} className="mb-2 block text-[10px] font-mono uppercase tracking-[0.2em] text-primary/70">
          Значение вручную
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id={`manual-${fieldKey}`}
            autoFocus
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="Введите фактическое значение"
            className="min-w-0 flex-1 rounded-xl border border-white/[0.08] bg-surface-container px-3 py-2.5 text-sm text-on-surface outline-none placeholder:text-on-surface-variant/50 focus:border-primary/40 focus:ring-2 focus:ring-primary/20"
          />
          <button
            type="submit"
            disabled={busy || !value.trim()}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-[#003824] transition-transform hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
          >
            <span className={`material-symbols-outlined text-base ${busy ? 'animate-spin' : ''}`}>
              {busy ? 'progress_activity' : 'save'}
            </span>
            Сохранить
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-white/[0.08] px-3 py-2.5 text-xs text-on-surface-variant hover:text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            Отмена
          </button>
        </div>
      </div>
    </motion.form>
  )
}

function CandidateCard({
  candidate,
  selected,
  selectable,
  onSelect,
}: {
  candidate: CanonicalPointAValue
  selected: boolean
  selectable?: boolean
  onSelect?: () => void
}) {
  const confidence = normalizedConfidence(candidate)
  const period = periodLabel(candidate)
  return (
    <button
      type="button"
      disabled={!selectable}
      onClick={onSelect}
      className={`w-full rounded-xl border p-3 text-left transition-all ${
        selected
          ? 'border-primary/40 bg-primary/[0.08]'
          : 'border-white/[0.06] bg-surface-container hover:border-primary/20'
      } ${selectable ? 'cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/30' : 'cursor-default'}`}
    >
      <div className="flex items-start gap-3">
        {selectable && (
          <span className={`mt-1 h-4 w-4 flex-shrink-0 rounded-full border ${
            selected ? 'border-primary bg-primary shadow-[inset_0_0_0_3px_#0A0B0F]' : 'border-white/20'
          }`} />
        )}
        <div className="min-w-0 flex-1">
          <p className="break-words font-mono text-sm font-semibold text-on-surface">
            {displayValue(candidate)}{valueSuffix(candidate)}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-mono text-on-surface-variant">
            <span className="inline-flex items-center gap-1">
              <span className="material-symbols-outlined text-[13px] text-primary/70">source</span>
              {sourceName(candidate)}
            </span>
            {confidence !== null && <span>Уверенность {confidence}%</span>}
            {period && <span>{period}</span>}
            {updatedAtLabel(candidate.updated_at) && (
              <span>Обновлено {updatedAtLabel(candidate.updated_at)}</span>
            )}
          </div>
          {candidate.source_fragment && (
            <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-on-surface-variant">
              «{candidate.source_fragment}»
            </p>
          )}
        </div>
      </div>
    </button>
  )
}

function FieldHistory({ fieldKey }: { fieldKey: string }) {
  const [events, setEvents] = useState<Array<{
    id: string
    event_type: string
    created_at: string
  }> | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void fetch(`/api/v1/point-a/fields/${encodeURIComponent(fieldKey)}/history`, {
      credentials: 'include',
      cache: 'no-store',
    })
      .then(async (response) => {
        const payload = await response.json() as {
          events?: Array<{ id: string; event_type: string; created_at: string }>
          error?: string
        }
        if (!response.ok) throw new Error(payload.error ?? 'Не удалось загрузить историю')
        if (active) setEvents(payload.events ?? [])
      })
      .catch((requestError) => {
        if (active) setError(requestError instanceof Error ? requestError.message : 'Ошибка истории')
      })
    return () => {
      active = false
    }
  }, [fieldKey])

  if (error) return <p role="alert" className="mt-3 text-xs text-error">{error}</p>
  if (!events) {
    return <p className="mt-3 text-xs text-on-surface-variant">Загружаем историю…</p>
  }
  return (
    <ol className="mt-3 space-y-2 rounded-xl border border-white/[0.05] bg-surface-container p-3">
      {events.length === 0 && (
        <li className="text-xs text-on-surface-variant">Изменений пока нет.</li>
      )}
      {events.slice(0, 10).map((event) => (
        <li key={event.id} className="flex items-start justify-between gap-3 text-xs">
          <span className="text-on-surface">
            {EVENT_LABELS[event.event_type] ?? event.event_type}
          </span>
          <time className="shrink-0 font-mono text-[10px] text-on-surface-variant">
            {updatedAtLabel(event.created_at)}
          </time>
        </li>
      ))}
    </ol>
  )
}

function FieldCard({
  field,
  pendingAction,
  onManual,
  onConfirm,
}: {
  field: CanonicalPointAField
  pendingAction: string | null
  onManual: (fieldKey: string, value: string, context?: ManualPointAContext) => Promise<boolean>
  onConfirm: (valueId: string) => Promise<boolean>
}) {
  const [editing, setEditing] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const selected = field.selected
  const canConfirm = selected && (
    field.resolutionStatus === 'needs_confirmation'
    || selected.status === 'needs_confirmation'
    || selected.status === 'detected'
  )

  return (
    <motion.article
      layout
      whileHover={{ scale: 1.005 }}
      className="rounded-2xl border border-white/[0.04] bg-surface-container-low p-4 shadow-card"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-primary/70">{field.section}</p>
          <h3 className="mt-1 text-sm font-semibold text-on-surface">{field.label}</h3>
        </div>
        <StatusBadge status={valueDisplayStatus(field)} />
      </div>

      <div className="mt-4">
        <p className="break-words font-mono text-xl font-bold text-on-surface">
          {displayValue(selected)}{valueSuffix(selected)}
        </p>
        {selected ? (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1 text-[10px] font-mono text-on-surface-variant">
              <span className="material-symbols-outlined text-[13px] text-primary/70">source</span>
              {sourceName(selected)}
            </span>
            <Confidence value={selected} />
            {periodLabel(selected) && (
              <span className="text-[10px] font-mono text-on-surface-variant">{periodLabel(selected)}</span>
            )}
            {updatedAtLabel(field.updatedAt ?? selected.updated_at) && (
              <span className="text-[10px] font-mono text-on-surface-variant">
                Обновлено {updatedAtLabel(field.updatedAt ?? selected.updated_at)}
              </span>
            )}
          </div>
        ) : (
          <p className="mt-1 text-xs text-on-surface-variant">Добавьте значение, чтобы включить поле в Точку А.</p>
        )}
        {selected?.source_fragment && (
          <p className="mt-3 line-clamp-3 rounded-xl border border-white/[0.05] bg-surface-container px-3 py-2 text-xs leading-relaxed text-on-surface-variant">
            «{selected.source_fragment}»
          </p>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2 border-t border-white/[0.04] pt-3">
        {canConfirm && (
          <button
            type="button"
            onClick={() => void onConfirm(selected.id)}
            disabled={pendingAction === `confirm:${selected.id}`}
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-bold text-[#003824] hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
          >
            <span className={`material-symbols-outlined text-base ${
              pendingAction === `confirm:${selected.id}` ? 'animate-spin' : ''
            }`}>
              {pendingAction === `confirm:${selected.id}` ? 'progress_activity' : 'verified'}
            </span>
            Подтвердить
          </button>
        )}
        <button
          type="button"
          onClick={() => setEditing((current) => !current)}
          aria-expanded={editing}
          className="inline-flex items-center gap-1.5 rounded-xl border border-white/[0.08] px-3 py-2 text-xs text-on-surface-variant hover:border-primary/30 hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          <span className="material-symbols-outlined text-base">edit</span>
          {selected ? 'Изменить вручную' : 'Добавить вручную'}
        </button>
        <button
          type="button"
          onClick={() => setHistoryOpen((current) => !current)}
          aria-expanded={historyOpen}
          className="inline-flex items-center gap-1.5 rounded-xl border border-white/[0.08] px-3 py-2 text-xs text-on-surface-variant hover:border-primary/30 hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          <span className="material-symbols-outlined text-base">history</span>
          История
        </button>
        {selected?.point_a_sources?.source_type === 'document'
          && selected.point_a_sources.native_source_id && (
          <Link
            href={`/client/onboarding/documents?document=${encodeURIComponent(selected.point_a_sources.native_source_id)}`}
            className="inline-flex items-center gap-1.5 rounded-xl border border-white/[0.08] px-3 py-2 text-xs text-on-surface-variant hover:border-primary/30 hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <span className="material-symbols-outlined text-base">description</span>
            Открыть источник
          </Link>
        )}
      </div>

      <AnimatePresence initial={false}>
        {editing && (
          <ManualValueForm
            fieldKey={field.fieldKey}
            initialValue={selected ? displayValue(selected) : ''}
            busy={pendingAction === `manual:${field.fieldKey}`}
            context={selected ? {
              unit: selected.unit,
              currency: selected.currency,
              period: selected.period_key,
              periodYear: selected.period_year,
              periodQuarter: selected.period_quarter,
              periodMonth: selected.period_month,
              scenario: selected.scenario,
            } : undefined}
            onSave={onManual}
            onCancel={() => setEditing(false)}
          />
        )}
      </AnimatePresence>
      {historyOpen && <FieldHistory fieldKey={field.fieldKey} />}
    </motion.article>
  )
}

function ConflictCard({
  conflict,
  pendingAction,
  onResolve,
}: {
  conflict: CanonicalPointAField
  pendingAction: string | null
  onResolve: (conflictId: string, valueId: string) => Promise<boolean>
}) {
  const conflictId = conflict.resolutionId ?? conflict.conflictId ?? conflict.id ?? conflict.fieldKey
  const [selectedId, setSelectedId] = useState(conflict.selected?.id ?? conflict.candidates[0]?.id ?? '')
  const busy = pendingAction === `resolve:${conflictId}`
  useEffect(() => {
    const stillExists = conflict.candidates.some((candidate) => candidate.id === selectedId)
    if (!stillExists) {
      setSelectedId(conflict.selected?.id ?? conflict.candidates[0]?.id ?? '')
    }
  }, [conflict.candidates, conflict.selected?.id, selectedId])

  return (
    <article className="glass-card rounded-2xl border border-error/20 p-4 shadow-card">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-error/80">{conflict.section}</p>
          <h3 className="mt-1 font-headline text-base font-bold text-on-surface">{conflict.label}</h3>
          <p className="mt-1 text-xs text-on-surface-variant">
            Источники расходятся. Выберите фактическое значение.
          </p>
        </div>
        <StatusBadge status="conflict" />
      </div>

      <div
        role="radiogroup"
        aria-label={`Выберите значение для поля ${conflict.label}`}
        className="mt-4 grid gap-2 lg:grid-cols-2"
      >
        {conflict.candidates.map((candidate) => (
          <div key={candidate.id} role="radio" aria-checked={selectedId === candidate.id}>
            <CandidateCard
              candidate={candidate}
              selected={selectedId === candidate.id}
              selectable
              onSelect={() => setSelectedId(candidate.id)}
            />
            {candidate.point_a_sources?.source_type === 'document'
              && candidate.point_a_sources.native_source_id && (
              <Link
                href={`/client/onboarding/documents?document=${encodeURIComponent(candidate.point_a_sources.native_source_id)}`}
                className="mt-1 inline-flex items-center gap-1 px-2 text-[10px] font-mono text-primary/80 hover:text-primary"
              >
                <span className="material-symbols-outlined text-sm">description</span>
                Открыть источник
              </Link>
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          disabled={!selectedId || busy}
          onClick={() => void onResolve(conflictId, selectedId)}
          className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-[#003824] transition-transform hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
        >
          <span className={`material-symbols-outlined text-base ${busy ? 'animate-spin' : ''}`}>
            {busy ? 'progress_activity' : 'rule'}
          </span>
          Принять выбранное
        </button>
      </div>
    </article>
  )
}

function LoadingState() {
  return (
    <section className="rounded-2xl border border-white/[0.04] bg-surface-container-low p-5 shadow-card">
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 animate-pulse rounded-xl bg-surface-container-high" />
        <div className="flex-1 space-y-2">
          <div className="h-3 w-36 animate-pulse rounded bg-surface-container-high" />
          <div className="h-6 w-64 max-w-full animate-pulse rounded bg-surface-container-high" />
        </div>
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-2">
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="h-40 animate-pulse rounded-2xl bg-surface-container" />
        ))}
      </div>
    </section>
  )
}

export default function CanonicalPointAModel() {
  const {
    model,
    isLoading,
    error,
    pendingAction,
    refresh,
    setManualValue,
    confirmValue,
    resolveConflict,
  } = useCanonicalPointA()
  const [showAll, setShowAll] = useState(false)

  const visibleFields = useMemo(() => {
    if (!model) return []
    const conflictKeys = new Set(model.conflicts.map((item) => item.resolutionId))
    const fields = model.fields.filter((item) => !conflictKeys.has(item.resolutionId))
    return showAll ? fields : fields.slice(0, 8)
  }, [model, showAll])

  const missingFields = useMemo<CanonicalPointAField[]>(() => (
    (model?.missing ?? []).map((field) => ({
      ...field,
      selected: null,
      candidates: [],
      resolutionStatus: 'empty',
      updatedAt: null,
    }))
  ), [model?.missing])

  if (isLoading) return <LoadingState />

  if (!model) {
    return (
      <section className="rounded-2xl border border-white/[0.04] bg-surface-container-low p-6 text-center shadow-card">
        <span className="material-symbols-outlined text-3xl text-on-surface-variant">database_off</span>
        <h2 className="mt-3 font-headline text-lg font-bold text-on-surface">Каноническая Точка А пока недоступна</h2>
        <p className="mx-auto mt-1 max-w-lg text-sm text-on-surface-variant">
          Обновите данные анкеты или загрузите документы, затем попробуйте снова.
        </p>
        {error && <p className="mt-3 text-xs text-error">{error}</p>}
        <button
          type="button"
          onClick={() => void refresh()}
          className="mt-4 inline-flex items-center gap-1.5 rounded-xl border border-primary/30 px-4 py-2 text-xs text-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          <span className="material-symbols-outlined text-base">refresh</span>
          Обновить
        </button>
      </section>
    )
  }

  const completion = Math.max(0, Math.min(100, Math.round(model.completion)))
  const unresolved = model.conflicts.length
  const missing = model.missing.length

  return (
    <section id="canonical-point-a" aria-labelledby="canonical-point-a-title" className="space-y-4 scroll-mt-24">
      <div className="rounded-2xl border border-white/[0.04] bg-surface-container-low p-5 shadow-card">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
            <p className="text-xs font-mono uppercase tracking-[0.2em] text-primary/70">
              Единая модель данных
            </p>
            <h2 id="canonical-point-a-title" className="mt-2 font-headline text-2xl font-extrabold text-on-surface">
              Каноническая Точка А
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">
              Факты из анкеты, документов и ручных уточнений собраны в одном месте.
              Подтвердите спорные значения — они станут основой аналитики и рекомендаций.
            </p>
          </div>

          <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 rounded-2xl border border-primary/15 bg-primary/[0.04] p-4">
            <div className="relative row-span-2 flex h-16 w-16 items-center justify-center rounded-full bg-surface-container">
              <div
                className="absolute inset-0 rounded-full"
                style={{ background: `conic-gradient(#6effc0 ${completion * 3.6}deg, rgba(255,255,255,.06) 0deg)` }}
              />
              <div className="absolute inset-[5px] rounded-full bg-surface-container" />
              <span className="relative font-mono text-base font-bold text-on-surface">{completion}%</span>
            </div>
            <p className="self-end text-xs font-mono uppercase tracking-[0.16em] text-primary/70">Полнота данных</p>
            <p className="self-start text-xs text-on-surface-variant">
              {unresolved > 0 ? `${unresolved} конфликтов` : 'Конфликтов нет'} · {missing > 0 ? `${missing} полей не заполнено` : 'Все ключевые поля заполнены'}
            </p>
          </div>
        </div>

        {error && (
          <div role="alert" className="mt-4 flex items-center gap-2 rounded-xl border border-error/20 bg-error/[0.06] px-3 py-2.5">
            <span className="material-symbols-outlined text-base text-error">error</span>
            <p className="flex-1 text-xs text-error">{error}</p>
            <button type="button" onClick={() => void refresh()} className="text-xs font-mono text-on-surface hover:text-primary">
              Повторить
            </button>
          </div>
        )}
      </div>

      {(model.recentChanges ?? []).length > 0 && (
        <div className="rounded-2xl border border-white/[0.04] bg-surface-container-low p-5 shadow-card">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="font-headline text-lg font-bold text-on-surface">Последние изменения</h3>
              <p className="mt-0.5 text-xs text-on-surface-variant">
                Общая история анкеты, документов и ручных уточнений
              </p>
            </div>
            <span className="material-symbols-outlined text-xl text-primary/70">history</span>
          </div>
          <ol className="mt-4 divide-y divide-white/[0.04]">
            {(model.recentChanges ?? []).slice(0, 8).map((change) => (
              <li key={change.id} className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="text-sm text-on-surface">
                    {EVENT_LABELS[change.eventType] ?? change.eventType}
                  </p>
                  <p className="mt-0.5 truncate text-[10px] font-mono text-on-surface-variant">
                    {change.fieldKey}
                  </p>
                </div>
                <time className="shrink-0 text-[10px] font-mono text-on-surface-variant">
                  {updatedAtLabel(change.createdAt)}
                </time>
              </li>
            ))}
          </ol>
        </div>
      )}

      {model.conflicts.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-headline text-lg font-bold text-on-surface">Требуют решения</h3>
            <span className="rounded-xl border border-error/20 bg-error/[0.06] px-2.5 py-1 text-[10px] font-mono text-error">
              {model.conflicts.length}
            </span>
          </div>
          {model.conflicts.map((conflict) => (
            <ConflictCard
              key={conflict.resolutionId ?? `${conflict.fieldKey}:${conflict.periodKey ?? ''}:${conflict.scenario ?? 'fact'}`}
              conflict={conflict}
              pendingAction={pendingAction}
              onResolve={resolveConflict}
            />
          ))}
        </div>
      )}

      <div>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h3 className="font-headline text-lg font-bold text-on-surface">Проверенные факты</h3>
            <p className="mt-0.5 text-xs text-on-surface-variant">Значение, источник и уровень уверенности</p>
          </div>
          <span className="text-xs font-mono text-on-surface-variant">{model.fields.length} полей</span>
        </div>
        <motion.div layout className="grid gap-3 md:grid-cols-2">
          <AnimatePresence initial={false}>
            {visibleFields.map((field) => (
              <FieldCard
                key={field.resolutionId ?? `${field.fieldKey}:${field.periodKey ?? ''}:${field.scenario ?? 'fact'}`}
                field={field}
                pendingAction={pendingAction}
                onManual={setManualValue}
                onConfirm={confirmValue}
              />
            ))}
          </AnimatePresence>
        </motion.div>

        {model.fields.length > 8 && (
          <button
            type="button"
            onClick={() => setShowAll((current) => !current)}
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-white/[0.06] bg-surface-container-low py-3 text-xs font-mono text-on-surface-variant hover:border-primary/20 hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            {showAll ? 'Свернуть' : `Показать все поля (${model.fields.length})`}
            <span className="material-symbols-outlined text-base">{showAll ? 'expand_less' : 'expand_more'}</span>
          </button>
        )}
      </div>

      {missingFields.length > 0 && (
        <div>
          <div className="mb-3">
            <h3 className="font-headline text-lg font-bold text-on-surface">Пробелы в данных</h3>
            <p className="mt-0.5 text-xs text-on-surface-variant">
              Заполните вручную или добавьте документ с нужными показателями
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {missingFields.map((field) => (
              <FieldCard
                key={field.fieldKey}
                field={field}
                pendingAction={pendingAction}
                onManual={setManualValue}
                onConfirm={confirmValue}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
