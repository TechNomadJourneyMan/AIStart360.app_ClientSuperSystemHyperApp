import { describe, expect, it } from 'vitest'
import {
  buildPointADocumentContext,
  enrichSurveyAnswersWithDocuments,
} from '@/lib/documents/point-a-context'

describe('document → Point A context', () => {
  it('turns persisted raw table rows and fields into Point A metrics', () => {
    const context = buildPointADocumentContext([{
      id: 'doc-1',
      docType: 'sales_report',
      parsedData: {
        raw_rows: [
          { client_id: 'a', amount: 100, occurred_at: '2025-01-01' },
          { client_id: 'a', amount: 50, occurred_at: '2025-02-01' },
          { client_id: 'b', amount: 200, occurred_at: '2025-01-02' },
        ],
        fields: [
          { key: 'net_profit', value: 70, confidence: 0.9 },
          { key: 'marketing_budget', value: 30, confidence: 0.8 },
        ],
      },
    }])

    expect(context.sales_count).toBe(3)
    expect(context.revenue_total).toBe(350)
    expect(context.new_clients_count).toBe(2)
    expect(context.repeat_purchases_count).toBe(1)
    expect(context.revenue_from_new).toBe(300)
    expect(context.revenue_from_repeat).toBe(50)
    expect(context.net_profit).toBe(70)
    expect(context.marketing_budget).toBe(30)
  })

  it('preserves manual survey values and fills only missing values', () => {
    const enriched = enrichSurveyAnswersWithDocuments(
      { s2_avg_check: 999, s9n_net_profit: '' },
      {
        revenue_total: 300,
        sales_count: 3,
        new_clients_count: 2,
        marketing_budget: 60,
        net_profit: 50,
      },
    )

    expect(enriched.s2_avg_check).toBe(999)
    expect(enriched.s9n_net_profit).toBe(50)
    expect(enriched.s2_cac).toBe(30)
    expect(enriched.s2_revenue_2025).toBe(300)
  })
})
