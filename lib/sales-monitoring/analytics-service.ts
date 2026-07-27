import type { DashboardSnapshot } from '@/types/sales-monitoring'
import { query } from './database'

interface AnalyticsRow {
  revenue: string
  cost_of_goods: string
  gross_profit: string
  expenses: string
  operating_profit: string
  units: string
  sales_count: string
  average_check: string
  plan_revenue: string
  plan_gross_profit: string
  updated_at: Date | null
}

export async function getSalesDashboard(input: {
  organizationId: string
  from: string
  to: string
  regionId?: string
  channelId?: string
}): Promise<DashboardSnapshot> {
  const rows = await query<AnalyticsRow>(
    `WITH ledger AS (
       SELECT
         COALESCE(SUM(amount) FILTER (WHERE account = 'revenue'), 0) AS revenue,
         COALESCE(-SUM(amount) FILTER (WHERE account = 'cost_of_goods'), 0) AS cost_of_goods,
         COALESCE(-SUM(amount) FILTER (WHERE account IN ('expense', 'sales_bonus')), 0) AS expenses,
         COALESCE(SUM(amount) FILTER (
           WHERE account IN ('revenue', 'cost_of_goods', 'expense', 'sales_bonus')
         ), 0) AS operating_profit
       FROM management_ledger_entries
       WHERE organization_id = $1
         AND entry_date BETWEEN $2::date AND $3::date
         AND ($4::uuid IS NULL OR region_id = $4::uuid)
         AND ($5::uuid IS NULL OR channel_id = $5::uuid)
     ),
     sale_stats AS (
       SELECT
         COALESCE(SUM(si.quantity), 0) AS units,
         COUNT(DISTINCT s.id) AS sales_count,
         COALESCE(AVG(s.revenue_total), 0) AS average_check
       FROM sales s
       JOIN sale_items si ON si.sale_id = s.id
       WHERE s.organization_id = $1 AND s.status = 'posted'
         AND s.sold_at >= $2::date AND s.sold_at < ($3::date + INTERVAL '1 day')
         AND ($4::uuid IS NULL OR s.region_id = $4::uuid)
         AND ($5::uuid IS NULL OR s.channel_id = $5::uuid)
     ),
     plan AS (
       SELECT
         COALESCE(SUM(pl.revenue_target), 0) AS plan_revenue,
         COALESCE(SUM(pl.gross_profit_target), 0) AS plan_gross_profit
       FROM sales_plan_versions pv
       JOIN sales_plan_lines pl ON pl.plan_version_id = pv.id
       WHERE pv.organization_id = $1 AND pv.status = 'published'
         AND pv.period_start <= $3::date AND pv.period_end >= $2::date
         AND ($4::uuid IS NULL OR pl.region_id = $4::uuid)
         AND ($5::uuid IS NULL OR pl.channel_id = $5::uuid)
     ),
     signal AS (
       SELECT MAX(occurred_at) AS updated_at
       FROM analytics_update_signals WHERE organization_id = $1
     )
     SELECT
       ledger.revenue::text,
       ledger.cost_of_goods::text,
       (ledger.revenue - ledger.cost_of_goods)::text AS gross_profit,
       ledger.expenses::text,
       ledger.operating_profit::text,
       sale_stats.units::text,
       sale_stats.sales_count::text,
       sale_stats.average_check::text,
       plan.plan_revenue::text,
       plan.plan_gross_profit::text,
       signal.updated_at
     FROM ledger CROSS JOIN sale_stats CROSS JOIN plan CROSS JOIN signal`,
    [input.organizationId, input.from, input.to, input.regionId ?? null, input.channelId ?? null],
  )
  const row = rows[0]
  const revenue = Number(row.revenue)
  const grossProfit = Number(row.gross_profit)
  return {
    asOf: new Date().toISOString(),
    filters: input,
    kpis: {
      revenue: row.revenue,
      costOfGoods: row.cost_of_goods,
      grossProfit: row.gross_profit,
      grossMarginPct: revenue === 0 ? '0.00' : ((grossProfit / revenue) * 100).toFixed(2),
      expenses: row.expenses,
      operatingProfit: row.operating_profit,
      units: row.units,
      salesCount: Number(row.sales_count),
      averageCheck: row.average_check,
      planRevenue: row.plan_revenue,
      planGrossProfit: row.plan_gross_profit,
    },
    updatedAt: row.updated_at?.toISOString() ?? null,
  }
}

export async function getProfitAndLoss(input: {
  organizationId: string
  from: string
  to: string
}) {
  return query<{
    pnl_line: string
    month: string
    amount: string
  }>(
    `SELECT
       COALESCE(pnl_line, account) AS pnl_line,
       to_char(date_trunc('month', entry_date), 'YYYY-MM') AS month,
       SUM(amount)::text AS amount
     FROM management_ledger_entries
     WHERE organization_id = $1
       AND entry_date BETWEEN $2::date AND $3::date
       AND pnl_line IS NOT NULL
     GROUP BY COALESCE(pnl_line, account), date_trunc('month', entry_date)
     ORDER BY month, pnl_line`,
    [input.organizationId, input.from, input.to],
  )
}

export async function getCashFlow(input: {
  organizationId: string
  from: string
  to: string
}) {
  return query<{
    cash_flow_line: string
    day: string
    amount: string
  }>(
    `SELECT
       cash_flow_line,
       entry_date::text AS day,
       SUM(amount)::text AS amount
     FROM management_ledger_entries
     WHERE organization_id = $1
       AND entry_date BETWEEN $2::date AND $3::date
       AND cash_flow_line IS NOT NULL
     GROUP BY cash_flow_line, entry_date
     ORDER BY day, cash_flow_line`,
    [input.organizationId, input.from, input.to],
  )
}
