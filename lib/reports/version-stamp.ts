/**
 * lib/reports/version-stamp.ts — «Версия N · ДД.ММ.ГГГГ», the stamp a report
 * version carries on the PDF cover and footer (lib/reports/version-pdf.ts),
 * in the client cabinet, the expert bot and the /r/v link page. The date is
 * the version's creation date in the business time zone (Asia/Almaty).
 * No dependencies: safe for client components.
 */
import { BUSINESS_TIME_ZONE } from '@/lib/format/period'

/** «06.10.2026» in Asia/Almaty. */
export function versionDateLabel(at: string | Date): string {
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('ru-RU', { timeZone: BUSINESS_TIME_ZONE, day: '2-digit', month: '2-digit', year: 'numeric' }).format(d)
}

/** «Версия 3 · 06.10.2026». */
export function versionStamp(version: number, at: string | Date): string {
  return `Версия ${version} · ${versionDateLabel(at)}`
}
