'use client'

import React from 'react'
import { FieldError } from './FieldError'

interface TextInputProps {
  label?: string
  name: string
  type?: 'text' | 'number' | 'date' | 'email'
  placeholder?: string
  value?: string | number
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void
  error?: string
  required?: boolean
  className?: string
  /** react-hook-form register spread — if provided, value/onChange are ignored */
  register?: any
}

export function TextInput({
  label,
  name,
  type = 'text',
  placeholder,
  value,
  onChange,
  error,
  required,
  className,
  register,
}: TextInputProps) {
  const inputProps = register
    ? { ...register(name) }
    : { name, value: value ?? '', onChange }

  return (
    <div className={className}>
      {label && (
        <label
          htmlFor={name}
          className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2"
        >
          {label}{required && ' *'}
        </label>
      )}
      <input
        id={name}
        type={type}
        placeholder={placeholder}
        {...inputProps}
        className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
      />
      <FieldError msg={error} />
    </div>
  )
}
