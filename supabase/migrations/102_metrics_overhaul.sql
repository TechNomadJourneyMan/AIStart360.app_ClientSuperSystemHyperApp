-- 102_metrics_overhaul.sql
--
-- Metric values materialised from sources that never measured the metric
-- (W4 metrics overhaul, docs/platform/04-point-a.md «Метрики»).
--
-- Until 2026-10 the source lists in lib/metrics/descriptions.ts let the
-- resolver fill metrics from an INPUT of their formula, from a value of
-- another unit or meaning, or from free text whose digits were glued
-- together. Examples of rows that stayed the «latest value» of a company:
--
--   CPL / стоимость целевого лида       = the whole marketing budget (s9n_expense_marketing)
--   Расходы на рекламу (₸)              = the budget PERCENTAGE (s5_marketing_budget_pct)
--   Выручка с продажника, Производ-ть   = the employee count (s1_employee_count)
--   Win rate / Loss rate (%)            = the number of deals / refusals
--   Лидов в мес, частота покупок        = yearly deals (s3_deals_*)
--   «… дни» metrics, время доставки     = a funnel conversion percent / the sales cycle
--   Дебиторская задолженность           = the company's OWN debts (s9n_debts_amount)
--   Валовая маржа                       = the NET margin (s9n_net_margin)
--   EBITDA / ROA                        = the net profit
--   Себестоимость (KPI)                 = the gross margin percent
--   Cash Flow (мес)                     = the break-even point
--   GRI blocks (0–10)                   = a sum / count of answers
--   churn / NPS                         = «8 из 10» read as 810
--
-- The corrected declarations (current wizard keys, formulas over base
-- metrics, GRI assessment sections, document fields with synonyms) are in
-- lib/metrics/descriptions.ts + lib/metrics/formulas.ts. This migration
-- deletes exactly the rows whose resolver provenance names a (metric, source)
-- pair that was REMOVED from the declarations — computed by diffing the
-- registry of c1429b0 with the new one (303 survey pairs + 27 document
-- pairs, listed below):
--
--   survey:   provenance.picked.type = 'survey' AND picked.key = <key> AND
--             picked has no coerce rule (no removed source had one; the
--             step-8 table / tool-count sources that stay all carry one)
--   document: provenance.picked.type = 'document' AND picked.field = <field>
--             AND picked.doc_type = <doc_type>
--
-- Rows of the same metric from a source that is still declared (the step-8
-- table, a P&L field, s7_nps_score, …), manual / external rows and rows
-- without resolver provenance are not touched. The same points are removed
-- from metric_value_history (trends, forecasts and anomalies read it).
-- Going forward the materialiser itself deletes rows of undeclared sources
-- (pruneStaleMetricRows) and keeps one current row per metric
-- (supersededMetricRowIds), so a re-materialisation repairs any company;
-- this migration only makes the wrong values disappear before that.
--
-- Rows of metrics whose UNIT changed while their source stays declared get
-- the new unit (NPS is an index −100..100, not «%»; days / counts / ₸ that
-- were inferred as ''), so a stored value is not shown with the old unit.
--
-- No schema change. Idempotent.
-- Apply: node scripts/apply-migration.js supabase/migrations/102_metrics_overhaul.sql

-- ─── 1. Removed (metric, survey key) pairs ──────────────────────────────────
CREATE OR REPLACE FUNCTION pg_temp.removed_survey_sources_102()
RETURNS TABLE (metric_key TEXT, source_key TEXT) LANGUAGE sql IMMUTABLE AS $$
  VALUES
    ('biz.finansy.vyruchka_god',               's9n_change_vs_2023'),
    ('biz.finansy.valovaya_marzha',            's9n_net_margin'),
    ('biz.finansy.ebitda',                     's9n_net_profit'),
    ('biz.finansy.ebitda',                     's9n_expense_cogs'),
    ('biz.finansy.ebitda',                     's9n_expense_other'),
    ('biz.finansy.roa',                        's9n_net_profit'),
    ('biz.finansy.operatsionnye_raskhody',     's9n_expense_marketing'),
    ('biz.finansy.operatsionnye_raskhody',     's9n_expense_rent'),
    ('biz.finansy.operatsionnye_raskhody',     's9n_expense_other'),
    ('biz.finansy.sebestoimost_indeks',        's9n_expense_cogs'),
    ('biz.finansy.debitorskaya_zadolzhennost', 's9n_debtor_days'),
    ('biz.finansy.debitorskaya_zadolzhennost', 's9n_debts_amount'),
    ('biz.finansy.cash_flow_mes',              's9n_breakeven_point'),
    ('biz.finansy.cash_flow_mes',              's9n_accounting_method'),
    ('biz.marketing.ltv_cac',                  's2_ltv'),
    ('biz.marketing.ltv_cac',                  's2_cac'),
    ('biz.marketing.ltv_cac',                  's5n_upsell_crosssell'),
    ('biz.marketing.cpl_stoimost_lida',        's9n_expense_marketing'),
    ('biz.marketing.cpl_stoimost_lida',        's5_marketing_channels'),
    ('biz.marketing.lidov_v_mes',              's3_deals_2025'),
    ('biz.marketing.konversiya_lid_klient',    's5n_funnel_lead_to_call'),
    ('biz.marketing.konversiya_lid_klient',    's5n_funnel_call_to_sale'),
    ('biz.marketing.konversiya_lid_klient',    's6n_weak_funnel_points'),
    ('biz.marketing.nps',                      's5n_will_return_nps'),
    ('biz.marketing.nps',                      's5n_improve_suggestions'),
    ('biz.marketing.nps',                      's5n_top_questions'),
    ('biz.marketing.posescheniy_sayta_mes',    's1_website'),
    ('biz.marketing.posescheniy_sayta_mes',    's5_marketing_channels'),
    ('biz.marketing.follovery_sotsseti',       's1_social_media'),
    ('biz.marketing.follovery_sotsseti',       's7n_content_strategy'),
    ('biz.marketing.engagement_rate',          's7n_content_strategy'),
    ('biz.marketing.engagement_rate',          's7n_channels_table'),
    ('biz.prodazhi.ecommerce_sredniy_chek',    's5n_entry_product'),
    ('biz.prodazhi.ecommerce_sredniy_chek',    's5n_upsell_crosssell'),
    ('biz.prodazhi.win_rate',                  's3_deals_2025'),
    ('biz.prodazhi.win_rate',                  's3_rejections_2025'),
    ('biz.prodazhi.win_rate',                  's5n_funnel_kp_to_sale'),
    ('biz.prodazhi.tsikl_zakrytiya_sdelki',    's6n_journey_table'),
    ('biz.prodazhi.konversiya_kp_sdelka',      's5n_funnel_meeting_to_kp'),
    ('biz.prodazhi.konversiya_kp_sdelka',      's6n_script_proposal'),
    ('biz.prodazhi.time_to_response',          's6n_script_first_contact'),
    ('biz.prodazhi.time_to_response',          's12_telephony'),
    ('biz.prodazhi.vyruchka_s_prodazhnika',    's1_employee_count'),
    ('biz.prodazhi.vyruchka_s_prodazhnika',    's4n_staffing_table'),
    ('biz.prodazhi.vyruchka_s_prodazhnika',    's4_has_dept_kpi'),
    ('biz.prodazhi.vyruchka_s_prodazhnika',    's9n_revenue_2024'),
    ('biz.operatsii.vremya_dostavki',          's3_deal_cycle_days'),
    ('biz.operatsii.vremya_dostavki',          's3_deals_2024'),
    ('biz.operatsii.vypolnenie_sla',           's4_reporting_tool'),
    ('biz.operatsii.vypolnenie_sla',           's4_has_dept_kpi'),
    ('biz.operatsii.vypolnenie_sla',           's4m_report_frequency'),
    ('biz.operatsii.vypolnenie_sla',           's4m_report_automated'),
    ('biz.operatsii.povtoryaemost_protsessov', 's4_management_method'),
    ('biz.operatsii.povtoryaemost_protsessov', 's4_has_dept_kpi'),
    ('biz.operatsii.povtoryaemost_protsessov', 's4m_dept_regulations'),
    ('biz.operatsii.povtoryaemost_protsessov', 's4m_control_method'),
    ('biz.operatsii.povtoryaemost_protsessov', 's4m_cross_functional'),
    ('biz.operatsii.predskazuemost',           's4m_strategic_planning'),
    ('biz.operatsii.predskazuemost',           's4m_planning_team_or_solo'),
    ('biz.operatsii.predskazuemost',           's4m_report_frequency'),
    ('biz.operatsii.predskazuemost',           's4m_dept_sync'),
    ('biz.operatsii.predskazuemost',           's2n_what_blocks_growth'),
    ('biz.operatsii.kol_vo_sku',               's3_products_description'),
    ('biz.operatsii.kol_vo_sku',               's3_flagship_product'),
    ('biz.operatsii.kol_vo_sku',               's5n_product_locomotive'),
    ('biz.operatsii.kol_vo_sku',               's5n_most_marginal'),
    ('biz.operatsii.brak_vozvraty',            's5n_will_return_nps'),
    ('biz.operatsii.brak_vozvraty',            's5n_barriers'),
    ('biz.operatsii.brak_vozvraty',            's5n_improve_suggestions'),
    ('biz.operatsii.brak_vozvraty',            's10_dept_assessment'),
    ('biz.operatsii.proizvoditelnost',         's1_employee_count'),
    ('biz.operatsii.proizvoditelnost',         's4_dept_count'),
    ('biz.operatsii.proizvoditelnost',         's4n_staffing_table'),
    ('biz.operatsii.proizvoditelnost',         's4n_open_vacancies'),
    ('biz.operatsii.proizvoditelnost',         's9n_revenue_2024'),
    ('biz.hr.kol_vo_sotrudnikov',              's4n_staffing_table'),
    ('biz.hr.metriki_komandy_gri',             's4n_team_fit_12m'),
    ('biz.hr.metriki_komandy_gri',             's4n_team_fit_3y'),
    ('biz.hr.metriki_komandy_gri',             's4n_structure_matches'),
    ('biz.hr.metriki_komandy_gri',             's4m_feedback_culture'),
    ('biz.hr.metriki_komandy_gri',             's10_dept_assessment'),
    ('biz.hr.metriki_komandy_gri',             's10_what_depts_lack'),
    ('biz.hr.skorost_nayma',                   's4n_open_vacancies'),
    ('biz.hr.protsent_vypolneniya_okr',        's4_management_method'),
    ('biz.hr.protsent_vypolneniya_okr',        's4_has_dept_kpi'),
    ('biz.hr.protsent_vypolneniya_okr',        's4m_strategic_planning'),
    ('biz.hr.protsent_vypolneniya_okr',        's4m_planning_team_or_solo'),
    ('biz.hr.protsent_vypolneniya_okr',        's4m_dept_sync'),
    ('biz.produkt.dolya_rynka',                's1_industry'),
    ('biz.produkt.dolya_rynka',                's1_regions'),
    ('biz.produkt.dolya_rynka',                's5_top_regions'),
    ('biz.produkt.dolya_rynka',                's5_competitor_1'),
    ('biz.produkt.dolya_rynka',                's7n_competitor_1_analysis'),
    ('biz.produkt.dolya_eksporta',             's1_regions'),
    ('biz.produkt.dolya_eksporta',             's9n_revenue_sources'),
    ('biz.produkt.dolya_eksporta',             's5_top_regions'),
    ('biz.produkt.dolya_eksporta',             's2n_goal_3y_what'),
    ('biz.produkt.dolya_onlayn_prodazh',       's3_promo_channels'),
    ('biz.produkt.dolya_onlayn_prodazh',       's5_marketing_channels'),
    ('biz.produkt.dolya_onlayn_prodazh',       's7n_channels_table'),
    ('biz.produkt.dolya_onlayn_prodazh',       's9n_revenue_sources'),
    ('biz.produkt.dolya_onlayn_prodazh',       's12_marketing_platforms'),
    ('biz.produkt.aktivnykh_sku',              's3_products_description'),
    ('biz.produkt.aktivnykh_sku',              's1_products_list'),
    ('biz.produkt.aktivnykh_sku',              's5n_product_locomotive'),
    ('biz.produkt.aktivnykh_sku',              's12_erp'),
    ('biz.produkt.product_score_gri',          's3n_competitor_why_us'),
    ('biz.produkt.product_score_gri',          's3n_cannot_copy'),
    ('biz.produkt.product_score_gri',          's3n_competitors_better'),
    ('biz.produkt.product_score_gri',          's5_usp'),
    ('biz.produkt.product_score_gri',          's8n_metrics_table'),
    ('biz.klienty.aktivnykh_klientov',         's2_new_clients_2025'),
    ('biz.klienty.aktivnykh_klientov',         's2_repeat_clients_2025'),
    ('biz.klienty.aktivnykh_klientov',         's5n_client_list_table'),
    ('biz.klienty.churn_rate',                 's5n_will_return_nps'),
    ('biz.klienty.churn_rate',                 's6n_weak_funnel_points'),
    ('biz.klienty.nps',                        's5n_will_return_nps'),
    ('biz.klienty.nps',                        's5n_improve_suggestions'),
    ('biz.klienty.nps',                        's5n_top_questions'),
    ('biz.klienty.retention_30d',              's6n_journey_table'),
    ('biz.klienty.retention_30d',              's6n_post_sale_touchpoints'),
    ('biz.klienty.retention_30d',              's5n_funnel_lead_to_sale'),
    ('biz.klienty.arpu',                       's2_avg_check'),
    ('biz.klienty.arpu',                       's5n_upsell_crosssell'),
    ('biz.klienty.arpu',                       's5n_most_marginal'),
    ('biz.klienty.arpu',                       's2_ltv'),
    ('biz.klienty.vremya_dostavki_klienty',    's6n_journey_table'),
    ('biz.klienty.vremya_dostavki_klienty',    's8n_metrics_table'),
    ('kpi.obschaya_vyruchka_god',              's2_revenue_2024'),
    ('kpi.dolya_rynka_kpi',                    's1_competitors_list'),
    ('kpi.dolya_onlayn_prodazh_kpi',           's3_promo_channels'),
    ('kpi.dolya_onlayn_prodazh_kpi',           's5_marketing_channels'),
    ('kpi.dolya_eksporta_kpi',                 's1_regions'),
    ('kpi.roa_kpi',                            's9n_net_profit'),
    ('kpi.roa_kpi',                            's9n_net_margin'),
    ('kpi.srednee_chislo_sku_kpi',             's1_products_list'),
    ('kpi.srednee_chislo_sku_kpi',             's5n_product_locomotive'),
    ('kpi.sebestoimost_kpi',                   's2_gross_margin'),
    ('kpi.posescheniy_sayta_kpi',              's1_website'),
    ('kpi.posescheniy_sayta_kpi',              's5_marketing_channels'),
    ('kpi.follovery_sotsseti_kpi',             's1_social_media'),
    ('kpi.sredniy_chek_ecommerce_kpi',         's2_avg_check'),
    ('kpi.vremya_dostavki_kpi',                's5n_funnel_lead_to_sale'),
    ('kpi.nps_kpi',                            's5n_will_return_nps'),
    ('kpi.nps_kpi',                            's5n_improve_suggestions'),
    ('gri.gotovnost_osnovatelya',              's10_delegation_ready'),
    ('gri.gotovnost_osnovatelya',              's10_hours_on_ops'),
    ('gri.gotovnost_osnovatelya',              's4m_delegation_readiness'),
    ('gri.doverie_i_pozitsiya',                's3n_client_portrait'),
    ('gri.doverie_i_pozitsiya',                's3n_competitor_why_us'),
    ('gri.doverie_i_pozitsiya',                's3n_cannot_copy'),
    ('gri.doverie_i_pozitsiya',                's3n_competitors_better'),
    ('gri.doverie_i_pozitsiya',                's5n_why_bought'),
    ('gri.doverie_i_pozitsiya',                's5n_deciding_factor'),
    ('gri.doverie_i_pozitsiya',                's5n_will_return_nps'),
    ('gri.doverie_i_pozitsiya',                's10_brand_perception'),
    ('gri.stabilnost_kassy',                   's2_debt_load'),
    ('gri.stabilnost_kassy',                   's2_knows_breakeven'),
    ('gri.stabilnost_kassy',                   's9n_breakeven_point'),
    ('gri.stabilnost_kassy',                   's9n_planning_frequency'),
    ('gri.stabilnost_kassy',                   's9n_financial_blockers'),
    ('gri.produkt_i_spros',                    's3n_client_portrait'),
    ('gri.produkt_i_spros',                    's3n_client_problem'),
    ('gri.produkt_i_spros',                    's3n_problem_impact'),
    ('gri.produkt_i_spros',                    's3n_measurable_results'),
    ('gri.produkt_i_spros',                    's3n_competitor_why_us'),
    ('gri.produkt_i_spros',                    's3n_cannot_copy'),
    ('gri.produkt_i_spros',                    's5n_why_bought'),
    ('gri.produkt_i_spros',                    's5n_deciding_factor'),
    ('gri.produkt_i_spros',                    's8n_metrics_table'),
    ('gri.komanda',                            's4_dept_count'),
    ('gri.komanda',                            's4_has_org_chart'),
    ('gri.komanda',                            's4n_staffing_table'),
    ('gri.komanda',                            's4n_team_fit_12m'),
    ('gri.komanda',                            's4m_feedback_culture'),
    ('gri.komanda',                            's4m_cross_functional'),
    ('gri.komanda',                            's10_dept_assessment'),
    ('gri.komanda',                            's10_what_depts_lack'),
    ('gri.operatsii',                          's4_management_method'),
    ('gri.operatsii',                          's4_has_dept_kpi'),
    ('gri.operatsii',                          's4m_dept_regulations'),
    ('gri.operatsii',                          's4m_control_method'),
    ('gri.operatsii',                          's4m_strategic_planning'),
    ('gri.operatsii',                          's4m_report_frequency'),
    ('gri.operatsii',                          's4m_report_automated'),
    ('gri.operatsii',                          's4m_dept_sync'),
    ('goal.01.kolichestvo_novykh_lidov',       's5n_funnel_lead_to_sale'),
    ('goal.01.kolichestvo_tselevykh_lidov',    's5n_funnel_lead_to_call'),
    ('goal.01.kolichestvo_tselevykh_lidov',    's3n_client_portrait'),
    ('goal.01.kolichestvo_tselevykh_lidov',    's5_audience_segments'),
    ('goal.01.stoimost_lida_cpl',              's9n_expense_marketing'),
    ('goal.01.stoimost_lida_cpl',              's5_marketing_channels'),
    ('goal.01.stoimost_lida_cpl',              's7n_channels_table'),
    ('goal.01.stoimost_tselevogo_lida',        's9n_expense_marketing'),
    ('goal.01.stoimost_tselevogo_lida',        's5n_funnel_lead_to_call'),
    ('goal.01.raskhody_na_reklamu',            's5_marketing_budget_pct'),
    ('goal.01.summa_prodazh_s_kanala',         's5_marketing_channels'),
    ('goal.01.summa_prodazh_s_kanala',         's7n_channels_table'),
    ('goal.01.summa_prodazh_s_kanala',         's9n_revenue_sources'),
    ('goal.02.repeat_purchase_rate',           's2_repeat_clients_2024'),
    ('goal.02.repeat_purchase_rate',           's2_new_clients_2024'),
    ('goal.02.churn_rate',                     's5n_will_return_nps'),
    ('goal.02.ltv_lifetime_value',             's2_avg_check'),
    ('goal.02.srednee_kol_vo_pokupok',         's3_deals_2024'),
    ('goal.02.srednee_kol_vo_pokupok',         's2_new_clients_2024'),
    ('goal.02.srednee_kol_vo_pokupok',         's2_repeat_clients_2024'),
    ('goal.02.povtornaya_vyruchka',            's2_repeat_clients_2024'),
    ('goal.02.povtornaya_vyruchka',            's2_avg_check'),
    ('goal.02.povtornaya_vyruchka',            's9n_revenue_2024'),
    ('goal.03.dokhod_na_1_klienta',            's9n_revenue_2024'),
    ('goal.03.dokhod_na_1_klienta',            's2_new_clients_2024'),
    ('goal.03.dokhod_na_1_klienta',            's2_repeat_clients_2024'),
    ('goal.03.dolya_apselov',                  's5n_upsell_crosssell'),
    ('goal.03.dolya_apselov',                  's3_flagship_product'),
    ('goal.03.dolya_apselov',                  's5n_product_locomotive'),
    ('goal.03.summa_apselov',                  's5n_most_marginal'),
    ('goal.03.summa_apselov',                  's5n_upsell_crosssell'),
    ('goal.03.dolya_kross_prodazh',            's5n_upsell_crosssell'),
    ('goal.03.dolya_kross_prodazh',            's1_products_list'),
    ('goal.03.dolya_kross_prodazh',            's3_products_description'),
    ('goal.03.summa_krossellov',               's9n_revenue_sources'),
    ('goal.03.summa_krossellov',               's5n_entry_product'),
    ('goal.03.summa_krossellov',               's1_products_list'),
    ('goal.04.frequency',                      's3_deals_2024'),
    ('goal.04.frequency',                      's5n_rfm_analysis'),
    ('goal.04.repeat_purchase_rate',           's2_repeat_clients_2025'),
    ('goal.04.repeat_purchase_rate',           's2_new_clients_2025'),
    ('goal.04.repeat_purchase_rate',           's5n_will_return_nps'),
    ('goal.04.ltv',                            's2_avg_check'),
    ('goal.05.referral_rate_kol_vo',           's5n_how_found_us'),
    ('goal.05.referral_rate_kol_vo',           's7n_channels_table'),
    ('goal.05.referral_rate',                  's5n_how_found_us'),
    ('goal.05.referral_rate',                  's2_new_clients_2024'),
    ('goal.05.referral_rate',                  's2n_tried_for_growth'),
    ('goal.05.nps',                            's5n_will_return_nps'),
    ('goal.05.nps',                            's8n_metrics_table'),
    ('goal.05.lidov_po_rekomendatsii',         's5n_how_found_us'),
    ('goal.05.lidov_po_rekomendatsii',         's7n_channels_table'),
    ('goal.05.ugc_volume',                     's1_social_media'),
    ('goal.06.kol_vo_klientov_ot_konkurentov', 's5n_compared_with'),
    ('goal.06.kol_vo_klientov_ot_konkurentov', 's5n_deciding_factor'),
    ('goal.06.kol_vo_klientov_ot_konkurentov', 's5n_how_found_us'),
    ('goal.06.ot_konkurentov',                 's5n_compared_with'),
    ('goal.06.ot_konkurentov',                 's1_competitors_list'),
    ('goal.06.win_rate',                       's5n_compared_with'),
    ('goal.06.win_rate',                       's3n_competitor_why_us'),
    ('goal.06.win_rate',                       's3_deals_2024'),
    ('goal.06.win_rate',                       's3_rejections_2024'),
    ('goal.06.loss_rate',                      's3_rejections_2024'),
    ('goal.06.loss_rate',                      's3n_competitors_better'),
    ('goal.06.loss_rate',                      's5n_barriers'),
    ('goal.07.engagement_rate',                's7n_channels_table'),
    ('goal.07.engagement_rate',                's7n_content_strategy'),
    ('goal.07.cr_kontent_dialog',              's5n_funnel_lead_to_call'),
    ('goal.07.cr_kontent_dialog',              's6n_script_first_contact'),
    ('goal.07.cr_kontent_dialog',              's7n_content_strategy'),
    ('goal.07.cr_dialog_diagnostika',          's6n_script_meeting'),
    ('goal.07.cr_dialog_diagnostika',          's6n_weak_funnel_points'),
    ('goal.07.progretykh_lidov',               's3n_client_problem'),
    ('goal.07.progretykh_lidov',               's3n_problem_impact'),
    ('goal.07.progretykh_lidov',               's3n_if_unsolved'),
    ('goal.07.progretykh_lidov',               's5n_why_bought'),
    ('goal.07.time_to_interest',               's5n_how_found_us'),
    ('goal.07.time_to_interest',               's5n_intermediate_steps'),
    ('goal.08.sredniy_tsikl_zakrytiya',        's8n_metrics_table'),
    ('goal.08.lid_dialog_dni',                 's5n_funnel_lead_to_call'),
    ('goal.08.lid_dialog_dni',                 's6n_journey_table'),
    ('goal.08.dialog_vstrecha_dni',            's5n_funnel_call_to_meeting'),
    ('goal.08.dialog_vstrecha_dni',            's6n_script_first_contact'),
    ('goal.08.vstrecha_kp_dni',                's5n_funnel_meeting_to_kp'),
    ('goal.08.vstrecha_kp_dni',                's6n_script_proposal'),
    ('goal.08.kp_sdelka_dni',                  's5n_funnel_kp_to_sale'),
    ('goal.08.kp_sdelka_dni',                  's5n_barriers'),
    ('goal.09.ltv_cac',                        's2_ltv'),
    ('goal.09.ltv_cac',                        's2_cac'),
    ('goal.09.ltv_cac',                        's2_avg_check'),
    ('goal.09.cac_payback',                    's2_cac'),
    ('goal.09.cac_payback',                    's2_avg_check'),
    ('goal.09.cac_payback',                    's2_gross_margin'),
    ('goal.09.cac_payback',                    's9n_net_margin'),
    ('goal.10.lid_dialog',                     's5n_funnel_lead_to_sale'),
    ('goal.10.dialog_vstrecha',                's6n_script_first_contact'),
    ('goal.10.vstrecha_kp',                    's6n_script_meeting'),
    ('goal.10.kp_sdelka',                      's5n_barriers'),
    ('goal.10.kp_sdelka',                      's6n_script_proposal'),
    ('goal.10.time_to_response',               's12_telephony'),
    ('goal.10.time_to_response',               's12_messengers'),
    ('goal.10.time_to_close',                  's5n_funnel_lead_to_sale'),
    ('goal.11.win_rate',                       's3n_competitor_why_us'),
    ('goal.11.win_rate',                       's5n_compared_with'),
    ('goal.11.win_rate',                       's5n_deciding_factor'),
    ('goal.11.vybravshikh_vas',                's5n_compared_with'),
    ('goal.11.vybravshikh_vas',                's5n_deciding_factor'),
    ('goal.11.vybravshikh_vas',                's5n_why_bought'),
    ('goal.11.vybravshikh_vas',                's3n_cannot_copy'),
    ('goal.11.loss_rate',                      's3_rejections_2024'),
    ('goal.11.loss_rate',                      's3n_competitors_better'),
    ('goal.11.loss_rate',                      's5n_barriers'),
    ('goal.11.vybravshikh_konkurenta',         's7n_competitor_1_analysis'),
    ('goal.11.vybravshikh_konkurenta',         's7n_competitor_2_analysis'),
    ('goal.11.vybravshikh_konkurenta',         's7n_competitor_3_analysis'),
    ('goal.11.vybravshikh_konkurenta',         's10_competitor_comparison'),
    ('goal.11.vybravshikh_konkurenta',         's3n_competitors_better')
$$;

-- ─── 2. Removed (metric, document field) pairs ──────────────────────────────
CREATE OR REPLACE FUNCTION pg_temp.removed_document_sources_102()
RETURNS TABLE (metric_key TEXT, doc_type TEXT, field TEXT) LANGUAGE sql IMMUTABLE AS $$
  VALUES
    ('biz.finansy.ebitda', 'pl_report', 'net_profit'),
    ('biz.finansy.roa', 'balance_sheet', 'total_assets'),
    ('biz.finansy.roa', 'pl_report', 'net_profit'),
    ('biz.finansy.sebestoimost_indeks', 'pl_report', 'cogs'),
    ('biz.finansy.sebestoimost_indeks', 'ops_report', 'unit_cost'),
    ('biz.finansy.debitorskaya_zadolzhennost', 'crm_export', 'outstanding_invoices'),
    ('biz.marketing.ltv_cac', 'marketing_report', 'ltv_cac_ratio'),
    ('biz.marketing.lidov_v_mes', 'crm_export', 'leads_count_monthly'),
    ('biz.marketing.posescheniy_sayta_mes', 'marketing_report', 'website_traffic_monthly'),
    ('biz.prodazhi.ecommerce_sredniy_chek', 'marketing_report', 'ecommerce_avg_order_value'),
    ('biz.prodazhi.vyruchka_s_prodazhnika', 'pl_report', 'revenue'),
    ('biz.operatsii.vypolnenie_sla', 'ops_report', 'sla_tracker'),
    ('biz.operatsii.kol_vo_sku', 'other', 'sku_master_list'),
    ('biz.operatsii.brak_vozvraty', 'ops_report', 'returns_log'),
    ('biz.hr.kol_vo_sotrudnikov', 'other', 'staff_count'),
    ('biz.produkt.dolya_eksporta', 'pl_report', 'revenue_by_country'),
    ('biz.produkt.aktivnykh_sku', 'other', 'sku_master_list'),
    ('biz.klienty.aktivnykh_klientov', 'crm_export', 'active_clients_count'),
    ('biz.klienty.arpu', 'pl_report', 'avg_check'),
    ('kpi.roa_kpi', 'pl_report', 'net_profit'),
    ('kpi.roa_kpi', 'balance_sheet', 'total_assets'),
    ('kpi.sredniy_chek_ecommerce_kpi', 'pl_report', 'avg_check'),
    ('gri.stabilnost_kassy', 'pl_report', 'revenue'),
    ('gri.stabilnost_kassy', 'balance_sheet', 'accounts_receivable'),
    ('goal.01.raskhody_na_reklamu', 'marketing_report', 'marketing_total_spend'),
    ('goal.09.ltv_cac', 'marketing_report', 'ltv'),
    ('goal.09.cac_payback', 'pl_report', 'avg_check')
$$;

DELETE FROM public.metrics m
USING pg_temp.removed_survey_sources_102() r
WHERE m.metric_key = r.metric_key
  AND m.provenance -> 'picked' ->> 'type' = 'survey'
  AND m.provenance -> 'picked' ->> 'key' = r.source_key
  AND (m.provenance -> 'picked' -> 'coerce') IS NULL;

DELETE FROM public.metrics m
USING pg_temp.removed_document_sources_102() r
WHERE m.metric_key = r.metric_key
  AND m.provenance -> 'picked' ->> 'type' = 'document'
  AND m.provenance -> 'picked' ->> 'field' = r.field
  AND coalesce(m.provenance -> 'picked' ->> 'doc_type', '') = r.doc_type;

DO $$
BEGIN
  IF to_regclass('public.metric_value_history') IS NOT NULL THEN
    DELETE FROM public.metric_value_history h
    USING pg_temp.removed_survey_sources_102() r
    WHERE h.metric_key = r.metric_key
      AND h.provenance -> 'picked' ->> 'type' = 'survey'
      AND h.provenance -> 'picked' ->> 'key' = r.source_key
      AND (h.provenance -> 'picked' -> 'coerce') IS NULL;

    DELETE FROM public.metric_value_history h
    USING pg_temp.removed_document_sources_102() r
    WHERE h.metric_key = r.metric_key
      AND h.provenance -> 'picked' ->> 'type' = 'document'
      AND h.provenance -> 'picked' ->> 'field' = r.field
      AND coalesce(h.provenance -> 'picked' ->> 'doc_type', '') = r.doc_type;
  END IF;
END $$;

-- ─── 3. New units of metrics whose source stays declared ────────────────────
CREATE OR REPLACE FUNCTION pg_temp.metric_units_102()
RETURNS TABLE (metric_key TEXT, unit TEXT) LANGUAGE sql IMMUTABLE AS $$
  VALUES
    ('biz.finansy.debitorskaya_zadolzhennost', '₸'),
    ('biz.marketing.lidov_v_mes',              'count'),
    ('biz.marketing.nps',                      NULL),
    ('biz.klienty.nps',                        NULL),
    ('kpi.nps_kpi',                            NULL),
    ('goal.05.nps',                            NULL),
    ('biz.prodazhi.tsikl_zakrytiya_sdelki',    'days'),
    ('goal.10.time_to_close',                  'days'),
    ('biz.operatsii.kol_vo_sku',               'count'),
    ('biz.produkt.aktivnykh_sku',              'count'),
    ('kpi.srednee_chislo_sku_kpi',             'count')
$$;

-- The history trigger copies only value / source changes, so this UPDATE adds no history points.
UPDATE public.metrics m
SET metric_unit = u.unit
FROM pg_temp.metric_units_102() u
WHERE m.metric_key = u.metric_key
  AND m.metric_unit IS DISTINCT FROM u.unit;
