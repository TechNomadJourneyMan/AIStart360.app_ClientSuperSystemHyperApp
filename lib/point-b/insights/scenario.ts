/**
 * lib/point-b/insights/scenario.ts — which scenario of a model result the rules talk about. Pure.
 *
 *   the selected one (the pace of the published plan), else «Умеренный», else the first feasible one,
 *   else the first; null when the result has no scenarios.
 */
import type { ModelResult, ScenarioResult } from '../model/types'
import type { RecSourceRef } from '../recs/types'

export const POINT_B_HREF = '/client/point-b'
export const tabHref = (tab: 'overview' | 'scenarios' | 'strategy' | 'roadmap' | 'recs' | 'whatif' | 'finmodel'): string =>
  tab === 'overview' ? POINT_B_HREF : `${POINT_B_HREF}?tab=${tab}`

export function pickScenario(result: ModelResult, selected: string | null): ScenarioResult | null {
  const list = result.scenarios ?? []
  if (!list.length) return null
  return (selected ? list.find((s) => s.key === selected) : undefined)
    ?? list.find((s) => s.key === 'moderate')
    ?? list.find((s) => s.feasible)
    ?? list[0]
}

export const scenarioRef = (s: ScenarioResult): RecSourceRef => ({ type: 'scenario', ref: s.key, label: `Сценарий «${s.label}»` })
export const modelRef = (ref: string, label: string): RecSourceRef => ({ type: 'model', ref, label })

/** Registry metrics behind the levers of the funnel. */
export const LEVER_METRIC: Record<'leads' | 'conversion' | 'avgCheck' | 'repeat', string> = {
  leads: 'biz.marketing.lidov_v_mes',
  conversion: 'biz.marketing.konversiya_lid_klient',
  avgCheck: 'biz.prodazhi.sredniy_chek',
  repeat: 'goal.02.repeat_purchase_rate',
}
