import { describe, it, expect } from 'vitest'
import {
  computeRealityCheck,
  type RealityCheckContext,
  type RealityCheckItem,
} from '@/lib/gri/reality-check'

// ─── Фикстуры ────────────────────────────────────────────────────────────────

/** Базовый ctx без диагностики и без сигналов — правила должны молчать. */
function baseCtx(overrides: Partial<RealityCheckContext> = {}): RealityCheckContext {
  return {
    answers: { s1_company_name: 'Тест ООО' },
    pointA: {
      has_diagnostic: false,
      health_index: null,
      blocks: [],
    },
    pointB: {
      current_revenue_year: null,
      goal_12m_revenue_year: null,
      gap: { required_mom_growth: null },
      realism: { level: 'unknown', score: 0 },
    },
    metrics: { revenue: null },
    ...overrides,
  }
}

function blocksWith(
  key: string,
  score: number,
  status: string,
): RealityCheckContext['pointA']['blocks'] {
  const all = ['finance', 'sales', 'operations', 'marketing', 'strategy']
  return all.map((k) =>
    k === key
      ? { key: k, label: labelOf(k), score, status }
      : { key: k, label: labelOf(k), score: 55, status: 'average' },
  )
}

function labelOf(k: string): string {
  return (
    {
      finance: 'Финансы',
      sales: 'Продажи',
      operations: 'Операции',
      marketing: 'Маркетинг',
      strategy: 'Стратегия',
    }[k] ?? k
  )
}

// ─── (а) Высокая самооценка + критичная Точка А → mismatch с цифрой ──────────

describe('computeRealityCheck — mismatch против Точки А', () => {
  it('cash-stability 8/10 при finance critical → mismatch, цитирует 25/100', () => {
    const items = computeRealityCheck({
      sectionAvgs: { 'cash-stability': 8 },
      ctx: baseCtx({
        pointA: {
          has_diagnostic: true,
          // 55 → 5,5/10: близко к самооценке 8 → overall-правило молчит,
          // проверяем ТОЛЬКО финансовое правило.
          health_index: 55,
          blocks: blocksWith('finance', 25, 'critical'),
        },
      }),
    })
    expect(items).toHaveLength(1)
    const item = items[0]
    expect(item.blockId).toBe('cash-stability')
    expect(item.blockLabelRu).toBe('Денежная стабильность')
    expect(item.severity).toBe('mismatch')
    expect(item.selfScore).toBe(8)
    // Конкретная цифра из данных, не выдумка:
    expect(item.finding).toContain('25/100')
    expect(item.finding).toContain('критично')
  })

  it('cash-stability 9/10 при отрицательной прибыли в анкете → цитирует сумму', () => {
    const items = computeRealityCheck({
      sectionAvgs: { 'cash-stability': 9 },
      ctx: baseCtx({
        answers: { s9n_net_profit: -1200000, s9n_revenue_2024: 5000000 },
      }),
    })
    expect(items).toHaveLength(1)
    expect(items[0].severity).toBe('mismatch')
    expect(items[0].finding).toContain('по анкете чистая прибыль отрицательная')
    expect(items[0].finding).toContain('1 200 000')
  })

  it('generic: product-demand 9/10 при marketing weak → mismatch с баллом блока', () => {
    const items = computeRealityCheck({
      sectionAvgs: { 'product-demand': 9 },
      ctx: baseCtx({
        pointA: {
          has_diagnostic: true,
          health_index: 62, // 6,2/10 vs 9 → diff 2,8 ≤ 3 — overall молчит
          blocks: blocksWith('marketing', 32, 'weak'),
        },
      }),
    })
    expect(items).toHaveLength(1)
    expect(items[0].blockId).toBe('product-demand')
    expect(items[0].severity).toBe('mismatch')
    expect(items[0].finding).toContain('32/100')
    expect(items[0].finding).toContain('Маркетинг')
  })

  it('незамапленный блок (team) НЕ сверяется с Точкой А', () => {
    const items = computeRealityCheck({
      sectionAvgs: { team: 9 },
      ctx: baseCtx({
        pointA: {
          has_diagnostic: true,
          health_index: 62, // близко к 9/10 → и overall-правило молчит
          blocks: blocksWith('operations', 20, 'critical'),
        },
      }),
    })
    expect(items).toEqual([])
  })
})

// ─── (б) Нет данных → [] ─────────────────────────────────────────────────────

describe('computeRealityCheck — пустые входы', () => {
  it('пустой sectionAvgs → []', () => {
    const items = computeRealityCheck({
      sectionAvgs: {},
      ctx: baseCtx({
        pointA: {
          has_diagnostic: true,
          health_index: 20,
          blocks: blocksWith('finance', 10, 'critical'),
        },
      }),
    })
    expect(items).toEqual([])
  })

  it('пустой ctx.answers → []', () => {
    const items = computeRealityCheck({
      sectionAvgs: { 'cash-stability': 9 },
      ctx: baseCtx({
        answers: {},
        pointA: {
          has_diagnostic: true,
          health_index: 20,
          blocks: blocksWith('finance', 10, 'critical'),
        },
      }),
    })
    expect(items).toEqual([])
  })
})

// ─── (в) Заниженная самооценка → note ────────────────────────────────────────

describe('computeRealityCheck — обратное направление (строже к себе)', () => {
  it('operations 2/10 при operations strong 78/100 → note с цифрой', () => {
    const items = computeRealityCheck({
      sectionAvgs: { operations: 2 },
      ctx: baseCtx({
        pointA: {
          has_diagnostic: true,
          health_index: 30, // GRI self-index 2 vs 3.0 — overall молчит
          blocks: blocksWith('operations', 78, 'strong'),
        },
      }),
    })
    expect(items).toHaveLength(1)
    const item = items[0]
    expect(item.severity).toBe('note')
    expect(item.blockId).toBe('operations')
    expect(item.finding).toContain('78/100')
    expect(item.finding).toContain('строже к себе')
  })
})

// ─── Реалистичность цели (Точка B) ───────────────────────────────────────────

describe('computeRealityCheck — реалистичность цели', () => {
  it('business-model 8/10 при required_mom_growth 22%/мес → note с процентом', () => {
    const items = computeRealityCheck({
      sectionAvgs: { 'business-model': 8 },
      ctx: baseCtx({
        pointB: {
          current_revenue_year: 10000000,
          goal_12m_revenue_year: 120000000,
          gap: { required_mom_growth: 22 },
          realism: { level: 'unrealistic', score: 15 },
        },
      }),
    })
    // business-model замаплен на finance (average в baseCtx-blocks нет — нет диагностики),
    // поэтому единственная карточка — realism-note.
    expect(items).toHaveLength(1)
    expect(items[0].severity).toBe('note')
    expect(items[0].finding).toContain('22%')
    expect(items[0].finding).toContain('нереалистичная')
  })

  it('реалистичная цель (realistic, рост 3%/мес) → правило молчит', () => {
    const items = computeRealityCheck({
      sectionAvgs: { 'product-demand': 9, 'business-model': 8 },
      ctx: baseCtx({
        pointB: {
          current_revenue_year: 10000000,
          goal_12m_revenue_year: 14000000,
          gap: { required_mom_growth: 3 },
          realism: { level: 'realistic', score: 85 },
        },
      }),
    })
    expect(items).toEqual([])
  })
})

// ─── Общий индекс ────────────────────────────────────────────────────────────

describe('computeRealityCheck — общий индекс', () => {
  it('GRI 9/10 при health_index 30/100 (3/10) → note о расхождении', () => {
    const items = computeRealityCheck({
      sectionAvgs: { team: 9, 'owner-readiness': 9 }, // незамапленные → только overall
      ctx: baseCtx({
        pointA: {
          has_diagnostic: true,
          health_index: 30,
          blocks: blocksWith('finance', 55, 'average'),
        },
      }),
    })
    expect(items).toHaveLength(1)
    const item = items[0]
    expect(item.blockId).toBe('overall')
    expect(item.severity).toBe('note')
    expect(item.finding).toContain('9/10')
    expect(item.finding).toContain('30/100')
  })

  it('расхождение <= 3 пунктов → молчит', () => {
    const items = computeRealityCheck({
      sectionAvgs: { team: 6 },
      ctx: baseCtx({
        pointA: {
          has_diagnostic: true,
          health_index: 40, // 6 vs 4.0 → diff 2 ≤ 3
          blocks: blocksWith('finance', 55, 'average'),
        },
      }),
    })
    expect(items).toEqual([])
  })
})

// ─── (г) Никакой инвенции при отсутствии полей ──────────────────────────────

describe('computeRealityCheck — нет данных → нет расхождений (анти-галлюцинация)', () => {
  it('высокие самооценки, но нет диагностики/прибыли/realism → []', () => {
    const items = computeRealityCheck({
      sectionAvgs: {
        'product-demand': 9,
        'trust-positioning': 9,
        'business-model': 9,
        'cash-stability': 9,
        operations: 9,
        team: 9,
        'owner-readiness': 9,
      },
      ctx: baseCtx(), // has_diagnostic=false, realism unknown, нет s9n_net_profit
    })
    expect(items).toEqual([])
  })

  it('без диагностики нулевые EMPTY_BLOCK-статусы Точки А не рождают mismatch', () => {
    // buildAssistantContext без диагностики отдаёт blocks со score 0/'critical' —
    // has_diagnostic=false обязан гасить эти псевдо-факты.
    const items = computeRealityCheck({
      sectionAvgs: { 'cash-stability': 10 },
      ctx: baseCtx({
        pointA: {
          has_diagnostic: false,
          health_index: null,
          blocks: blocksWith('finance', 0, 'critical'),
        },
      }),
    })
    expect(items).toEqual([])
  })

  it('каждая карточка цитирует конкретную цифру (нет пустых finding)', () => {
    const items = computeRealityCheck({
      sectionAvgs: { 'cash-stability': 8, operations: 2, team: 9 },
      ctx: baseCtx({
        answers: { s9n_net_profit: -500000 },
        pointA: {
          has_diagnostic: true,
          health_index: 45,
          blocks: blocksWith('operations', 81, 'excellent'),
        },
      }),
    })
    expect(items.length).toBeGreaterThan(0)
    for (const item of items as RealityCheckItem[]) {
      expect(item.finding).toMatch(/\d/) // всегда есть цифра из данных
      expect(item.blockLabelRu.length).toBeGreaterThan(0)
    }
    // Максимум одна карточка на блок:
    const ids = items.map((i) => i.blockId)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
