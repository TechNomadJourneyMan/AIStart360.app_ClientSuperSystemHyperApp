/**
 * LIVE AI smoke test — verifies the OpenRouter integration end-to-end.
 *
 * Run manually (makes real network calls, costs a few cents):
 *   npx vitest run scripts/ai-smoke.test.ts
 *
 * Requires OPENROUTER_API_KEY in .env.local. Skips gracefully if absent.
 */
import 'dotenv/config'
import { config as loadEnv } from 'dotenv'
import { describe, it, expect } from 'vitest'

loadEnv({ path: '.env.local' })

import {
  chatWithOpenRouter,
  embedWithOpenRouter,
  hasOpenRouterKey,
} from '@/lib/ai/openrouter'
import { analyzePointA } from '@/lib/ai/point-a-analyzer'
import { analyzePointB } from '@/lib/ai/point-b-analyzer'
import type { PointA } from '@/types/onboarding'
import type { PointB } from '@/types/point-b'

const HAS_KEY = hasOpenRouterKey()
const run = HAS_KEY ? describe : describe.skip

// ─── Synthetic fixtures (minimal shapes the analyzers read) ──────────────────

const ANSWERS: Record<string, unknown> = {
  s1_company_name: 'ТестКофе',
  s1_industry: 'HoReCa / кофейни',
  s1_stage: 'growth',
  s1_employee_count: 18,
  s2_revenue_2023: 40_000_000,
  s2_revenue_2024: 62_000_000,
  s2_cac: 5_000,
  s2_ltv: 28_000,
  s2n_goal_12m_what: 'Открыть 3 новые точки и выйти на 120 млн ₸',
  s2n_goal_3y_what: 'Сеть из 12 кофеен, выручка 400 млн ₸',
  s6_goal_12months: 'Удвоить выручку до 120 млн ₸',
  s6_goal_3years: 'Сеть из 12 кофеен',
}

const POINT_A: PointA = {
  overall_score: 58,
  health_index: 61,
  stage: 'growth',
  blocks: {
    finance: { score: 52, top_issues: ['Нет управленческого учёта', 'Кассовые разрывы'] },
    sales: { score: 64, top_issues: ['Нет CRM', 'Не считается LTV'] },
    operations: { score: 55, top_issues: ['Нет стандартов', 'Высокая текучка бариста'] },
    marketing: { score: 60, top_issues: ['Один канал привлечения'] },
    strategy: { score: 57, top_issues: ['Нет финмодели масштабирования'] },
  },
  risks: [
    { level: 'high', area: 'finance', text: 'Кассовые разрывы при росте' },
    { level: 'medium', area: 'operations', text: 'Текучка персонала тормозит открытие точек' },
  ],
  data_gaps: [{ field: 's9n_net_margin' }],
} as unknown as PointA

const POINT_B_BASE: PointB = {
  target_kpis: [{ label: 'Выручка', target: '120 млн ₸' }],
} as unknown as PointB

// ─── Tests ───────────────────────────────────────────────────────────────────

if (!HAS_KEY) {
  // eslint-disable-next-line no-console
  console.warn('[ai-smoke] OPENROUTER_API_KEY missing — all live tests skipped')
}

run('OpenRouter live integration', () => {
  it('chat completion returns text', async () => {
    const out = await chatWithOpenRouter({
      system: 'Ты лаконичный ассистент. Отвечай одним словом.',
      user: 'Назови столицу Казахстана.',
      maxTokens: 20,
      temperature: 0,
    })
    console.log('\n[chat] →', out)
    expect(out).toBeTruthy()
    expect(out!.toLowerCase()).toMatch(/астан|astan/)
  }, 60_000)

  it('embeddings return a 1536-dim vector', async () => {
    const vecs = await embedWithOpenRouter(['рост выручки кофейни'])
    console.log('[embed] → vectors:', vecs?.length, 'dim:', vecs?.[0]?.length)
    expect(vecs).not.toBeNull()
    expect(vecs!.length).toBe(1)
    expect(vecs![0].length).toBe(1536)
  }, 60_000)

  it('analyzePointA returns a schema-valid structured analysis FAST (<25s)', async () => {
    const t0 = Date.now()
    const res = await analyzePointA(ANSWERS, POINT_A, null)
    const elapsedMs = Date.now() - t0
    console.log(`[point-a] → elapsed: ${(elapsedMs / 1000).toFixed(1)}s`)
    console.log('[point-a] → summary:', res?.executive_summary?.slice(0, 160))
    console.log('[point-a] → roadmap horizons:', res?.growth_roadmap?.map(r => r.horizon))
    expect(res).not.toBeNull()
    expect(res!.executive_summary.length).toBeGreaterThan(20)
    expect(Object.keys(res!.blocks)).toEqual(
      expect.arrayContaining(['finance', 'sales', 'operations', 'marketing', 'strategy']),
    )
    expect(res!.growth_roadmap.length).toBe(3)
    expect(res!.strategic_priorities.length).toBeGreaterThanOrEqual(2)
    expect(res!.model_used).toBeTruthy()
    // Speed budget: the parallel fan-out should land well under 25s.
    expect(elapsedMs).toBeLessThan(25_000)
  }, 40_000)

  it('analyzePointB returns gap analysis + milestones', async () => {
    const res = await analyzePointB(ANSWERS, POINT_A, POINT_B_BASE, { name: 'ТестКофе' })
    console.log('[point-b] → gaps:', (res?.gap_analysis as unknown[])?.length, 'milestones:', (res?.milestones as unknown[])?.length)
    expect(res).not.toBeNull()
    expect((res!.gap_analysis as unknown[]).length).toBe(3)
    expect((res!.milestones as unknown[]).length).toBe(4)
  }, 90_000)
})
