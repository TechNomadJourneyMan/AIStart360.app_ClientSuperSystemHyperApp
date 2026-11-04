import {
  CHOCO_KPI, CHOCO_ALERTS, CHOCO_ACTIVITY, CHOCO_COMPETITORS, CHOCO_REPORTS, CHOCO_SIGNALS, CHOCO_TEAM
} from './choco-data'

import {
  CHOCO_MARKET, CHOCO_NOTIFICATIONS, CHOCO_GRI_DOMAINS, CHOCO_METRICS,
  CHOCO_PRODUCTS, CHOCO_SCENARIOS
} from './choco-data-ext'

/**
 * The Choco* fixtures are a SHOWCASE/DEMO dataset, not real business data.
 * They must only ever reach the dedicated demo account (or an explicit
 * DEMO_DASHBOARD=1 environment). Real users get honest empty data instead of
 * fabricated Kaspi/Glovo/Yandex "market intelligence".
 */
const DEMO_EMAILS = new Set(['portal@chocofamily.kz'])

export function isDemoDashboard(email?: string | null): boolean {
  if (process.env.DEMO_DASHBOARD === '1') return true
  return !!email && DEMO_EMAILS.has(email)
}

export function getDashboardData(email?: string | null) {
  if (isDemoDashboard(email)) {
    return {
      demo: true,
      KPI: CHOCO_KPI,
      ALERTS: CHOCO_ALERTS,
      ACTIVITY: CHOCO_ACTIVITY,
      COMPETITORS: CHOCO_COMPETITORS,
      REPORTS: CHOCO_REPORTS,
      SIGNALS: CHOCO_SIGNALS,
      TEAM: CHOCO_TEAM,
      MARKET: CHOCO_MARKET,
      NOTIFICATIONS: CHOCO_NOTIFICATIONS,
      GRI_DOMAINS: CHOCO_GRI_DOMAINS,
      METRICS: CHOCO_METRICS,
      PRODUCTS: CHOCO_PRODUCTS,
      SCENARIOS: CHOCO_SCENARIOS,
    }
  }

  // Real accounts: no fabricated data — honest empty state.
  return {
    demo: false,
    KPI: null as typeof CHOCO_KPI | null,
    ALERTS: [] as typeof CHOCO_ALERTS,
    ACTIVITY: [] as typeof CHOCO_ACTIVITY,
    COMPETITORS: [] as typeof CHOCO_COMPETITORS,
    REPORTS: [] as typeof CHOCO_REPORTS,
    SIGNALS: [] as typeof CHOCO_SIGNALS,
    TEAM: [] as typeof CHOCO_TEAM,
    MARKET: null as typeof CHOCO_MARKET | null,
    NOTIFICATIONS: [] as typeof CHOCO_NOTIFICATIONS,
    GRI_DOMAINS: [] as typeof CHOCO_GRI_DOMAINS,
    METRICS: null as typeof CHOCO_METRICS | null,
    PRODUCTS: [] as typeof CHOCO_PRODUCTS,
    SCENARIOS: [] as typeof CHOCO_SCENARIOS,
  }
}
