// ============================================================
// Portfolio "intelligence" demo data (insights / intelligence / competitors).
//
// This is a curated CASE-STUDY dataset (Choco ecosystem). It is NOT real
// per-user data and must never render as if it were the signed-in company's
// own numbers. It is therefore returned ONLY for an explicit demo account or
// when DEMO_DASHBOARD=1 is set. Everyone else gets empty structures so the
// pages show an honest empty state. See docs/technical-audit.md (D1).
// ============================================================

import {
  CHOCO_KPI, CHOCO_ALERTS, CHOCO_ACTIVITY, CHOCO_COMPETITORS, CHOCO_REPORTS, CHOCO_SIGNALS, CHOCO_TEAM
} from './choco-data'

import {
  CHOCO_MARKET, CHOCO_NOTIFICATIONS, CHOCO_GRI_DOMAINS, CHOCO_METRICS,
  CHOCO_PRODUCTS, CHOCO_SCENARIOS
} from './choco-data-ext'

export interface DashboardData {
  isDemo: boolean
  KPI: typeof CHOCO_KPI | Record<string, never>
  ALERTS: typeof CHOCO_ALERTS
  ACTIVITY: typeof CHOCO_ACTIVITY
  COMPETITORS: typeof CHOCO_COMPETITORS
  REPORTS: typeof CHOCO_REPORTS
  SIGNALS: typeof CHOCO_SIGNALS
  TEAM: typeof CHOCO_TEAM
  MARKET: typeof CHOCO_MARKET | Record<string, never>
  NOTIFICATIONS: typeof CHOCO_NOTIFICATIONS
  GRI_DOMAINS: typeof CHOCO_GRI_DOMAINS
  METRICS: typeof CHOCO_METRICS
  PRODUCTS: typeof CHOCO_PRODUCTS
  SCENARIOS: typeof CHOCO_SCENARIOS
}

const DEMO_EMAILS = new Set(['portal@chocofamily.kz'])

function isDemoAccount(email?: string | null): boolean {
  if (process.env.DEMO_DASHBOARD === '1') return true
  return !!email && DEMO_EMAILS.has(email)
}

function emptyData(): DashboardData {
  return {
    isDemo: false,
    KPI: {},
    ALERTS: [],
    ACTIVITY: [],
    COMPETITORS: [],
    REPORTS: [],
    SIGNALS: [],
    TEAM: [],
    MARKET: {},
    NOTIFICATIONS: [],
    GRI_DOMAINS: [],
    METRICS: [],
    PRODUCTS: [],
    SCENARIOS: [],
    // Object-shaped demo fields (KPI/MARKET/METRICS) are intentionally empty
    // for real accounts; pages only read isDemo/SIGNALS/COMPETITORS here.
  } as unknown as DashboardData
}

export function getDashboardData(email?: string | null): DashboardData {
  if (!isDemoAccount(email)) return emptyData()

  return {
    isDemo: true,
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
