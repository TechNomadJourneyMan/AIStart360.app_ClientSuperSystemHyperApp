'use client'

import { useEffect, useRef } from 'react'
import { autoYearUpdate } from '@/lib/survey/number-input'

/**
 * Step 1 «Выручка / год = месяц × 12» (lib/survey/number-input.ts → autoYearUpdate):
 * a cleared or «не знаю» month clears the year instead of writing 0, and a
 * year that came from elsewhere is not overwritten on the first render.
 */
export function useAutoYear(
  data: Record<string, unknown>,
  onChange: (key: string, value: unknown) => void,
  monthKey: string,
  yearKey: string,
) {
  const month = data[monthKey]
  const prev = useRef(month)
  useEffect(() => {
    // Compared by reference: a StrictMode re-run of the effect is not a change.
    const changed = prev.current !== month
    prev.current = month
    const next = autoYearUpdate(month, data[yearKey], changed)
    if (next !== undefined) onChange(yearKey, next)
    // Only the month drives the year.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month])
}
