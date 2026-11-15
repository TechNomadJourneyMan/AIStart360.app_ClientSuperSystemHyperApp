/**
 * lib/format/ru-date.ts — «14 декабря 2026» for running Russian text.
 *
 * toLocaleDateString('ru-RU', { day, month: 'long', year }) appends « г.»; put
 * at the end of a sentence it gave «…2026 г..» (R2-C, product review L-2).
 * Here the suffix is dropped, so the sentence adds its own punctuation.
 * Invalid / empty → null.
 */
export function ruLongDate(value: string | Date | null | undefined, opts: { timeZone?: string } = {}): string | null {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d
    .toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', ...(opts.timeZone ? { timeZone: opts.timeZone } : {}) })
    .replace(/\s*г\.?$/u, '')
}
