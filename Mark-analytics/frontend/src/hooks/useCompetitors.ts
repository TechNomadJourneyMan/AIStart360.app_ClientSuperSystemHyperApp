import { useMutation, useQuery, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';

import { apiGet, apiPost } from '../services/api';
import type { CompanyPoint } from '../components/map/MapShell';

const API_PREFIX = '/api/v1/competitors';

// ---------------------------------------------------------------------------
// Contract types (see docs/competitor-analysis-contract.md). Defined here
// explicitly rather than relying on generated `src/types/api.ts`, which may
// lag the backend.
// ---------------------------------------------------------------------------

export interface CompetitorOption {
  key: string;
  label: string;
}

export interface CompetitorOptions {
  categories: CompetitorOption[];
  audiences: CompetitorOption[];
  stages: CompetitorOption[];
  prices: CompetitorOption[];
  regions: CompetitorOption[];
}

/** Request body shared by `wizard` and `market-map`. */
export interface WizardAnswers {
  category: string;
  audience?: string | null;
  stage?: string | null;
  regions?: string[];
  price?: string | null;
  limit?: number;
  addressable_pct?: number;
  obtainable_pct?: number;
}

export interface MatchedNiche {
  category: string;
  category_label: string;
  industries?: string[];
  nace_sections?: string[];
  audience?: string | null;
  stage?: string | null;
  regions?: string[];
  price_segment?: string | null;
  tags_required?: string[];
}

export interface Competitor {
  id: string;
  name: string;
  country?: string | null;
  industry_code?: string | null;
  industry_label?: string | null;
  employee_count?: number | null;
  revenue_usd?: number | null;
  website?: string | null;
  tags?: string[];
  tag_match_score?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  region_name?: string | null;
  city_name?: string | null;
  size_category?: string | null;
  market_share_pct?: number | null;
}

export interface DistributionEntry {
  key: string;
  label: string;
  count: number;
}

export interface RegionDistributionEntry {
  region_kato: string;
  region_name: string;
  count: number;
  revenue_usd?: number | null;
}

export interface RevenueBucket {
  label: string;
  min: number;
  max: number | null;
  count: number;
}

export interface MarketShareEntry {
  name: string;
  revenue_usd: number;
  share_pct: number;
}

export type CompetitionLevel = 'low' | 'moderate' | 'high';

export interface MarketBlock {
  company_count_total: number;
  market_volume_usd: number;
  tam_usd: number;
  sam_usd: number;
  som_usd: number;
  avg_revenue_usd?: number | null;
  median_revenue_usd?: number | null;
  avg_employee_count?: number | null;
  total_employees?: number | null;
  hhi?: number | null;
  concentration_top3_pct?: number | null;
  competition_level?: CompetitionLevel | null;
  size_distribution?: DistributionEntry[];
  region_distribution?: RegionDistributionEntry[];
  revenue_buckets?: RevenueBucket[];
  top_shares?: MarketShareEntry[];
}

export interface MarketLeader {
  name: string;
  revenue_usd?: number | null;
}

export interface CompetitorSummary {
  status?: string | null;
  message?: string | null;
  competitor_count?: number | null;
  total_revenue_usd?: number | null;
  leader?: MarketLeader | null;
}

export interface CompetitorWizardResult {
  matched_niche: MatchedNiche;
  competitors: Competitor[];
  total: number;
  market?: MarketBlock | null;
  summary?: CompetitorSummary | null;
}

// GeoJSON returned by `/market-map`.
export interface MarketMapFeatureProps {
  id: string;
  name: string;
  industry_code?: string | null;
  industry_label?: string | null;
  revenue_usd?: number | null;
  employee_count?: number | null;
  region_name?: string | null;
  region_kato?: string | null;
  size_category?: string | null;
}

export interface MarketMapResponse {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    geometry: { type: 'Point'; coordinates: [number, number] };
    properties: MarketMapFeatureProps;
  }>;
  total: number;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useCompetitorOptions(): UseQueryResult<CompetitorOptions, Error> {
  return useQuery<CompetitorOptions, Error>({
    queryKey: ['competitors', 'options'],
    staleTime: 60 * 60_000,
    queryFn: ({ signal }) =>
      apiGet<CompetitorOptions>(`${API_PREFIX}/options`, undefined, signal),
  });
}

function normalizeBody(answers: WizardAnswers): WizardAnswers {
  return {
    category: answers.category,
    audience: answers.audience ?? undefined,
    stage: answers.stage ?? undefined,
    regions: answers.regions && answers.regions.length > 0 ? answers.regions : undefined,
    price: answers.price ?? undefined,
    limit: answers.limit ?? 12,
    addressable_pct: answers.addressable_pct,
    obtainable_pct: answers.obtainable_pct,
  };
}

export function useCompetitorWizard(): UseMutationResult<
  CompetitorWizardResult,
  Error,
  WizardAnswers
> {
  return useMutation<CompetitorWizardResult, Error, WizardAnswers>({
    mutationKey: ['competitors', 'wizard'],
    mutationFn: (answers) =>
      apiPost<CompetitorWizardResult>(`${API_PREFIX}/wizard`, normalizeBody(answers)),
  });
}

export function useCompetitorMarketMap(): UseMutationResult<
  MarketMapResponse | null,
  Error,
  WizardAnswers
> {
  return useMutation<MarketMapResponse | null, Error, WizardAnswers>({
    mutationKey: ['competitors', 'market-map'],
    // Tolerant: the endpoint may not be deployed yet (404/500). Swallow so the
    // results page falls back to competitors[] points instead of erroring the
    // whole flow. The map still renders the ranked competitors meanwhile.
    mutationFn: (answers) =>
      apiPost<MarketMapResponse>(`${API_PREFIX}/market-map`, normalizeBody(answers)).catch(
        () => null,
      ),
  });
}

/**
 * Build `CompanyPoint[]` (the shape MapShell consumes) from the niche universe.
 * Prefers the dedicated market-map GeoJSON; falls back to competitors that
 * carry coordinates so the map still renders something before market-map lands.
 */
export function pointsFromMarketMap(
  geo: MarketMapResponse | undefined | null,
  competitors: Competitor[] = [],
): CompanyPoint[] {
  if (geo?.features && geo.features.length > 0) {
    return geo.features.map((f) => {
      const [longitude, latitude] = f.geometry.coordinates;
      const p = f.properties;
      return {
        id: p.id,
        longitude,
        latitude,
        name: p.name,
        industry_code: p.industry_code ?? null,
        industry_label: p.industry_label ?? null,
        region_kato: p.region_kato ?? null,
        region_name: p.region_name ?? null,
        revenue_usd: p.revenue_usd ?? null,
      };
    });
  }

  return competitors
    .filter(
      (c): c is Competitor & { latitude: number; longitude: number } =>
        typeof c.latitude === 'number' && typeof c.longitude === 'number',
    )
    .map((c) => ({
      id: c.id,
      longitude: c.longitude,
      latitude: c.latitude,
      name: c.name,
      industry_code: c.industry_code ?? null,
      industry_label: c.industry_label ?? null,
      region_name: c.region_name ?? null,
      revenue_usd: c.revenue_usd ?? null,
    }));
}
