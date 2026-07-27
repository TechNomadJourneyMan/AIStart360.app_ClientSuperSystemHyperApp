import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/003_sales_monitoring_core.sql'),
  'utf8',
)

describe('sales monitoring migration contract', () => {
  it.each([
    'sales',
    'sale_items',
    'product_cost_versions',
    'expenses',
    'sales_plan_versions',
    'management_ledger_entries',
    'idempotency_records',
    'financial_audit_events',
    'outbox_events',
    'import_rows',
    'knowledge_chunks',
    'assistant_action_drafts',
  ])('defines %s', (table) => {
    expect(migration).toContain(`CREATE TABLE public.${table}`)
  })

  it('enforces non-overlapping product cost periods', () => {
    expect(migration).toContain('product_cost_versions_no_overlap')
    expect(migration).toContain('EXCLUDE USING gist')
  })

  it('enables RLS and hybrid document search', () => {
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain('match_knowledge_chunks')
    expect(migration).toContain('analytics_update_signals')
  })
})
