import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { apiGet } from '../services/api';

const API_PREFIX = '/api/v1';

export interface AnalyticsOverview {
  total_companies: number;
  active_companies?: number;
  total_revenue?: number | null;
  total_employees?: number | null;
  [k: string]: unknown;
}

// Backend returns flat arrays under `data`. Hooks here adapt the shape that
// the widgets expect (`buckets` / `items`) so widget components stay simple.

export interface DistributionBucket {
  key: string;
  label?: string | null;
  count: number;
  revenue?: number | null;
  [k: string]: unknown;
}

export interface DistributionResponse {
  buckets: DistributionBucket[];
  total?: number;
}

export interface GrowthLeader {
  id: string;
  name: string;
  revenue?: number | null;
  industry?: string | null;
  region?: string | null;
  growth?: number | null;
  [k: string]: unknown;
}

export interface GrowthLeadersResponse {
  items: GrowthLeader[];
}

function adaptIndustry(raw: unknown[]): DistributionBucket[] {
  return raw.map((r) => {
    const x = r as Record<string, unknown>;
    return {
      key: (x.industry_code as string) ?? '—',
      label: (x.industry_label as string) ?? (x.industry_code as string) ?? null,
      count: Number(x.companies ?? 0),
      revenue: x.revenue_usd != null ? Number(x.revenue_usd) : null,
    };
  });
}

function adaptRegion(raw: unknown[]): DistributionBucket[] {
  return raw.map((r) => {
    const x = r as Record<string, unknown>;
    return {
      key: (x.region_kato as string) ?? '—',
      label: (x.region_name as string) ?? (x.region_kato as string) ?? null,
      count: Number(x.value ?? 0),
    };
  });
}

function adaptSize(raw: unknown[]): DistributionBucket[] {
  return raw.map((r) => {
    const x = r as Record<string, unknown>;
    return {
      key: (x.size_category as string) ?? '—',
      label: (x.size_category as string) ?? null,
      count: Number(x.companies ?? x.count ?? 0),
      revenue: x.revenue_usd != null ? Number(x.revenue_usd) : null,
    };
  });
}

function adaptLeaders(raw: unknown[]): GrowthLeader[] {
  return raw.map((r) => {
    const x = r as Record<string, unknown>;
    return {
      id: (x.id as string) ?? crypto.randomUUID(),
      name: (x.name as string) ?? 'Unknown',
      revenue: x.revenue_usd != null ? Number(x.revenue_usd) : null,
      industry: (x.industry_label as string) ?? (x.industry_code as string) ?? null,
      region: (x.region_name as string) ?? null,
    };
  });
}

export function useAnalyticsOverview(): UseQueryResult<AnalyticsOverview, Error> {
  return useQuery<AnalyticsOverview, Error>({
    queryKey: ['analytics', 'overview'],
    queryFn: ({ signal }) =>
      apiGet<AnalyticsOverview>(`${API_PREFIX}/analytics/overview`, undefined, signal),
  });
}

export function useIndustryDistribution(): UseQueryResult<DistributionResponse, Error> {
  return useQuery<DistributionResponse, Error>({
    queryKey: ['analytics', 'industry-distribution'],
    queryFn: async ({ signal }) => {
      const raw = await apiGet<unknown[]>(
        `${API_PREFIX}/analytics/industry-distribution`,
        undefined,
        signal,
      );
      return { buckets: adaptIndustry(raw ?? []), total: raw?.length ?? 0 };
    },
  });
}

export function useRegionDistribution(): UseQueryResult<DistributionResponse, Error> {
  return useQuery<DistributionResponse, Error>({
    queryKey: ['analytics', 'region-distribution'],
    queryFn: async ({ signal }) => {
      const raw = await apiGet<unknown[]>(
        `${API_PREFIX}/analytics/region-distribution`,
        { country: 'KZ', metric: 'count' },
        signal,
      );
      return { buckets: adaptRegion(raw ?? []), total: raw?.length ?? 0 };
    },
    retry: 0,
  });
}

export function useSizeDistribution(): UseQueryResult<DistributionResponse, Error> {
  return useQuery<DistributionResponse, Error>({
    queryKey: ['analytics', 'size-distribution'],
    queryFn: async ({ signal }) => {
      const raw = await apiGet<unknown[]>(
        `${API_PREFIX}/analytics/size-distribution`,
        undefined,
        signal,
      );
      return { buckets: adaptSize(raw ?? []), total: raw?.length ?? 0 };
    },
  });
}

export function useGrowthLeaders(limit = 10): UseQueryResult<GrowthLeadersResponse, Error> {
  return useQuery<GrowthLeadersResponse, Error>({
    queryKey: ['analytics', 'growth-leaders', limit],
    queryFn: async ({ signal }) => {
      const raw = await apiGet<unknown[]>(
        `${API_PREFIX}/analytics/growth-leaders`,
        { limit },
        signal,
      );
      return { items: adaptLeaders(raw ?? []) };
    },
  });
}

export interface RecentTender {
  id: string;
  title: string;
  amount?: number | null;
  currency?: string | null;
  status?: string | null;
  customer?: string | null;
  deadline?: string | null;
  published_at?: string | null;
  source?: string | null;
  source_url?: string | null;
  url?: string | null;
}

export interface RecentTendersResponse {
  items: RecentTender[];
  empty: boolean;
}

export function useRecentTenders(limit = 10): UseQueryResult<RecentTendersResponse, Error> {
  return useQuery<RecentTendersResponse, Error>({
    queryKey: ['tenders', 'recent', limit],
    queryFn: async ({ signal }) => {
      // apiGet unwraps the standard envelope's `.data` field for us, so we
      // get the raw array. Fall back gracefully if the legacy stub shape
      // (`{items: []}`) ever resurfaces.
      const raw = await apiGet<unknown>(
        `${API_PREFIX}/tenders/recent`,
        { limit },
        signal,
      ).catch(() => null);
      let items: RecentTender[] = [];
      if (Array.isArray(raw)) {
        items = raw as RecentTender[];
      } else if (raw && typeof raw === 'object') {
        const obj = raw as { items?: unknown };
        if (Array.isArray(obj.items)) items = obj.items as RecentTender[];
      }
      return { items, empty: items.length === 0 };
    },
    retry: 0,
  });
}

// ---------------------------------------------------------------------------
// Overview-page hooks (§11 PR #6)
// ---------------------------------------------------------------------------

export interface CountryDistributionBucket {
  country: string;
  companies: number;
  active: number;
  revenue_usd: number | null;
}

export interface CountryDistributionResponse {
  buckets: CountryDistributionBucket[];
}

function adaptCountry(raw: unknown[]): CountryDistributionBucket[] {
  return raw.map((r) => {
    const x = r as Record<string, unknown>;
    return {
      country: (x.country as string) ?? '—',
      companies: Number(x.companies ?? 0),
      active: Number(x.active ?? 0),
      revenue_usd: x.revenue_usd != null ? Number(x.revenue_usd) : null,
    };
  });
}

export function useCountryDistribution(): UseQueryResult<CountryDistributionResponse, Error> {
  return useQuery<CountryDistributionResponse, Error>({
    queryKey: ['analytics', 'country-distribution'],
    queryFn: async ({ signal }) => {
      const raw = await apiGet<unknown[]>(
        `${API_PREFIX}/analytics/country-distribution`,
        undefined,
        signal,
      ).catch(() => [] as unknown[]);
      return { buckets: adaptCountry(raw ?? []) };
    },
    retry: 0,
  });
}

export type InsightSeverity = 'info' | 'success' | 'warn' | 'critical';

export interface HeuristicInsight {
  severity: InsightSeverity;
  title: string;
  body: string;
  evidence?: Record<string, unknown>;
}

export interface HeuristicInsightsResponse {
  items: HeuristicInsight[];
}

export function useHeuristicInsights(): UseQueryResult<HeuristicInsightsResponse, Error> {
  return useQuery<HeuristicInsightsResponse, Error>({
    queryKey: ['analytics', 'insights'],
    queryFn: async ({ signal }) => {
      const raw = await apiGet<unknown>(
        `${API_PREFIX}/analytics/insights`,
        undefined,
        signal,
      ).catch(() => null);
      const items = Array.isArray(raw) ? raw : ((raw as { items?: unknown[] })?.items ?? []);
      return {
        items: (items as HeuristicInsight[]).map((i) => ({
          severity: (i.severity ?? 'info') as InsightSeverity,
          title: i.title ?? '',
          body: i.body ?? '',
          evidence: i.evidence,
        })),
      };
    },
    retry: 0,
  });
}

export type SignalKind = 'registration' | 'tender_win' | 'executive_change' | 'other';

export interface SignalItem {
  id: string;
  kind: SignalKind;
  title: string;
  company_name?: string | null;
  company_id?: string | null;
  amount?: number | null;
  occurred_at?: string | null;
  /** When true, item was synthesised from another endpoint (no real signals feed). */
  preview?: boolean;
}

export interface SignalsResponse {
  items: SignalItem[];
  preview: boolean;
}

export function useRecentSignals(limit = 10): UseQueryResult<SignalsResponse, Error> {
  return useQuery<SignalsResponse, Error>({
    queryKey: ['signals', 'recent', limit],
    queryFn: async ({ signal }) => {
      // Preferred: /signals/recent (stub endpoint that may not exist yet).
      const raw = await apiGet<unknown>(
        `${API_PREFIX}/signals/recent`,
        { limit },
        signal,
      ).catch(() => null);
      if (raw) {
        const items = Array.isArray(raw)
          ? (raw as SignalItem[])
          : (((raw as { items?: SignalItem[] }).items ?? []) as SignalItem[]);
        if (items.length > 0) {
          return { items: items.slice(0, limit), preview: false };
        }
      }
      // Fallback: synthesize "preview" signals from growth-leaders so the UI
      // never renders empty — clearly labelled with `preview: true`.
      const leaders = await apiGet<unknown[]>(
        `${API_PREFIX}/analytics/growth-leaders`,
        { limit },
        signal,
      ).catch(() => [] as unknown[]);
      const items: SignalItem[] = (leaders ?? []).slice(0, limit).map((row) => {
        const x = row as Record<string, unknown>;
        return {
          id: String(x.id ?? crypto.randomUUID()),
          kind: 'other',
          title: 'Recent activity',
          company_name: (x.name as string) ?? null,
          company_id: (x.id as string) ?? null,
          amount: x.revenue_usd != null ? Number(x.revenue_usd) : null,
          occurred_at: null,
          preview: true,
        };
      });
      return { items, preview: true };
    },
    retry: 0,
  });
}
