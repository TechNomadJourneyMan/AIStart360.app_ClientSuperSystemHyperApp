/**
 * Track G — in-memory mocks used while the backend is still landing.
 *
 * Gated by `import.meta.env.VITE_WIDGETS_API_READY`:
 *   - falsy/unset  → hooks use these mocks (default during dev)
 *   - 'true'/'1'   → hooks hit real `/api/v1/widgets/*`
 *
 * The mocks intentionally mimic the on-the-wire shape (no envelope —
 * `apiGet` strips the envelope, so mocks return the inner `data` payload).
 */

import type {
  WidgetAiSuggestRequest,
  WidgetAiSuggestResponse,
  WidgetCatalogEntry,
  WidgetCreate,
  WidgetData,
  WidgetRead,
  WidgetReorderItem,
  WidgetUpdate,
} from '@/types/widgets';

const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;

export function isWidgetsApiReady(): boolean {
  const flag = env.VITE_WIDGETS_API_READY;
  return flag === 'true' || flag === '1';
}

// ---------------------------------------------------------------------------
// Catalog — 6 entries (one per widget type)
// ---------------------------------------------------------------------------

export const MOCK_CATALOG: ReadonlyArray<WidgetCatalogEntry> = [
  {
    type: 'metric',
    name: 'Metric',
    description: 'A single headline number — total companies, GDP, exports…',
    icon: 'Gauge',
    tier: 'free',
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string', title: 'Title', placeholder: 'Companies in KZ' },
        source: {
          type: 'string',
          title: 'Source',
          enum: ['companies_count', 'gdp_total', 'inflation', 'fx_kzt_usd'],
          enumLabels: {
            companies_count: 'Companies count',
            gdp_total: 'GDP total (USD)',
            inflation: 'Inflation YoY',
            fx_kzt_usd: 'FX: KZT/USD',
          },
          default: 'companies_count',
        },
        format: {
          type: 'string',
          title: 'Format',
          enum: ['integer', 'currency', 'percent'],
          default: 'integer',
        },
        show_delta: { type: 'boolean', title: 'Show change vs prev period', default: true },
      },
      required: ['title', 'source'],
    },
    default_params: { title: 'Companies in KZ', source: 'companies_count', format: 'integer', show_delta: true },
  },
  {
    type: 'list',
    name: 'List',
    description: 'A small table — top companies, recent tenders, news.',
    icon: 'List',
    tier: 'free',
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string', title: 'Title', placeholder: 'Top companies' },
        source: {
          type: 'string',
          title: 'Source',
          enum: ['top_companies', 'recent_tenders', 'recent_news'],
          enumLabels: {
            top_companies: 'Top companies by revenue',
            recent_tenders: 'Recent tenders',
            recent_news: 'Recent news',
          },
          default: 'top_companies',
        },
        columns: {
          type: 'array',
          title: 'Columns',
          items: { type: 'string' },
          default: ['name', 'industry', 'revenue'],
        },
        limit: { type: 'integer', title: 'Rows', default: 10, minimum: 3, maximum: 50 },
      },
      required: ['title', 'source'],
    },
    default_params: { title: 'Top companies', source: 'top_companies', columns: ['name', 'industry', 'revenue'], limit: 10 },
  },
  {
    type: 'chart',
    name: 'Chart',
    description: 'Bar, pie, or line chart for distributions and trends.',
    icon: 'BarChart3',
    tier: 'pro',
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string', title: 'Title', placeholder: 'Industry mix' },
        chart_kind: {
          type: 'string',
          title: 'Chart type',
          enum: ['bar', 'pie', 'line'],
          default: 'bar',
        },
        source: {
          type: 'string',
          title: 'Source',
          enum: ['industry_mix', 'size_mix', 'gdp_trend'],
          enumLabels: {
            industry_mix: 'Industry mix',
            size_mix: 'Company size mix',
            gdp_trend: 'GDP trend',
          },
          default: 'industry_mix',
        },
      },
      required: ['title', 'chart_kind', 'source'],
    },
    default_params: { title: 'Industry mix', chart_kind: 'bar', source: 'industry_mix' },
  },
  {
    type: 'map_mini',
    name: 'Mini map',
    description: 'A compact map focused on a region or bbox.',
    icon: 'Map',
    tier: 'pro',
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string', title: 'Title', placeholder: 'Almaty companies' },
        region_kato: { type: 'string', title: 'Region KATO code (optional)' },
        bbox_west: { type: 'number', title: 'BBox west', default: 46 },
        bbox_south: { type: 'number', title: 'BBox south', default: 40 },
        bbox_east: { type: 'number', title: 'BBox east', default: 87 },
        bbox_north: { type: 'number', title: 'BBox north', default: 55 },
      },
      required: ['title'],
    },
    default_params: { title: 'KZ map', bbox_west: 46, bbox_south: 40, bbox_east: 87, bbox_north: 55 },
  },
  {
    type: 'news',
    name: 'News',
    description: 'Headline list filtered by topic or industry.',
    icon: 'Newspaper',
    tier: 'free',
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string', title: 'Title', placeholder: 'Energy news' },
        topics: {
          type: 'array',
          title: 'Topics',
          items: { type: 'string' },
          default: [],
        },
        limit: { type: 'integer', title: 'Items', default: 8, minimum: 3, maximum: 30 },
      },
      required: ['title'],
    },
    default_params: { title: 'News', topics: [], limit: 8 },
  },
  {
    type: 'note',
    name: 'Note',
    description: 'A free-form markdown note pinned to your dashboard.',
    icon: 'StickyNote',
    tier: 'free',
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string', title: 'Title', placeholder: 'Reminder' },
        markdown: {
          type: 'string',
          title: 'Markdown',
          format: 'textarea',
          default: '# Note\n\nWrite anything here.',
        },
      },
      required: ['title', 'markdown'],
    },
    default_params: { title: 'Note', markdown: '# Note\n\nWrite anything here.' },
  },
];

// ---------------------------------------------------------------------------
// User widgets — mutable in-memory store
// ---------------------------------------------------------------------------

let mockIdCounter = 1;
const nowIso = (): string => new Date().toISOString();

let mockUserWidgets: WidgetRead[] = [
  {
    id: 'w_demo_1',
    type: 'metric',
    name: 'Companies in KZ',
    params: { title: 'Companies in KZ', source: 'companies_count', format: 'integer', show_delta: true },
    layout: { i: 'w_demo_1', x: 0, y: 0, w: 3, h: 2 },
    order: 0,
    created_at: '2026-05-01T00:00:00Z',
    updated_at: '2026-05-01T00:00:00Z',
  },
  {
    id: 'w_demo_2',
    type: 'chart',
    name: 'Industry mix',
    params: { title: 'Industry mix', chart_kind: 'bar', source: 'industry_mix' },
    layout: { i: 'w_demo_2', x: 3, y: 0, w: 6, h: 3 },
    order: 1,
    created_at: '2026-05-01T00:00:00Z',
    updated_at: '2026-05-01T00:00:00Z',
  },
  {
    id: 'w_demo_3',
    type: 'list',
    name: 'Top companies',
    params: { title: 'Top companies', source: 'top_companies', columns: ['name', 'industry', 'revenue'], limit: 8 },
    layout: { i: 'w_demo_3', x: 0, y: 2, w: 6, h: 3 },
    order: 2,
    created_at: '2026-05-01T00:00:00Z',
    updated_at: '2026-05-01T00:00:00Z',
  },
];

export function mockListWidgets(): WidgetRead[] {
  return mockUserWidgets.slice().sort((a, b) => a.order - b.order);
}

export function mockCreateWidget(body: WidgetCreate): WidgetRead {
  mockIdCounter += 1;
  const id = `w_mock_${mockIdCounter}`;
  const order = mockUserWidgets.length;
  const widget: WidgetRead = {
    id,
    type: body.type,
    name: body.name,
    params: { ...body.params },
    layout: body.layout ?? { i: id, x: 0, y: 99, w: 4, h: 3 },
    order,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  mockUserWidgets = [...mockUserWidgets, widget];
  return widget;
}

export function mockUpdateWidget(id: string, patch: WidgetUpdate): WidgetRead {
  const idx = mockUserWidgets.findIndex((w) => w.id === id);
  if (idx === -1) throw new Error(`widget ${id} not found`);
  const prev = mockUserWidgets[idx];
  if (!prev) throw new Error(`widget ${id} not found`);
  const next: WidgetRead = {
    ...prev,
    ...('name' in patch && patch.name !== undefined ? { name: patch.name } : {}),
    ...('params' in patch && patch.params !== undefined ? { params: { ...prev.params, ...patch.params } } : {}),
    ...('layout' in patch ? { layout: patch.layout ?? null } : {}),
    ...('order' in patch && patch.order !== undefined ? { order: patch.order } : {}),
    updated_at: nowIso(),
  };
  mockUserWidgets = mockUserWidgets.map((w) => (w.id === id ? next : w));
  return next;
}

export function mockDeleteWidget(id: string): void {
  mockUserWidgets = mockUserWidgets.filter((w) => w.id !== id);
}

export function mockReorderWidgets(items: WidgetReorderItem[]): WidgetRead[] {
  const orderMap = new Map(items.map((it) => [it.id, it.order]));
  mockUserWidgets = mockUserWidgets.map((w) =>
    orderMap.has(w.id) ? { ...w, order: orderMap.get(w.id) ?? w.order, updated_at: nowIso() } : w,
  );
  return mockListWidgets();
}

// ---------------------------------------------------------------------------
// Widget data — deterministic canned payloads per type
// ---------------------------------------------------------------------------

export function mockWidgetData(widget: WidgetRead): WidgetData {
  const params = widget.params;
  switch (widget.type) {
    case 'metric': {
      const title = typeof params.title === 'string' ? params.title : widget.name;
      const format = (params.format as 'currency' | 'integer' | 'percent' | undefined) ?? 'integer';
      const value = format === 'percent' ? 8.4 : format === 'currency' ? 235_000_000_000 : 12_847;
      return {
        type: 'metric',
        value,
        label: title,
        format,
        delta: params.show_delta ? 3.1 : null,
        delta_label: params.show_delta ? 'vs last month' : null,
      };
    }
    case 'list': {
      const columns = Array.isArray(params.columns) && params.columns.every((c) => typeof c === 'string')
        ? (params.columns as string[])
        : ['name', 'industry', 'revenue'];
      const colDefs = columns.map((key) => ({ key, label: key.charAt(0).toUpperCase() + key.slice(1) }));
      const rows: Array<Record<string, string | number>> = [
        { name: 'KazMunayGas', industry: 'Energy', revenue: 12_400_000_000 },
        { name: 'Kazatomprom', industry: 'Mining', revenue: 3_900_000_000 },
        { name: 'Kazakhtelecom', industry: 'Telecom', revenue: 1_200_000_000 },
        { name: 'Halyk Bank', industry: 'Banking', revenue: 2_700_000_000 },
        { name: 'Air Astana', industry: 'Aviation', revenue: 980_000_000 },
        { name: 'KEGOC', industry: 'Utilities', revenue: 540_000_000 },
        { name: 'Kaspi.kz', industry: 'Fintech', revenue: 2_100_000_000 },
        { name: 'Eurasian Resources', industry: 'Mining', revenue: 4_500_000_000 },
      ];
      const limit = typeof params.limit === 'number' ? params.limit : 10;
      return {
        type: 'list',
        columns: colDefs,
        rows: rows.slice(0, limit),
        total: rows.length,
      };
    }
    case 'chart': {
      const kind = (params.chart_kind as 'bar' | 'pie' | 'line' | undefined) ?? 'bar';
      const series =
        kind === 'line'
          ? [
              {
                name: 'GDP',
                data: [
                  { x: '2021', y: 197 },
                  { x: '2022', y: 220 },
                  { x: '2023', y: 235 },
                  { x: '2024', y: 261 },
                  { x: '2025', y: 287 },
                ],
              },
            ]
          : [
              {
                name: 'Companies',
                data: [
                  { x: 'Energy', y: 1240 },
                  { x: 'Mining', y: 860 },
                  { x: 'Banking', y: 540 },
                  { x: 'Telecom', y: 410 },
                  { x: 'Retail', y: 2300 },
                  { x: 'Other', y: 1820 },
                ],
              },
            ];
      return { type: 'chart', chart_kind: kind, series, x_label: 'Industry', y_label: 'Count' };
    }
    case 'map_mini': {
      const west = typeof params.bbox_west === 'number' ? params.bbox_west : 46;
      const south = typeof params.bbox_south === 'number' ? params.bbox_south : 40;
      const east = typeof params.bbox_east === 'number' ? params.bbox_east : 87;
      const north = typeof params.bbox_north === 'number' ? params.bbox_north : 55;
      return { type: 'map_mini', bbox: { west, south, east, north } };
    }
    case 'news': {
      const limit = typeof params.limit === 'number' ? params.limit : 8;
      const items = [
        { id: 'n1', title: 'KazMunayGas posts record Q1 profit', source: 'Bloomberg', published_at: '2026-05-27T08:00:00Z' },
        { id: 'n2', title: 'NBK keeps base rate at 14.75%', source: 'Reuters', published_at: '2026-05-26T11:30:00Z' },
        { id: 'n3', title: 'Kaspi.kz expands to Uzbekistan', source: 'FT', published_at: '2026-05-25T15:00:00Z' },
        { id: 'n4', title: 'Astana hub launches new direct route', source: 'Aviation Daily', published_at: '2026-05-24T09:00:00Z' },
        { id: 'n5', title: 'Tenge stable amid oil rally', source: 'Bloomberg', published_at: '2026-05-23T14:00:00Z' },
        { id: 'n6', title: 'Uranium output up 4% YoY', source: 'Mining Weekly', published_at: '2026-05-22T10:00:00Z' },
        { id: 'n7', title: 'Wheat exports beat forecast', source: 'AgriPress', published_at: '2026-05-21T07:00:00Z' },
        { id: 'n8', title: 'Halyk Bank rolls out new SME loans', source: 'Reuters', published_at: '2026-05-20T12:00:00Z' },
      ];
      return { type: 'news', items: items.slice(0, limit) };
    }
    case 'note': {
      const markdown =
        typeof params.markdown === 'string' ? params.markdown : '# Note\n\nDouble-click to edit.';
      return { type: 'note', markdown };
    }
  }
}

// ---------------------------------------------------------------------------
// AI suggest — keyword-driven mock
// ---------------------------------------------------------------------------

export function mockAiSuggest(req: WidgetAiSuggestRequest): WidgetAiSuggestResponse {
  const prompt = req.prompt.toLowerCase();
  if (!prompt.trim()) {
    return { ok: false, reason: 'schema_validation', message: 'Prompt is empty.' };
  }
  if (prompt.includes('news') || prompt.includes('headlines')) {
    return { ok: true, type: 'news', name: 'News', params: { title: 'News', topics: [], limit: 8 } };
  }
  if (prompt.includes('map') || prompt.includes('region')) {
    return {
      ok: true,
      type: 'map_mini',
      name: 'Region map',
      params: { title: 'Region map', bbox_west: 46, bbox_south: 40, bbox_east: 87, bbox_north: 55 },
    };
  }
  if (prompt.includes('top') || prompt.includes('list') || prompt.includes('companies')) {
    return {
      ok: true,
      type: 'list',
      name: 'Top companies',
      params: { title: 'Top companies', source: 'top_companies', columns: ['name', 'industry', 'revenue'], limit: 10 },
    };
  }
  if (prompt.includes('gdp') || prompt.includes('inflation') || prompt.includes('rate')) {
    return {
      ok: true,
      type: 'metric',
      name: 'Macro metric',
      params: { title: 'GDP total', source: 'gdp_total', format: 'currency', show_delta: true },
    };
  }
  if (prompt.includes('chart') || prompt.includes('mix') || prompt.includes('trend')) {
    return {
      ok: true,
      type: 'chart',
      name: 'Industry mix',
      params: { title: 'Industry mix', chart_kind: 'bar', source: 'industry_mix' },
    };
  }
  if (prompt.includes('note') || prompt.includes('reminder')) {
    return { ok: true, type: 'note', name: 'Note', params: { title: 'Note', markdown: '# Note\n\n' + req.prompt } };
  }
  return {
    ok: false,
    reason: 'no_match',
    message: 'Could not find a matching widget for that prompt.',
  };
}
