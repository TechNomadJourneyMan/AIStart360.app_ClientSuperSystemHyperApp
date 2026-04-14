'use client'

interface FieldErrorProps {
  msg?: string
}

export function FieldError({ msg }: FieldErrorProps) {
  if (!msg) return null
  return <p className="text-error text-xs mt-1.5">{msg}</p>
}
