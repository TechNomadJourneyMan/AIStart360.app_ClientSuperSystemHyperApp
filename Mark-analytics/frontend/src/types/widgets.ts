/**
 * Track G — Custom Dashboard / Widget Builder type contract.
 *
 * These types mirror the backend API surface documented in the Track G spec.
 * They live in `src/types/widgets.ts` (rather than in the generated
 * `src/types/api.ts`) because the backend agent is shipping the endpoints
 * in parallel — once the OpenAPI spec lands the codegen will produce these
 * shapes and we can swap to the generated names without changing imports.
 */

/** Widget types supported in Phase 1. */
export type WidgetType = 'metric' | 'list' | 'chart' | 'map_mini' | 'news' | 'note';

/** Subscription tier gating each catalog entry. */
export type WidgetTier = 'free' | 'pro' | 'team' | 'enterprise';

/** Lucide icon identifier — kept as a string so the catalog can name any icon. */
export type LucideIconName = string;

/** Simple JSON Schema describing widget params (a minimal subset). */
export interface JsonSchemaProperty {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  title?: string;
  description?: string;
  enum?: ReadonlyArray<string | number>;
  enumLabels?: Readonly<Record<string, string>>;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  items?: { type: 'string' | 'number' | 'integer' };
  /** When `type === 'string'`, optional UI hint. */
  format?: 'text' | 'textarea' | 'color';
  /** Optional placeholder for input controls. */
  placeholder?: string;
}

export interface JsonSchema {
  type: 'object';
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
}

/** One entry of `GET /api/v1/widgets/catalog`. */
export interface WidgetCatalogEntry {
  type: WidgetType;
  name: string;
  description: string;
  icon: LucideIconName;
  tier: WidgetTier;
  schema: JsonSchema;
  default_params: Record<string, unknown>;
}

/** Persisted layout for a widget within `react-grid-layout`. */
export interface WidgetLayout {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
}

/** `GET /api/v1/widgets` element / `POST /api/v1/widgets` response. */
export interface WidgetRead {
  id: string;
  type: WidgetType;
  name: string;
  params: Record<string, unknown>;
  layout: WidgetLayout | null;
  order: number;
  created_at: string;
  updated_at: string;
}

/** Body for `POST /api/v1/widgets`. */
export interface WidgetCreate {
  type: WidgetType;
  name: string;
  params: Record<string, unknown>;
  layout?: WidgetLayout | null;
}

/** Body for `PATCH /api/v1/widgets/{id}`. */
export interface WidgetUpdate {
  name?: string;
  params?: Record<string, unknown>;
  layout?: WidgetLayout | null;
  order?: number;
}

/** Body for `POST /api/v1/widgets/reorder`. */
export interface WidgetReorderItem {
  id: string;
  order: number;
}

/** `POST /api/v1/widgets/{id}/data` response — discriminated by widget type. */
export interface WidgetDataMetric {
  value: number | null;
  label: string;
  format?: 'currency' | 'integer' | 'percent';
  delta?: number | null;
  delta_label?: string | null;
}

export interface WidgetDataListRow {
  [columnKey: string]: string | number | null | undefined;
}

export interface WidgetDataList {
  columns: Array<{ key: string; label: string; format?: 'currency' | 'integer' | 'percent' | 'date' }>;
  rows: WidgetDataListRow[];
  total?: number;
}

export type ChartKind = 'bar' | 'pie' | 'line';

export interface WidgetDataChart {
  chart_kind: ChartKind;
  series: Array<{ name: string; data: Array<{ x: string | number; y: number }> }>;
  x_label?: string;
  y_label?: string;
}

export interface WidgetDataMapMini {
  bbox: { west: number; south: number; east: number; north: number };
  /** Optional inline points; when absent, the renderer fetches via `useCompaniesGeo`. */
  points?: Array<{ id: string; longitude: number; latitude: number; name?: string }>;
}

export interface WidgetDataNewsItem {
  id: string;
  title: string;
  url?: string | null;
  source: string;
  published_at: string;
}

export interface WidgetDataNews {
  items: WidgetDataNewsItem[];
}

export interface WidgetDataNote {
  markdown: string;
}

export type WidgetData =
  | ({ type: 'metric' } & WidgetDataMetric)
  | ({ type: 'list' } & WidgetDataList)
  | ({ type: 'chart' } & WidgetDataChart)
  | ({ type: 'map_mini' } & WidgetDataMapMini)
  | ({ type: 'news' } & WidgetDataNews)
  | ({ type: 'note' } & WidgetDataNote);

/** Body for `POST /api/v1/widgets/ai-suggest`. */
export interface WidgetAiSuggestRequest {
  prompt: string;
  /** Optional — narrow suggestions to a specific widget type. */
  type?: WidgetType;
}

export interface WidgetAiSuggestSuccess {
  ok: true;
  type: WidgetType;
  name: string;
  params: Record<string, unknown>;
}

export interface WidgetAiSuggestFailure {
  ok: false;
  reason: 'schema_validation' | 'rate_limited' | 'no_match' | string;
  message: string;
}

export type WidgetAiSuggestResponse = WidgetAiSuggestSuccess | WidgetAiSuggestFailure;
