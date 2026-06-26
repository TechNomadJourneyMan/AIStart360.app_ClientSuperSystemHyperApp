import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { apiGet } from '../services/api';

export interface BBox {
  /** [west, south, east, north] in WGS84 degrees. */
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface CompanyGeoFilters {
  /** ОКЭД section or full code prefix. */
  industry_code?: string | null;
  /** Backend-resolved size bucket (micro / small / medium / large). */
  size_category?: string | null;
  /** KATO region code for region scoping. */
  region_kato?: string | null;
  /** Free-text search forwarded as `q`. */
  q?: string | null;
}

export interface CompanyGeoFeature {
  id: string;
  name: string;
  longitude: number;
  latitude: number;
  industry_code?: string | null;
  industry_label?: string | null;
  region_kato?: string | null;
  region_name?: string | null;
  revenue_usd?: number | null;
  size_category?: string | null;
  /** Present (true) on server-side cluster features returned at low zoom. */
  cluster?: boolean;
}

/**
 * GeoJSON-shaped envelope returned by `/api/v1/geo/companies`.
 * `total` reflects post-filter, pre-bbox-clip count for UI badges.
 */
export interface CompaniesGeoResponse {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    geometry: { type: 'Point'; coordinates: [number, number] };
    properties: CompanyGeoFeature;
  }>;
  total: number;
}

function bboxToParam(b: BBox): string {
  return `${b.west.toFixed(4)},${b.south.toFixed(4)},${b.east.toFixed(4)},${b.north.toFixed(4)}`;
}

/**
 * Round bbox to a small grid so panning by a fraction of a pixel doesn't
 * thrash react-query's cache. ~0.05° ≈ 5km at KZ latitudes.
 */
function quantizeBBox(b: BBox, step: number = 0.05): BBox {
  const q = (v: number): number => Math.round(v / step) * step;
  return { west: q(b.west), south: q(b.south), east: q(b.east), north: q(b.north) };
}

export interface UseCompaniesGeoOptions {
  bbox: BBox | null;
  /** Map zoom level — backend uses it to decide point density. */
  zoom?: number;
  filters?: CompanyGeoFilters;
  enabled?: boolean;
}

export function useCompaniesGeo(
  options: UseCompaniesGeoOptions,
): UseQueryResult<CompaniesGeoResponse, Error> {
  const { bbox, zoom, filters = {}, enabled = true } = options;
  const stableBBox = bbox ? quantizeBBox(bbox) : null;
  // Bucket zoom to integer to avoid refetching on every micro-zoom.
  const zoomBucket = typeof zoom === 'number' ? Math.round(zoom) : undefined;

  return useQuery<CompaniesGeoResponse, Error>({
    queryKey: ['geo', 'companies', stableBBox, zoomBucket, filters],
    enabled: Boolean(stableBBox) && enabled,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    placeholderData: (prev) => prev,
    refetchOnWindowFocus: false,
    queryFn: ({ signal }) =>
      apiGet<CompaniesGeoResponse>(
        '/api/v1/geo/companies',
        {
          bbox: stableBBox ? bboxToParam(stableBBox) : undefined,
          zoom: zoomBucket,
          industry_code: filters.industry_code ?? undefined,
          size_category: filters.size_category ?? undefined,
          region_kato: filters.region_kato ?? undefined,
          q: filters.q ?? undefined,
        },
        signal,
      ),
  });
}

export default useCompaniesGeo;
