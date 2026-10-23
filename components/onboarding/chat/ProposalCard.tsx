'use client'

/**
 * «Записать в анкету» (spec §8.3): the value the server built from the
 * client's words, the words themselves, a server conversion note, what is
 * stored now. [Записать] [Исправить] [Пропустить]; «Исправить» turns the card
 * into a field of the right type with the proposed value. Nothing is written
 * until «Записать».
 */
import { useEffect, useId, useRef, useState } from 'react'
import { surveyQuestion } from '@/lib/survey/questions'
import type { ProposalDTO } from '@/lib/survey/chat/types'

const STATUS_LINE: Partial<Record<ProposalDTO['status'], string>> = {
  applying: 'Записываю…',
  applied: 'Записано',
  rejected: 'Пропущено',
  expired: 'Предложение устарело — ответьте ещё раз',
  failed: 'Не удалось записать — повторите',
}

function initialEdit(p: ProposalDTO): unknown {
  const v = p.envelope.unknown ? '' : p.envelope.value
  return v ?? ''
}

export function ProposalCard({ proposal, onApply, onReject, readOnly = false, autoFocus = false }: {
  proposal: ProposalDTO
  onApply?: (editedValue?: unknown) => void
  onReject?: () => void
  /** Staff transcript: outcome only, no buttons. */
  readOnly?: boolean
  autoFocus?: boolean
}) {
  const headingId = useId()
  const ref = useRef<HTMLDivElement>(null)
  const [editing, setEditing] = useState(false)
  const [edit, setEdit] = useState<unknown>(() => initialEdit(proposal))
  const q = surveyQuestion(proposal.key)
  const open = !readOnly && (proposal.status === 'pending' || proposal.status === 'failed')

  // Focus moves to a new card (spec §14.4).
  useEffect(() => { if (autoFocus && open) ref.current?.focus() }, [autoFocus, open])

  return (
    <div
      ref={ref}
      role="group"
      aria-labelledby={headingId}
      tabIndex={-1}
      className="mt-2 rounded-xl border border-primary/25 bg-primary/[0.05] p-3 outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      <p id={headingId} className="text-[10px] font-mono uppercase tracking-[0.12em] text-primary/80">Записать в анкету</p>
      <p className="mt-1 text-sm text-on-surface">
        <span className="text-on-surface-variant">{proposal.title}: </span>
        <strong className="font-semibold">{proposal.display}</strong>
      </p>
      {proposal.quote && <p className="mt-1 text-xs text-on-surface-variant">из вашего ответа: «{proposal.quote}»</p>}
      {proposal.note && <p className="mt-1 text-xs text-on-surface-variant">{proposal.note}</p>}
      {proposal.before && (
        <p className="mt-1 text-xs text-on-surface-variant/80">
          Сейчас записано: {proposal.before}{proposal.beforeByStaff ? ' (изменил эксперт)' : ''}
        </p>
      )}

      {editing && open && q && (
        <div className="mt-2">
          <EditField type={q.type} options={q.options ?? null} value={edit} onChange={setEdit} label={proposal.title} />
        </div>
      )}

      {open ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => onApply?.(editing ? edit : undefined)}
            className="min-h-[44px] rounded-lg bg-primary px-4 text-sm font-semibold text-[#003824] hover:opacity-90">
            Записать
          </button>
          {!editing && q && q.type !== 'bool' && (
            <button type="button" onClick={() => setEditing(true)}
              className="min-h-[44px] rounded-lg border border-white/[0.12] px-4 text-sm text-on-surface hover:bg-white/[0.04]">
              Исправить
            </button>
          )}
          <button type="button" onClick={() => onReject?.()}
            className="min-h-[44px] rounded-lg px-4 text-sm text-on-surface-variant hover:text-on-surface">
            Пропустить
          </button>
          {proposal.status === 'failed' && <span role="status" className="self-center text-xs text-error">{STATUS_LINE.failed}</span>}
        </div>
      ) : (
        <p role="status" className={`mt-2 text-xs ${proposal.status === 'applied' ? 'text-primary' : 'text-on-surface-variant'}`}>
          {STATUS_LINE[proposal.status] ?? (readOnly ? 'Ожидает ответа клиента' : '')}
        </p>
      )}
    </div>
  )
}

function EditField({ type, options, value, onChange, label }: {
  type: string
  options: ReadonlyArray<{ value: string; label: string }> | null
  value: unknown
  onChange: (v: unknown) => void
  label: string
}) {
  const cls = 'w-full rounded-lg border border-white/[0.12] bg-white/[0.03] px-3 py-2 text-base text-on-surface focus:border-primary/50 focus:outline-none'
  if (type === 'select' && options) {
    return (
      <select aria-label={label} className={cls} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    )
  }
  if (type === 'multiselect' && options) {
    const list = Array.isArray(value) ? (value as string[]) : []
    return (
      <fieldset className="flex flex-wrap gap-2">
        <legend className="sr-only">{label}</legend>
        {options.map((o) => (
          <label key={o.value} className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-white/[0.1] px-2 text-xs text-on-surface">
            <input type="checkbox" checked={list.includes(o.value)}
              onChange={(e) => onChange(e.target.checked ? [...list, o.value] : list.filter((x) => x !== o.value))} />
            {o.label}
          </label>
        ))}
      </fieldset>
    )
  }
  if (type === 'text' || type === 'longtext') {
    return <textarea aria-label={label} rows={3} className={cls} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
  }
  return <input aria-label={label} inputMode="decimal" className={cls} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
}
