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
  | "missing";

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
 */
export type SurveyCoercion =
  | { kind: "flag"; falseValues?: string[] }
  | { kind: "choice"; map: Record<string, number> }
  | { kind: "count_selected"; exclude?: string[] }
  | { kind: "table_cell"; row: string; column?: "latest" | "latest_full_year" | "y2023" | "y2024" | "y2025" | "plan_2026" | "fact_2026" };

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
}

export function formatSource(src: MetricSource): string {
  switch (src.type) {
    case "survey":
      return `Анкета шаг ${src.step}: ${src.label ?? src.key ?? (src.keys ?? []).join(", ")}`;
    case "document":
      return `Документ (${src.doc_type}): поле ${src.field}`;
    case "prisma":
      return `БД: ${src.model}.${src.field}`;
    case "external":
      return `Внешний: ${src.system}${src.note ? ` — ${src.note}` : ""}`;
    case "manual":
      return `Ручной ввод${src.note ? `: ${src.note}` : ""}`;
    case "missing":
      return `⚠ Источник не подключён${src.note ? `: ${src.note}` : ""}`;
    default:
      return JSON.stringify(src);
  }
}
