'use client'

import React, { useId } from 'react'
import { FieldError } from './FieldError'

interface MultiSelectProps {
  label?: string
  options: string[]
  selected: string[]
  onChange: (selected: string[]) => void
  error?: string
}

/** Chips for a multi-choice question: a labelled group, each chip `aria-pressed`. */
export function MultiSelect({
  label,
  options,
  selected,
  onChange,
  error,
}: MultiSelectProps) {
  const labelId = useId()
  const toggle = (opt: string) => {
    onChange(
      selected.includes(opt)
        ? selected.filter((v) => v !== opt)
        : [...selected, opt]
    )
  }

  return (
    <div>
      {label && (
        <p id={labelId} className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2">
          {label}
        </p>
      )}
      <div role="group" aria-labelledby={label ? labelId : undefined} className="flex flex-wrap gap-2">
        {options.map((opt) => (
          <ChoiceChip key={opt} label={opt} pressed={selected.includes(opt)} onToggle={() => toggle(opt)} />
        ))}
      </div>
      <FieldError msg={error} />
    </div>
  )
}

/** One toggle chip of a multi-choice question (`aria-pressed`). */
export function ChoiceChip({ label, pressed, onToggle }: { label: string; pressed: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onToggle}
      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
        pressed
          ? 'bg-primary/20 border-primary/50 text-primary'
          : 'bg-surface-container border-white/[0.08] text-on-surface-variant hover:border-white/20'
      }`}
    >
      {label}
    </button>
  )
}
