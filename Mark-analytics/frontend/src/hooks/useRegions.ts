import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { apiGet } from '../services/api';
import type { RegionMetric } from '../stores/map';

export type RegionFeatureProperties = {
  kato_code: string;
  /**
   * 2-digit region code (e.g. "75"). The region-distribution metric endpoint
   * keys regions by this value, so the choropleth join must prefer it.
   */
  kato2?: string;
  name_ru: string;
  name_en: string;
  name_kz: string;
  [key: string]: unknown;
};

export type RegionFeature = GeoJSON.Feature<
  GeoJSON.Polygon | GeoJSON.MultiPolygon,
  RegionFeatureProperties
>;

export type RegionFeatureCollection = GeoJSON.FeatureCollection<
  GeoJSON.Polygon | GeoJSON.MultiPolygon,
  RegionFeatureProperties
>;

export interface RegionDistributionRow {
  kato_code: string;
  name_ru?: string | null;
  value: number;
}

export interface RegionDistributionResponse {
  metric: RegionMetric;
  country: string;
  items: RegionDistributionRow[];
}

export interface IndustryBreakdown {
  code: string;
  label?: string | null;
  count: number;
  revenue_usd?: number | null;
}

export interface SizeBreakdown {
  bucket: string;
  count: number;
}

export interface TopCompany {
  id: string;
  name: string;
  industry_label?: string | null;
  revenue_usd?: number | null;
}

export interface ClusterStatsResponse {
  region_kato: string;
  region_name: string;
  total_companies: number;
  total_revenue?: number | null;
  total_employees?: number | null;
  by_industry: IndustryBreakdown[];
  by_size: SizeBreakdown[];
  top_5: TopCompany[];
}

/**
 * GeoJSON of KZ regions. Effectively immutable — fetched once per session.
 */
export function useRegionsGeo(): UseQueryResult<RegionFeatureCollection, Error> {
  return useQuery<RegionFeatureCollection, Error>({
    queryKey: ['geo', 'regions', 'kz'],
    queryFn: ({ signal }) =>
      apiGet<RegionFeatureCollection>('/api/v1/geo/regions/kz', undefined, signal),
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

export interface UseRegionDistributionOptions {
  metric: RegionMetric;
  country?: string;
  enabled?: boolean;
}

/**
 * Subscore keys returned by `GET /regions/risk`. A `null` value indicates the
 * backing table is not yet wired up; in that case the key is also present in
 * `meta.degraded` on the envelope.
 */
export type RegionRiskSubscoreKey =
  | 'liquidations_3m'
  | 'court_cases_6m'
  | 'sanctions_hits'
  | 'complaints_count';

export type RegionRiskSubscores = Record<RegionRiskSubscoreKey, number | null>;

export interface RegionRiskRow {
  kato_code: string;
  score: number;
  subscores: RegionRiskSubscores;
  updated_at: string;
}

/**
 * Metric values per region for choropleth coloring.
 *
 * When `metric === 'risk'` we pull from `/regions/risk` (composite score)
 * and adapt the response to the same `{kato_code, value}` shape the
 * choropleth already expects. For every other metric we use the original
 * analytics endpoint.
 */
export function useRegionDistribution(
  options: UseRegionDistributionOptions,
): UseQueryResult<RegionDistributionResponse, Error> {
  const { metric, country = 'KZ', enabled = true } = options;
  return useQuery<RegionDistributionResponse, Error>({
    queryKey: ['analytics', 'region-distribution', country, metric],
    enabled,
    queryFn: async ({ signal }) => {
      if (metric === 'risk') {
        const rows = await apiGet<RegionRiskRow[]>(
          '/api/v1/regions/risk',
          undefined,
          signal,
        );
        // Adapter: convert {kato_code, score} → {kato_code, value} so the
        // choropleth layer stays oblivious to which metric it's painting.
        const items: RegionDistributionRow[] = (rows ?? []).map((r) => ({
          kato_code: r.kato_code,
          value: r.score,
        }));
        return { metric, country, items };
      }
      return apiGet<RegionDistributionResponse>(
        '/api/v1/analytics/region-distribution',
        { country, metric },
        signal,
      );
    },
    staleTime: 5 * 60_000,
  });
}

/**
 * Full risk payload (score + subscores) for the breakdown table in
 * `RegionDrawer`. Returns the array as the api client already unwraps the
 * envelope; degraded subscores arrive as `null` values.
 */
export function useRegionRisk(
  options: { enabled?: boolean } = {},
): UseQueryResult<RegionRiskRow[], Error> {
  const { enabled = true } = options;
  return useQuery<RegionRiskRow[], Error>({
    queryKey: ['regions', 'risk'],
    enabled,
    queryFn: ({ signal }) =>
      apiGet<RegionRiskRow[]>('/api/v1/regions/risk', undefined, signal),
    staleTime: 5 * 60_000,
  });
}

export interface UseClusterStatsOptions {
  katoCode: string | null;
  enabled?: boolean;
}

/**
 * Tooltip / drawer payload for a single region. Disabled until a region is
 * hovered or selected.
 */
export function useClusterStats(
  options: UseClusterStatsOptions,
): UseQueryResult<ClusterStatsResponse, Error> {
  const { katoCode, enabled = true } = options;
  return useQuery<ClusterStatsResponse, Error>({
    queryKey: ['geo', 'cluster-stats', katoCode],
    enabled: Boolean(katoCode) && enabled,
    queryFn: ({ signal }) =>
      apiGet<ClusterStatsResponse>(
        '/api/v1/geo/companies/cluster-stats',
        { region_kato: katoCode ?? undefined },
        signal,
      ),
    staleTime: 60_000,
  });
}
