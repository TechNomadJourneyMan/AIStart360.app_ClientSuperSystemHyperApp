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

export interface MetricSource {
  type: MetricSourceType;
  step?: number;
  key?: string;
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
      return `Анкета шаг ${src.step}: ${src.label ?? src.key}`;
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
