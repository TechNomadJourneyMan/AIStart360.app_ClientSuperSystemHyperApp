import { calculatePointAV4 } from '@/lib/point-a/v4/engine'
import { DEFAULT_TEMPLATE, effectiveBlocks, BLOCK_KEYS, BLOCK_LIBRARY } from '@/lib/point-a/v4/config'
import { evaluateGoal, type Goal } from '@/lib/goals/evaluate'
import type { PointAPageState } from '@/hooks/usePointAState'
import { getMetricById } from '@/lib/metrics/registry'
import { DEFAULT_KEY_METRICS, blockMetricIds, keyMetricCatalog, toMetricView, type BlockDetail, type MetricView } from '@/lib/point-a/v4/metric-views'
import type { BlockKey } from '@/lib/point-a/v4/config'

/** value, period, source, recent values (oldest first) */
const VALUES: Record<string, [number, string, string, number[]]> = {
  'biz.finansy.vyruchka_god': [66_000_000, '10.2026', 'survey', [48_000_000, 52_000_000, 60_000_000, 66_000_000]],
  'biz.finansy.valovaya_marzha': [22, '2024', 'survey', [25, 22]],
  'biz.finansy.ebitda': [9_500_000, '2025', 'document', [7_200_000, 9_500_000]],
  'biz.finansy.debitorskaya_zadolzhennost': [4_100_000, '2025', 'document', []],
  'biz.prodazhi.sredniy_chek': [185_000, '2025', 'survey', [160_000, 172_000, 185_000]],
  'biz.prodazhi.tsikl_zakrytiya_sdelki': [21, '2026', 'survey', [28, 21]],
  'biz.prodazhi.win_rate': [18, '2026', 'calculated', [15, 18]],
  'biz.klienty.aktivnykh_klientov': [356, '2026', 'survey', [290, 356]],
  'biz.klienty.nps': [41, '2026', 'survey', [35, 41]],
  'biz.marketing.cac': [24_000, '2025', 'document', [27_000, 24_000]],
  'biz.marketing.ltv_cac': [2.4, '2025', 'calculated', [2.1, 2.4]],
  'biz.marketing.lidov_v_mes': [300, '2026', 'survey', []],
  'biz.hr.kol_vo_sotrudnikov': [18, '2026', 'survey', [15, 18]],
}

function views(ids: readonly string[]): MetricView[] {
  return ids.flatMap((id) => {
    const e = getMetricById(id)
    if (!e) return []
    const v = VALUES[id]
    return [toMetricView(e, v ? { value: v[0], period: v[1], source: v[2], confidence: v[2] === 'document' ? 0.85 : 0.9 } : undefined, v?.[3] ?? [])]
  })
}

export function previewDetails(blocks: PointAPageState['snapshot'] extends infer S ? S extends { blocks: infer B } ? B : never : never): Partial<Record<BlockKey, BlockDetail>> {
  const out: Partial<Record<BlockKey, BlockDetail>> = {}
  for (const b of blocks) {
    const metrics = views(blockMetricIds(b.key))
    out[b.key] = { key: b.key, title: b.title, description: BLOCK_LIBRARY[b.key].description, block: b, metrics: [...metrics.filter((m) => m.value !== null), ...metrics.filter((m) => m.value === null)] }
  }
  return out
}

const ANSWERS: Record<string, unknown> = {
  s1_current_revenue_year: 66_000_000, s9n_revenue_2024: 52_000_000, s9n_change_vs_2023: '+18%', s9n_net_margin: 22,
  s9n_debts_amount: 0, s9n_breakeven_point: 3_500_000, s12_crm_tool: 'amocrm', s3_deal_cycle_days: 21,
  s4m_control_method: 'kpi', s4m_report_automated: 'excel', s12_project_mgmt: 'notion',
  s6_main_pain: 'Не хватает заявок', s2n_goal_12m_what: 'Выручка 100 млн', s2n_goal_3y_what: 'Выйти в 3 города',
  s4n_structure_matches: true, s4m_delegation_readiness: 6, s4m_hours_on_ops: 7, s4m_planning_team_or_solo: 'one_person',
  s1_employee_count: 18, s3_product_count: 4, s5n_product_locomotive: 'Курс «Старт»', s7_nps_score: 41,
}

export function previewState(): PointAPageState {
  const now = new Date()
  const v4 = calculatePointAV4({ answers: ANSWERS, blocks: effectiveBlocks(DEFAULT_TEMPLATE), conflictMetrics: new Set(['biz.finansy.vyruchka_god']) })
  v4.blocks = v4.blocks.map((b) => (b.key === 'marketing' ? { ...b, hypothesis: { score: 42, confidence: 0.3, rationale: 'Есть CRM и цикл сделки 21 день, но нет данных о бюджете и каналах — оценка ориентировочная.', generatedAt: now.toISOString() } } : b))
  const goal: Goal = { id: 'g1', metricId: 'biz.finansy.vyruchka_god', label: 'Выручка через 12 мес.', unit: '₸', targetValue: 100_000_000, direction: 'higher_is_better', periodLabel: '12m', deadline: null, baselineValue: 60_000_000, baselinePeriod: '2026', source: 'owner', note: null, createdAt: new Date(now.getTime() - 90 * 864e5).toISOString() }
  const iso = (d: number) => new Date(now.getTime() - d * 864e5).toISOString()
  return {
    companyId: 'preview', canManage: true, role: 'owner',
    snapshot: {
      id: 's3', createdAt: iso(0.02), engine: 'v4', trigger: 'event', overall: v4.overall, confidence: v4.confidence, coverage: v4.coverage,
      stage: v4.stage, healthIndex: v4.health_index, blocks: v4.blocks, strengths: v4.strengths, uploadChecklist: v4.upload_checklist,
      changeReasons: [], reviewedBy: null, reviewedAt: null,
      metrics: [
        { id: 'biz.finansy.vyruchka_god', label: 'Выручка (год)', unit: '₸', value: 66_000_000, source: 'анкета', period: '10.2026' },
        { id: 'biz.finansy.valovaya_marzha', label: 'Валовая маржа', unit: '%', value: 22, source: 'анкета', period: '2024' },
        { id: 'biz.prodazhi.tsikl_zakrytiya_sdelki', label: 'Цикл сделки', unit: 'days', value: 21, source: 'анкета', period: '2026' },
      ],
    },
    history: [
      { id: 's3', createdAt: iso(0.02), overall: v4.overall, confidence: v4.confidence, changes: ['Выручка (год): 60 млн → 66 млн · 10.2026 · анкета', 'Финансы: +6 (41 → 47)', 'Найдено расхождений: 1'] },
      { id: 's2', createdAt: iso(3), overall: (v4.overall ?? 50) - 6, confidence: 0.4, changes: ['Анкета, шаг 4: изменено ответов — 5', 'Команда: появился балл 61'] },
      { id: 's1', createdAt: iso(9), overall: (v4.overall ?? 50) - 11, confidence: 0.3, changes: ['Первый расчёт Точки А'] },
    ],
    discrepancies: [{
      id: 'd1', metricKey: 'biz.finansy.vyruchka_god', metricLabel: 'Выручка (год)', periodKey: '2024', periodLabel: '2024', kind: 'conflict',
      detail: null, chosenValue: 52_000_000,
      candidates: [
        { value: 52_000_000, unit: '₸', sourceKind: 'survey', sourceRef: 'survey:s9n_revenue_2024' },
        { value: 58_400_000, unit: '₸', sourceKind: 'document', sourceRef: 'document:x#revenue', note: 'ОПиУ_2024.pdf' },
      ],
    }],
    goals: [{ goal, evaluation: evaluateGoal(goal, { value: 66_000_000, period: '2026-10' }, now) }],
    gri: { index100: 58, assessedAt: iso(20) },
    benchmarks: {
      industry: 'Образование', stage: 'early', source: 'экспертная оценка, не статистика', overall: 55,
      blocks: (['finance', 'sales', 'operations', 'marketing', 'strategy'] as const).map((k) => {
        const b = v4.blocks.find((x) => x.key === k)
        return { key: k, title: BLOCK_LIBRARY[k].title, benchmark: 55, score: b?.score ?? null, rating: b?.score == null ? null : b.score >= 60 ? 'Выше среднего' : 'На уровне' }
      }),
    },
    sources: { survey: { percent: 58, completed: 7, total: 12 }, documents: { parsed: 2, processing: 1, failed: 0 }, metrics: 41 },
    recalculation: 'idle',
    config: { template: 'default', templateTitle: 'Универсальный', added: [], blocks: effectiveBlocks(DEFAULT_TEMPLATE).map((b) => ({ key: b.key, title: b.title, weight: b.weight, hiddenForClient: false, informational: b.informational, order: b.order })) },
    library: BLOCK_KEYS.map((k) => ({ key: k, title: BLOCK_LIBRARY[k].title, description: BLOCK_LIBRARY[k].description })),
    keyMetrics: views(DEFAULT_KEY_METRICS),
    keyMetricsCustom: false,
    metricCatalog: keyMetricCatalog(),
  }
}
