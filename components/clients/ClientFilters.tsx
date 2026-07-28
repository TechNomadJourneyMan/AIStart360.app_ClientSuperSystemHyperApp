'use client'

import { Input } from '@/components/ui/Input'
import {
  DEFAULT_CLIENT_DIRECTORY_FILTERS,
  type ClientDirectoryFilters,
  type ClientDirectorySort,
} from '@/lib/client-directory'

interface ClientFiltersProps {
  filters: ClientDirectoryFilters
  industries: string[]
  disabled?: boolean
  resultCount?: number
  totalCount?: number
  onChange: (filters: ClientDirectoryFilters) => void
}

const selectClass =
  'rounded-lg border border-outline-variant/30 bg-surface-container-high px-3 py-2 text-sm text-on-surface-variant transition-colors focus:border-primary/30 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50'

export function ClientFilters({
  filters,
  industries,
  disabled = false,
  resultCount,
  totalCount,
  onChange,
}: ClientFiltersProps) {
  const update = <Key extends keyof ClientDirectoryFilters>(
    key: Key,
    value: ClientDirectoryFilters[Key],
  ) => {
    onChange({ ...filters, [key]: value })
  }

  const hasActiveFilters =
    Boolean(filters.search.trim()) ||
    Boolean(filters.industry) ||
    Boolean(filters.status) ||
    filters.sort !== DEFAULT_CLIENT_DIRECTORY_FILTERS.sort

  const visibleIndustries = filters.industry && !industries.includes(filters.industry)
    ? [filters.industry, ...industries]
    : industries

  return (
    <div className="space-y-3 border-b border-outline-variant/10 p-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
        <div className="max-w-md flex-1">
          <Input
            aria-label="Поиск клиентов"
            placeholder="Название, email или отрасль..."
            leftIcon="search"
            value={filters.search}
            disabled={disabled}
            onChange={(event) => update('search', event.target.value)}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <select
            aria-label="Фильтр по отрасли"
            value={filters.industry}
            disabled={disabled}
            onChange={(event) => update('industry', event.target.value)}
            className={selectClass}
          >
            <option value="">Все отрасли</option>
            {visibleIndustries.map((industry) => (
              <option key={industry} value={industry}>{industry}</option>
            ))}
          </select>

          <select
            aria-label="Фильтр по статусу"
            value={filters.status}
            disabled={disabled}
            onChange={(event) => update('status', event.target.value)}
            className={selectClass}
          >
            <option value="">Все статусы</option>
            <option value="approved">Активные</option>
            <option value="pending_approval">Ожидают подтверждения</option>
            <option value="requires_clarification">Требуют уточнения</option>
          </select>

          <select
            aria-label="Сортировка клиентов"
            value={filters.sort}
            disabled={disabled}
            onChange={(event) => update('sort', event.target.value as ClientDirectorySort)}
            className={selectClass}
          >
            <option value="gri-desc">Point A: по убыванию</option>
            <option value="gri-asc">Point A: по возрастанию</option>
            <option value="name">По названию</option>
          </select>
        </div>
      </div>

      <div className="flex min-h-6 flex-wrap items-center justify-between gap-2">
        {typeof resultCount === 'number' && typeof totalCount === 'number' ? (
          <p aria-live="polite" className="text-xs font-mono text-on-surface-variant">
            Найдено {resultCount} из {totalCount}
          </p>
        ) : <span />}

        {hasActiveFilters && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(DEFAULT_CLIENT_DIRECTORY_FILTERS)}
            className="text-xs font-mono text-primary transition-colors hover:underline disabled:cursor-not-allowed disabled:opacity-50"
          >
            Сбросить фильтры
          </button>
        )}
      </div>
    </div>
  )
}
