/**
 * What would give a metric its value — shown instead of a number when the
 * metric has none («Нет данных · нужно: анкета, шаг 7 «Лидов в месяц» ·
 * документ «маркетинговый отчёт» · расчёт: …»). Pure, client-safe.
 */
import type { CatalogItemSource } from './catalog-model'

const DOC_TYPE_LABEL: Record<string, string> = {
  pl_report: 'отчёт о прибылях и убытках (P&L)',
  balance_sheet: 'баланс',
  marketing_report: 'маркетинговый отчёт',
  crm_export: 'выгрузка CRM',
  sales_report: 'отчёт о продажах',
  client_base: 'клиентская база',
  ops_report: 'операционный отчёт',
  inventory_csv: 'складская выгрузка',
  marketplace_report: 'отчёт маркетплейса',
}

export function metricSourceHint(sources: ReadonlyArray<CatalogItemSource>): string {
  const parts: string[] = []
  for (const s of sources) {
    if (s.type === 'survey' && !s.legacy && s.step) parts.push(`анкета, шаг ${s.step}${s.label ? ` «${s.label}»` : ''}`)
    else if (s.type === 'document') parts.push(`документ: ${DOC_TYPE_LABEL[s.doc_type ?? ''] ?? 'любой отчёт'}`)
    else if (s.type === 'formula' && s.note) parts.push(`расчёт: ${s.note}`)
    else if (s.type === 'assessment') parts.push('оценка GRI')
    else if (s.type === 'missing' && s.note) parts.push(s.note)
  }
  const unique = Array.from(new Set(parts))
  return unique.length ? `Нужно: ${unique.slice(0, 3).join(' · ')}` : 'Источник для этой метрики ещё не подключён'
}
