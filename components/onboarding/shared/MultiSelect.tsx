'use client'

import React from 'react'
import { FieldLabel } from './FieldLabel'
import { FieldError } from './FieldError'

interface MultiSelectProps {
  label?: string
  options: string[]
  selected: string[]
  onChange: (selected: string[]) => void
  error?: string
}

export function MultiSelect({
  label,
  options,
  selected,
  onChange,
  error,
}: MultiSelectProps) {
  const toggle = (opt: string) => {
    onChange(
      selected.includes(opt)
        ? selected.filter((v) => v !== opt)
        : [...selected, opt]
    )
  }

  return (
    <div>
      {label && <FieldLabel>{label}</FieldLabel>}
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => toggle(opt)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
              selected.includes(opt)
                ? 'bg-primary/20 border-primary/50 text-primary'
                : 'bg-surface-container border-white/[0.08] text-on-surface-variant hover:border-white/20'
            }`}
          >
            {opt}
          </button>
        ))}
      </div>
      <FieldError msg={error} />
    </div>
  )
}
