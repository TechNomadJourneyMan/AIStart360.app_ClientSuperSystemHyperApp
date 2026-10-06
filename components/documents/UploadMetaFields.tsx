'use client'

import { DOCUMENT_TYPE_GROUPS, DOCUMENT_TYPE_LABELS } from '@/lib/documents/doc-type-labels'
import { isDocumentType, type DocumentTypeValue } from '@/lib/documents/doc-types'
import type { UploadOptions } from '@/lib/documents/client-upload'

type Quarter = 'Q1' | 'Q2' | 'Q3' | 'Q4'

export interface UploadMeta {
  docType: DocumentTypeValue | ''
  quarter: Quarter | ''
  year: string
}

/** Server accepts period years 2020–2030. */
const MIN_YEAR = 2020
const MAX_YEAR = 2030

export function periodYears(now: Date = new Date()): number[] {
  const top = Math.min(now.getFullYear(), MAX_YEAR)
  const out: number[] = []
  for (let y = top; y >= MIN_YEAR; y -= 1) out.push(y)
  return out
}

export function emptyUploadMeta(): UploadMeta {
  return { docType: '', quarter: '', year: '' }
}

/** Upload options from the form; null while no document type is chosen. */
export function uploadMetaToOptions(meta: UploadMeta): Pick<UploadOptions, 'docType' | 'period'> | null {
  if (!meta.docType || !isDocumentType(meta.docType)) return null
  const year = meta.year ? Number(meta.year) : null
  return {
    docType: meta.docType,
    period: meta.quarter || year ? { quarter: meta.quarter || null, year } : null,
  }
}

const SELECT_CLASS =
  'w-full bg-surface-container border border-white/[0.08] rounded-xl px-3 py-2.5 text-sm text-on-surface ' +
  'focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/40 disabled:opacity-50 appearance-none'

const LABEL_CLASS = 'block text-[10px] font-mono text-on-surface-variant uppercase tracking-widest mb-1.5'

/**
 * Document type (required, explicit choice — never guessed) and an optional
 * period. Values come from lib/documents/doc-types.ts via doc-type-labels.
 */
export function UploadMetaFields({
  value,
  onChange,
  disabled,
  idPrefix = 'doc-upload',
}: {
  value: UploadMeta
  onChange: (next: UploadMeta) => void
  disabled?: boolean
  idPrefix?: string
}) {
  return (
    <div className="space-y-3">
      <div>
        <label htmlFor={`${idPrefix}-type`} className={LABEL_CLASS}>Тип документа *</label>
        <select
          id={`${idPrefix}-type`}
          value={value.docType}
          disabled={disabled}
          required
          onChange={(e) => onChange({ ...value, docType: isDocumentType(e.target.value) ? e.target.value : '' })}
          className={SELECT_CLASS}
        >
          <option value="">— Выберите тип —</option>
          {DOCUMENT_TYPE_GROUPS.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.types.map((t) => (
                <option key={t} value={t}>{DOCUMENT_TYPE_LABELS[t]}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={`${idPrefix}-quarter`} className={LABEL_CLASS}>Квартал</label>
          <select
            id={`${idPrefix}-quarter`}
            value={value.quarter}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, quarter: e.target.value as UploadMeta['quarter'] })}
            className={SELECT_CLASS}
          >
            <option value="">Не указан</option>
            {(['Q1', 'Q2', 'Q3', 'Q4'] as const).map((q) => <option key={q} value={q}>{q}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={`${idPrefix}-year`} className={LABEL_CLASS}>Год</label>
          <select
            id={`${idPrefix}-year`}
            value={value.year}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, year: e.target.value })}
            className={SELECT_CLASS}
          >
            <option value="">Не указан</option>
            {periodYears().map((y) => <option key={y} value={String(y)}>{y}</option>)}
          </select>
        </div>
      </div>
    </div>
  )
}
