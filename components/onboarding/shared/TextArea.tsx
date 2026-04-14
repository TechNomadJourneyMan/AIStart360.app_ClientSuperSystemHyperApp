'use client'

import React from 'react'
import { FieldError } from './FieldError'

interface TextAreaProps {
  label?: string
  name: string
  placeholder?: string
  value?: string
  onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  error?: string
  required?: boolean
  className?: string
  rows?: number
  /** react-hook-form register spread — if provided, value/onChange are ignored */
  register?: any
}

export function TextArea({
  label,
  name,
  placeholder,
  value,
  onChange,
  error,
  required,
  className,
  rows = 4,
  register,
}: TextAreaProps) {
  const textareaProps = register
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
      <textarea
        id={name}
        placeholder={placeholder}
        rows={rows}
        {...textareaProps}
        className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
      />
      <FieldError msg={error} />
    </div>
  )
}
