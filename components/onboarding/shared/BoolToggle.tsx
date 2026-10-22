'use client'

import { useId } from 'react'

interface BoolToggleProps {
  label: string
  value: boolean
  onChange: (value: boolean) => void
}

/** Yes / no switch: `role="switch"` + `aria-checked`, named by its visible label. */
export function BoolToggle({ label, value, onChange }: BoolToggleProps) {
  const labelId = useId()
  return (
    <div className="flex items-center justify-between bg-surface-container rounded-xl border border-white/[0.08] px-4 py-3">
      <span id={labelId} className="text-sm text-on-surface">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-labelledby={labelId}
        onClick={() => onChange(!value)}
        className={`w-12 h-6 rounded-full transition-all flex items-center px-1 flex-shrink-0 ${
          value ? 'bg-primary' : 'bg-surface-container-high'
        }`}
      >
        <span
          aria-hidden="true"
          className={`w-4 h-4 rounded-full bg-white transition-all ${
            value ? 'translate-x-6' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  )
}
