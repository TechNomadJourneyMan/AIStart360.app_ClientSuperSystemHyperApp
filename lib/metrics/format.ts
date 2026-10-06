// Light metric-source helpers, split out of the 171 KB lib/metrics/descriptions.ts
// so client surfaces (MetricsPageClient / MetricsLiveCatalog) can format a
// provenance label WITHOUT pulling the whole descriptions catalog into the
// /metrics first-load bundle. The heavy getters stay in descriptions.ts and are
// loaded on demand (drill-down / block modal). 2026-07-02.

export type MetricSourceType =
  | "survey"
  | "document"
  | "prisma"
  | "external"
  | "manual"
  /** Computed from other resolved metrics (lib/metrics/formulas.ts, `formula` = id). */
  | "formula"
  /** A section average of the company's GRI assessment (gri_assessments.section_avgs, `section`). */
  | "assessment"
  | "missing";

/** Period a flow value refers to. Absent on a metric = a point-in-time value, ratio or average. */
export type MetricPeriod = "year" | "quarter" | "month";

/**
 * How a survey answer becomes a number (lib/metrics/source-adapters.ts).
 * Absent ⇒ plain numeric coercion of the whole answer (the original rule).
 *
 *   flag           yes/no answers: true → 1, false → 0; a choice/text answer
 *                  meaning «нет» (none, нет, -, …, plus `falseValues`) → 0,
 *                  any other non-empty answer → 1.
 *   choice         option value → number via `map`; an option that is not in
 *                  the map is a miss (never guessed).
 *   count_selected multi-select / list answer → number of selected items; with
 *                  `keys`, the number of those keys whose answer is a real
 *                  tool/value (not «нет» and not in `exclude`).
 *   table_cell     one cell of the step-8 metrics table (s8n_metrics_table):
 *                  `row` (lib/survey/metrics-table.ts) and `column`
 *                  ('latest' = newest non-zero incl. «Факт 2026»,
 *                   'latest_full_year' = newest non-zero of 2025/2024/2023).
 *   table_sum      sum of a numeric `column` over the rows of a table answer
 *                  (s7n_channels_table, s4n_staffing_table); with `match`, only
 *                  rows whose `match.column` matches the case-insensitive
 *                  regex `match.pattern`. A miss when no row holds a number.
 */
export type SurveyCoercion =
  | { kind: "flag"; falseValues?: string[] }
  | { kind: "choice"; map: Record<string, number> }
  | { kind: "count_selected"; exclude?: string[] }
  | { kind: "table_cell"; row: string; column?: "latest" | "latest_full_year" | "y2023" | "y2024" | "y2025" | "plan_2026" | "fact_2026" }
  | { kind: "table_sum"; column: string; match?: { column: string; pattern: string } };

export interface MetricSource {
  type: MetricSourceType;
  step?: number;
  key?: string;
  /** Composite survey source: several question keys read together (with coerce.kind = 'count_selected'). */
  keys?: string[];
  /** Survey answer → number rule. Absent ⇒ plain numeric coercion. */
  coerce?: SurveyCoercion;
  label?: string;
  model?: string;
  field?: string;
  doc_type?: string;
  system?: string;
  note?: string;
  /**
   * Survey: a key the current 12-step wizard no longer writes
   * (lib/survey/steps.ts SURVEY_KEY_STEP). Read only as a low-priority
   * fallback for owners who answered the older form.
   */
  legacy?: boolean;
  /**
   * Period of the value this source yields («Лидов в месяц» = 'month'). The
   * resolver rescales it to the metric's period (month → year × 12 …) and
   * records the conversion. Absent = already in the metric's period.
   */
  period?: MetricPeriod;
  /**
   * Survey: the wizard field writes 0 for an empty input (`Number(x) || 0`) and
   * 0 is not a plausible real value (deal cycle, employees, a funnel stage) —
   * a stored 0 is read as «not answered».
   */
  zeroIsEmpty?: boolean;
  /** type 'formula': formula id in lib/metrics/formulas.ts. */
  formula?: string;
  /** type 'assessment': gri_assessments.section_avgs key (e.g. 'cash-stability'). */
  section?: string;
}

export function formatSource(src: MetricSource): string {
  switch (src.type) {
    case "survey":
      return `Анкета шаг ${src.step}: ${src.label ?? src.key ?? (src.keys ?? []).join(", ")}${src.legacy ? " (старая версия анкеты)" : ""}`;
    case "document":
      return `Документ (${src.doc_type}): поле ${src.field}`;
    case "prisma":
      return `БД: ${src.model}.${src.field}`;
    case "external":
      return `Внешний: ${src.system}${src.note ? ` — ${src.note}` : ""}`;
    case "manual":
      return `Ручной ввод${src.note ? `: ${src.note}` : ""}`;
    case "formula":
      return `Расчёт${src.note ? `: ${src.note}` : ""}`;
    case "assessment":
      return `Оценка GRI${src.note ? `: ${src.note}` : ""}`;
    case "missing":
      return `⚠ Источник не подключён${src.note ? `: ${src.note}` : ""}`;
    default:
      return JSON.stringify(src);
  }
}
