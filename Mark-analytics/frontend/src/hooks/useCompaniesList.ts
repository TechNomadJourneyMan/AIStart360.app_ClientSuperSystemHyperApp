/**
 * Infinite (cursor-paginated) list of companies for the Directory page.
 *
 * Driven by `useDirectoryFilterStore` — picking a filter from any other
 * widget (heatmap drill-down, MK Analyst action) automatically re-queries.
 *
 * The backend returns the standard envelope `{ data: [...], meta: { page: {
 * cursor_next, limit, total_estimate } } }`. `apiGet` strips down to
 * `data`, but we need `meta.page.cursor_next` for pagination, so we use the
 * raw `fetch` helper here. Keep this isolated to one place.
 */

import { useInfiniteQuery, type UseInfiniteQueryResult } from '@tanstack/react-query';

import { API_BASE_URL } from '../services/api';
import { getAccessToken } from '../services/auth';
import type { CompanyListItem } from '../types/company';
import {
  buildCompanyQueryParams,
  useDirectoryFilterStore,
  type DirectoryFilterState,
} from '../stores/directoryFilter';

export interface CompaniesPage {
  items: CompanyListItem[];
  cursorNext: string | null;
  totalEstimate: number | null;
}

interface RawEnvelope {
  data: CompanyListItem[] | null;
  meta?: {
    page?: { cursor_next?: string | null; limit?: number; total_estimate?: number | null };
  } | null;
}

const DEFAULT_LIMIT = 25;

async function fetchPage(
  params: Record<string, string | number | undefined>,
  cursor: string | null,
  limit: number,
  signal: AbortSignal,
): Promise<CompaniesPage> {
  const url = new URL(`${API_BASE_URL}/api/v1/companies`);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    url.searchParams.set(k, String(v));
  }
  url.searchParams.set('limit', String(limit));
  if (cursor) url.searchParams.set('cursor', cursor);

  const token = await getAccessToken();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url.toString(), { method: 'GET', headers, signal, credentials: 'omit' });
  if (!res.ok) {
    throw new Error(`Failed to load companies: ${res.status} ${res.statusText}`);
  }
  const env = (await res.json()) as RawEnvelope;
  return {
    items: env.data ?? [],
    cursorNext: env.meta?.page?.cursor_next ?? null,
    totalEstimate: env.meta?.page?.total_estimate ?? null,
  };
}

function selectFilters(s: DirectoryFilterState): Pick<
  DirectoryFilterState,
  | 'q'
  | 'industry_code'
  | 'region_kato'
  | 'size_category'
  | 'status'
  | 'ownership_type'
  | 'revenue_usd'
  | 'business_age_years'
> {
  return {
    q: s.q,
    industry_code: s.industry_code,
    region_kato: s.region_kato,
    size_category: s.size_category,
    status: s.status,
    ownership_type: s.ownership_type,
    revenue_usd: s.revenue_usd,
    business_age_years: s.business_age_years,
  };
}

export interface UseCompaniesListOptions {
  limit?: number;
}

export type UseCompaniesListResult = UseInfiniteQueryResult<
  { pages: CompaniesPage[]; pageParams: Array<string | null> },
  Error
> & {
  flatItems: CompanyListItem[];
  totalEstimate: number | null;
};

export function useCompaniesList(options: UseCompaniesListOptions = {}): UseCompaniesListResult {
  const { limit = DEFAULT_LIMIT } = options;
  const filters = useDirectoryFilterStore(selectFilters);
  const params = buildCompanyQueryParams(filters);

  const query = useInfiniteQuery<CompaniesPage, Error>({
    queryKey: ['companies', 'list', params, limit],
    queryFn: ({ pageParam, signal }) =>
      fetchPage(params, (pageParam as string | null) ?? null, limit, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.cursorNext ?? undefined,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev,
  });

  const flatItems: CompanyListItem[] = query.data?.pages.flatMap((p) => p.items) ?? [];
  const totalEstimate = query.data?.pages[0]?.totalEstimate ?? null;

  return Object.assign(query, { flatItems, totalEstimate }) as UseCompaniesListResult;
}

export default useCompaniesList;
