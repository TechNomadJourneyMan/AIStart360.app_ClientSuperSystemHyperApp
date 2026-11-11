/**
 * Static check of migration 139 (the light chat route calls qwen3-8). There
 * is no database in unit tests, so the invariants of the SQL text are pinned
 * here: which rows it may touch and in which order.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/139_alem_light_route_qwen.sql'), 'utf8')
const code = sql.replace(/--.*$/gm, '')
const header = sql.split('\n').filter((l) => l.startsWith('--')).join('\n')

describe('migration 139 light route → qwen3-8', () => {
  it('the header says what, why, that it is idempotent and how to apply it', () => {
    expect(header).toMatch(/^-- 139_alem_light_route_qwen\.sql/)
    expect(header).toMatch(/403/)
    expect(header).toMatch(/qwen3-8/)
    expect(header).toMatch(/idempotent/i)
    expect(header).toContain('node scripts/apply-migration.js supabase/migrations/139_alem_light_route_qwen.sql')
  })

  it('data only: no DDL, no grants, no deletes; only the AI routing tables', () => {
    expect(code).not.toMatch(/\b(CREATE|ALTER|DROP)\s+(TABLE|INDEX|POLICY|TRIGGER|FUNCTION|COLUMN)/i)
    expect(code).not.toMatch(/\b(GRANT|REVOKE|TRUNCATE)\b/i)
    expect(code).not.toMatch(/\bDELETE\s+FROM\b/i)
    expect(code).not.toMatch(/\bINSERT\s+INTO\b/i)
    const tables = new Set(code.match(/public\.\w+/g))
    expect([...tables].sort()).toEqual(['public.ai_models', 'public.ai_providers', 'public.ai_routes'])
    // no key material, no credential rewiring
    expect(code).not.toMatch(/ai_credentials|secret/i)
    expect(code).not.toMatch(/SET[^;]*credential_id\s*=/i)
  })

  it('does nothing without a qwen3-8 chat row that has its own key on llm.alem.ai', () => {
    expect(code).toMatch(/m\.model_id = 'qwen3-8' AND m\.credential_id IS NOT NULL/)
    expect(code).toMatch(/IF v_qwen IS NULL THEN[\s\S]*?RETURN;/)
  })

  it('moves the chat routes off AlemLLM to qwen3-8 before AlemLLM is disabled', () => {
    const move = code.indexOf('UPDATE public.ai_routes')
    const disable = code.indexOf('SET enabled = FALSE')
    expect(move).toBeGreaterThan(0)
    expect(disable).toBeGreaterThan(move)
    expect(code).toMatch(/SET model_id = v_qwen, updated_by = 'migration:139'/)
    expect(code).toMatch(/r\.capability = 'chat'[\s\S]*?m\.model_id = 'AlemLLM'/)
  })

  it('a keyless alemllm is disabled only when an alemllm with its own key exists', () => {
    expect(code).toMatch(
      /m\.model_id = 'alemllm' AND m\.credential_id IS NULL AND EXISTS \([\s\S]*?w\.model_id = 'alemllm' AND w\.credential_id IS NOT NULL\)/,
    )
  })

  it('every statement is scoped to chat models on llm.alem.ai', () => {
    const updates = code.split(/(?=UPDATE public\.)/).slice(1)
    expect(updates).toHaveLength(4)
    // the first one touches only the row found by the scoped SELECT
    expect(updates[0]).toMatch(/WHERE id = v_qwen;/)
    for (const u of updates.slice(1)) expect(u).toMatch(/llm\.alem\.ai/)
    expect(code.match(/capability = 'chat'/g)!.length).toBeGreaterThanOrEqual(4)
  })
})
