import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { apiGet } from '../services/api';
import type { CompanyInsightsBundle } from '../types/company';

export interface UseCompanyInsightsOptions {
  /** Drawer closed or non-Overview tab → keep this `false` to avoid prefetch. */
  enabled?: boolean;
}

/**
 * Fetch `{ scores, insights }` for a single company.
 * Backend response is cached server-side (TTL ~1h).
 */
export function useCompanyInsights(
  id: string | null,
  options: UseCompanyInsightsOptions = {},
): UseQueryResult<CompanyInsightsBundle, Error> {
  const { enabled = true } = options;

  return useQuery<CompanyInsightsBundle, Error>({
    queryKey: ['companies', 'insights', id],
    enabled: Boolean(id) && enabled,
    staleTime: 5 * 60_000,
    queryFn: ({ signal }) =>
      apiGet<CompanyInsightsBundle>(
        `/api/v1/companies/${encodeURIComponent(id ?? '')}/insights`,
        undefined,
        signal,
      ),
  });
}

export default useCompanyInsights;
