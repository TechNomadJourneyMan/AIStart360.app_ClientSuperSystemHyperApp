/** lib/metrics/kpi-aliases.ts — no imports: safe for client components. */

/** Short names the older UI used → registry ids. */
export const KPI_ALIASES: Readonly<Record<string, string>> = {
  revenue: 'biz.finansy.vyruchka_god',
  margin: 'biz.finansy.valovaya_marzha',
  clients: 'biz.klienty.aktivnykh_klientov',
  new_clients: 'goal.01.kolichestvo_novykh_klientov',
  avg_check: 'biz.prodazhi.sredniy_chek',
  ltv: 'goal.04.ltv',
  cac: 'biz.marketing.cac',
  ltv_cac: 'biz.marketing.ltv_cac',
  no_show_rate: 'biz.prodazhi.dolya_neyavok_no_show',
}
