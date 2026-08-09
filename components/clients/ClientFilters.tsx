'use client'

import { useId } from 'react'
import { Input } from '@/components/ui/Input'
import {
  SCORE_BAND_OPTIONS,
  clientStatusLabel,
  isClientFilterActive,
  type ClientFiltersValue,
  type ClientScoreBand,
  type ClientSort,
} from './client-shared'

// Controlled. The state lives in ClientsPanel together with the rows, so every
// control here actually narrows the table below it. Previously this component
// owned a private `search` state that nothing read and four selects without
// `onChange` — a mockup that looked like a filter bar.

const SORT_OPTIONS: ReadonlyArray<{ value: string; label: string; sort: ClientSort }> = [
  { value: 'created_desc', label: 'Сначала новые',   sort: { key: 'created', dir: 'desc' } },
  { value: 'created_asc',  label: 'Сначала старые',  sort: { key: 'created', dir: 'asc' } },
  { value: 'score_desc',   label: 'Point A ↓',       sort: { key: 'score',   dir: 'desc' } },
  { value: 'score_asc',    label: 'Point A ↑',       sort: { key: 'score',   dir: 'asc' } },
  { value: 'name_asc',     label: 'По названию',     sort: { key: 'name',    dir: 'asc' } },
]

const selectClass =
  'bg-surface-container-high border border-outline-variant/30 rounded-lg px-3 py-2 text-sm text-on-surface-variant focus:outline-none focus:border-primary/30 transition-colors'

interface ClientFiltersProps {
  value: ClientFiltersValue
  onChange: (next: ClientFiltersValue) => void
  onReset: () => void
  /** Values present in the loaded rows — not a hardcoded catalogue. */
  industries: string[]
  statuses: string[]
  /** Rows currently visible / rows loaded — shown next to «Сбросить». */
  shown: number
  total: number
  disabled?: boolean
}

export function ClientFilters({
  value,
  onChange,
  onReset,
  industries,
  statuses,
  shown,
  total,
  disabled = false,
}: ClientFiltersProps) {
  const searchId = useId()
  const active = isClientFilterActive(value)
  const sortValue =
    SORT_OPTIONS.find((o) => o.sort.key === value.sort.key && o.sort.dir === value.sort.dir)?.value ?? ''

  return (
    <div className="flex flex-col gap-3 p-4 border-b border-outline-variant/10">
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Search */}
        <div className="flex-1 max-w-sm">
          <Input
            id={searchId}
            type="search"
            placeholder="Поиск по названию, email, отрасли..."
            leftIcon="search"
            aria-label="Поиск по клиентам"
            value={value.search}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, search: e.target.value })}
          />
        </div>

        <div className="flex gap-2 flex-wrap">
          {/* Industry — built from the loaded rows */}
          <select
            className={selectClass}
            aria-label="Фильтр по отрасли"
            value={value.industry}
            disabled={disabled || industries.length === 0}
            onChange={(e) => onChange({ ...value, industry: e.target.value })}
          >
            <option value="">
              {industries.length === 0 ? 'Отрасль не указана' : 'Все отрасли'}
            </option>
            {industries.map((i) => (
              <option key={i} value={i}>{i}</option>
            ))}
          </select>

          {/* Status — real DB statuses only */}
          <select
            className={selectClass}
            aria-label="Фильтр по статусу"
            value={value.status}
            disabled={disabled || statuses.length === 0}
            onChange={(e) => onChange({ ...value, status: e.target.value })}
          >
            <option value="">Все статусы</option>
            {statuses.map((s) => (
              <option key={s} value={s}>{clientStatusLabel(s)}</option>
            ))}
          </select>

          {/* Point A band — same 0–10 scale the table renders */}
          <select
            className={selectClass}
            aria-label="Фильтр по баллу Point A"
            value={value.band}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, band: e.target.value as ClientScoreBand })}
          >
            {SCORE_BAND_OPTIONS.map((b) => (
              <option key={b.value} value={b.value}>{b.label}</option>
            ))}
          </select>

          {/* Sort */}
          <select
            className={selectClass}
            aria-label="Сортировка списка"
            value={sortValue}
            disabled={disabled}
            onChange={(e) => {
              const opt = SORT_OPTIONS.find((o) => o.value === e.target.value)
              if (opt) onChange({ ...value, sort: opt.sort })
            }}
          >
            {sortValue === '' && <option value="">Сортировка: по колонке</option>}
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>Сортировка: {o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {active && (
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs font-mono text-on-surface-variant">
            Найдено {shown} из {total}
          </span>
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center gap-1 text-xs font-mono text-primary hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 rounded"
          >
            <span className="material-symbols-outlined text-sm">filter_alt_off</span>
            Сбросить фильтры
          </button>
        </div>
      )}
    </div>
  )
}
