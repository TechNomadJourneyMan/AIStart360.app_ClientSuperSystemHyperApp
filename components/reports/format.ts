// Shared formatting + labels for the Reports hub.
// Categories are stored in English (`report_documents.category` is a Zod enum in
// app/actions/reports.ts), so they are translated for display only — the stored
// value must stay untouched.

export const REPORT_CATEGORIES = ['GRI', 'Financial', 'Growth', 'Market', 'Custom'] as const

export type ReportCategory = (typeof REPORT_CATEGORIES)[number]

export const CATEGORY_LABELS: Record<string, string> = {
  GRI: 'GRI',
  Financial: 'Финансы',
  Growth: 'Рост',
  Market: 'Рынок',
  Custom: 'Прочее',
}

export const CATEGORY_COLORS: Record<string, string> = {
  GRI: 'text-primary bg-primary/10 border-primary/20',
  Financial: 'text-secondary bg-secondary/10 border-secondary/20',
  Growth: 'text-tertiary-container bg-tertiary-container/10 border-tertiary-container/20',
  Market: 'text-on-surface-variant bg-surface-container-high border-outline-variant/30',
  Custom: 'text-on-surface bg-surface-container-high border-outline-variant/30',
}

export const FILE_ICONS: Record<string, string> = {
  pdf: 'picture_as_pdf',
  xlsx: 'table_chart',
  csv: 'csv',
  docx: 'description',
}

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
}

export function formatDate(value: string | Date): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(typeof value === 'string' ? new Date(value) : value)
}

/** Russian plural: pluralRu(1, 'документ', 'документа', 'документов') → 'документ' */
export function pluralRu(count: number, one: string, few: string, many: string): string {
  const n = Math.abs(count) % 100
  const n1 = n % 10
  if (n > 10 && n < 20) return many
  if (n1 > 1 && n1 < 5) return few
  if (n1 === 1) return one
  return many
}
