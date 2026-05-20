// ============================================================
// lib/point-a/v3/blocks.ts
// The six canonical Point A v3 blocks — exact order and Russian
// labels from AIStart360_Metrics_Guide.docx.txt Part 3.
//
// Pure data. No business logic. Consumed by aggregator-v3 and
// the UI layer.
// ============================================================

import type { V3BlockDefinition, V3BlockId } from '@/types/point-a-v3'

/** Spec-ordered block definitions. */
export const V3_BLOCKS: readonly V3BlockDefinition[] = [
  {
    id: 'sales',
    order: 1,
    label_ru: 'Продажи',
    label_en: 'Sales',
    description_ru:
      'Объём, выручка, средний чек. Новые и повторные продажи — из отчёта по продажам и CRM.',
    metric_keys: ['N', 'Rev', 'AOV', 'New', 'RevNew', 'AOVnew', 'Ret', 'RevRet'],
  },
  {
    id: 'client',
    order: 2,
    label_ru: 'Клиентские метрики',
    label_en: 'Client metrics',
    description_ru:
      'Пожизненная ценность клиента, цена привлечения, цена лида, окупаемость маркетинга.',
    metric_keys: ['LTV', 'CAC', 'CPL', 'LTV_CAC', 'ROMI'],
  },
  {
    id: 'retention',
    order: 3,
    label_ru: 'Удержание и активность базы',
    label_en: 'Retention & base activity',
    description_ru:
      'Размер базы, активные и спящие клиенты, частота, отток. Считается из базы клиентов.',
    metric_keys: [
      'TotalC',
      'Active',
      'NewY',
      'Sleep',
      'RetRate',
      'AvgPurch',
      'Freq',
      'Churn',
    ],
  },
  {
    id: 'finance',
    order: 4,
    label_ru: 'Финансы',
    label_en: 'Finance',
    description_ru:
      'P&L, маржа, EBITDA, рентабельность, структура расходов и точка безубыточности.',
    metric_keys: [
      'GrossRev',
      'GrossProfit',
      'GrossMargin',
      'EBITDA',
      'NetProfit',
      'NetMargin',
      'COGS_pct',
      'Payroll_pct',
      'Mktg_pct',
      'BEP',
    ],
  },
  {
    id: 'funnel',
    order: 5,
    label_ru: 'Воронка привлечения',
    label_en: 'Acquisition funnel',
    description_ru:
      'Лиды, конверсии, скорость ответа, no-show, opt-in. Питается из CRM и расписания.',
    metric_keys: ['Leads', 'CR1', 'CR2', 'RT', 'Missed', 'NoShow', 'OptIn'],
  },
  {
    id: 'ai_comms',
    order: 6,
    label_ru: 'AI-коммуникации',
    label_en: 'AI Communications',
    description_ru:
      'WhatsApp, рассылки, NPS, рефералы. Доступно после запуска AI-коммуникаций.',
    metric_keys: [
      'ConfRate',
      'NoShowDown',
      'FUpCR',
      'AvgReply',
      'React',
      'NPS',
      'NPSResp',
      'Ref',
    ],
  },
] as const

/** Quick map: blockId → definition. */
export const V3_BLOCK_BY_ID: Record<V3BlockId, V3BlockDefinition> = Object.freeze(
  V3_BLOCKS.reduce<Record<V3BlockId, V3BlockDefinition>>(
    (acc, b) => {
      acc[b.id] = b
      return acc
    },
    {} as Record<V3BlockId, V3BlockDefinition>,
  ),
)

/** Convenience: return the block id that owns a given metric key. */
export function blockIdForMetric(metricKey: string): V3BlockId | null {
  for (const block of V3_BLOCKS) {
    if (block.metric_keys.includes(metricKey)) return block.id
  }
  return null
}
