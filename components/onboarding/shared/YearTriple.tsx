'use client'

import React from 'react'
import { FieldLabel } from './FieldLabel'
import { TextInput } from './TextInput'

interface YearTripleProps {
  label?: string
  prefix: string
  values: Record<string, number>
  onChange: (key: string, value: number) => void
  /** react-hook-form register — if provided, values/onChange are ignored */
  register?: any
  errors?: Record<string, { message?: string }>
}

export function YearTriple({
  label,
  prefix,
  values,
  onChange,
  register,
  errors,
}: YearTripleProps) {
  return (
    <div>
      {label && <FieldLabel>{label}</FieldLabel>}
      <div className="grid grid-cols-3 gap-3">
        {['2023', '2024', '2025'].map((yr) => {
          const fieldName = `${prefix}_${yr}`
          return (
            <div key={yr}>
              <FieldLabel>{yr}</FieldLabel>
              {register ? (
                <TextInput
                  name={fieldName}
                  type="number"
                  placeholder="0"
                  register={register}
                  error={errors?.[fieldName]?.message}
                />
              ) : (
                <TextInput
                  name={fieldName}
                  type="number"
                  placeholder="0"
                  value={values[fieldName] ?? 0}
                  onChange={(e) =>
                    onChange(fieldName, Number(e.target.value) || 0)
                  }
                  error={errors?.[fieldName]?.message}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
