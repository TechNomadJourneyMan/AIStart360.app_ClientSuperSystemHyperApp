'use client'

import { FIELD_NOTES } from '@/components/onboarding/constants/step-config'

/** «Зачем спрашиваем · можно пропустить» under a delicate question (step-config FIELD_NOTES). */
export function FieldNote({ fieldKey, className = '' }: { fieldKey: string; className?: string }) {
  const text = FIELD_NOTES[fieldKey]
  if (!text) return null
  return (
    <p id={`${fieldKey}-note`} className={`-mt-1 mb-2 text-[11px] leading-snug text-on-surface-variant/70 ${className}`}>
      {text}
    </p>
  )
}
