'use client'

import React from 'react'
import { FieldError } from './FieldError'

interface SelectInputProps {
  label?: string
  name: string
  value?: string
  onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void
  options: { value: string; label: string }[]
  error?: string
  placeholder?: string
  className?: string
  /** react-hook-form register spread — if provided, value/onChange are ignored */
  register?: any
}

export function SelectInput({
  label,
  name,
  value,
  onChange,
  options,
  error,
  placeholder = '— Select —',
  className,
  register,
}: SelectInputProps) {
  const selectProps = register
    ? { ...register(name) }
    : { name, value: value ?? '', onChange }

  return (
    <div className={className}>
      {label && (
        <label
          htmlFor={name}
          className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2"
        >
          {label}
        </label>
      )}
      <select
        id={name}
        {...selectProps}
        className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all appearance-none"
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <FieldError msg={error} />
    </div>
  )
}
