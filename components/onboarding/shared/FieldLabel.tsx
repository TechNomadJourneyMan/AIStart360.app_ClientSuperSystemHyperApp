'use client'

import React from 'react'

interface FieldLabelProps {
  children: React.ReactNode
  htmlFor?: string
}

export function FieldLabel({ children, htmlFor }: FieldLabelProps) {
  return (
    <label
      htmlFor={htmlFor}
      className="block text-xs font-mono text-on-surface-variant uppercase tracking-wider mb-2"
    >
      {children}
    </label>
  )
}
