'use client'

import { useEffect, useRef, useState } from 'react'
import { useDebounce } from '@/hooks/useDebounce'
import {
  METRIC_SEARCH_DEBOUNCE_MS,
  METRIC_SEARCH_PLACEHOLDER,
} from './_utils'

export interface MetricSearchBoxProps {
  value: string
  onChange: (next: string) => void
  placeholder?: string
  resultsCount?: number
  autoFocus?: boolean
}

/**
 * MetricSearchBox
 * Debounced search input for the /metrics catalog.
 * - Cmd/Ctrl+K focuses the input.
 * - onChange fires only after the 300ms debounce settles.
 * - Renders an optional results-count badge and a clear button.
 */
export function MetricSearchBox({
  value,
  onChange,
  placeholder = METRIC_SEARCH_PLACEHOLDER,
  resultsCount,
  autoFocus,
}: MetricSearchBoxProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [draft, setDraft] = useState<string>(value)
  const debounced = useDebounce(draft, METRIC_SEARCH_DEBOUNCE_MS)
  const lastEmitted = useRef<string>(value)

  // Sync local draft when parent value changes externally (e.g. reset).
  useEffect(() => {
    if (value !== lastEmitted.current) {
      setDraft(value)
      lastEmitted.current = value
    }
  }, [value])

  // Emit debounced changes upward.
  useEffect(() => {
    if (debounced !== lastEmitted.current) {
      lastEmitted.current = debounced
      onChange(debounced)
    }
  }, [debounced, onChange])

  // Global Cmd/Ctrl+K focus shortcut. Ignored while a modal is open — pulling
  // focus out of a dialog would break its focus trap.
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      const isShortcut =
        (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k'
      if (!isShortcut) return
      if (document.querySelector('[role="dialog"]')) return
      event.preventDefault()
      inputRef.current?.focus()
      inputRef.current?.select()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [])

  const handleClear = () => {
    setDraft('')
    lastEmitted.current = ''
    onChange('')
    inputRef.current?.focus()
  }

  return (
    <div className="relative flex items-center bg-surface-container border border-white/[0.04] rounded-xl px-4 py-2.5 hover:border-primary/30 focus-within:border-primary/60 transition-colors">
      <span
        aria-hidden="true"
        className="material-symbols-outlined text-on-surface-variant text-xl mr-3"
      >
        search
      </span>
      <input
        ref={inputRef}
        type="search"
        aria-label="Поиск метрик"
        autoFocus={autoFocus}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder={placeholder}
        className="bg-transparent text-on-surface placeholder:text-on-surface-variant flex-1 outline-none text-sm"
      />
      {typeof resultsCount === 'number' && (
        <span
          aria-live="polite"
          className="ml-3 text-xs font-mono text-primary/70 bg-primary/10 rounded-md px-2 py-0.5 whitespace-nowrap"
        >
          {resultsCount} найдено
        </span>
      )}
      {draft !== '' && (
        <button
          type="button"
          aria-label="Очистить поиск"
          onClick={handleClear}
          className="ml-2 flex items-center justify-center h-6 w-6 rounded-md text-on-surface-variant hover:text-on-surface hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-colors"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-base">
            close
          </span>
        </button>
      )}
    </div>
  )
}

export default MetricSearchBox
