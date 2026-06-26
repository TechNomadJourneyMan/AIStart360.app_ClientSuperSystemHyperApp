import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { apiGet } from '../services/api';
import type { CompanyDetail } from '../types/company';

export interface UseCompanyOptions {
  enabled?: boolean;
}

/**
 * Fetch enriched company detail via `GET /api/v1/companies/{id}`.
 *
 * Returns null id → query is disabled (TanStack `enabled` flag).
 */
export function useCompany(
  id: string | null,
  options: UseCompanyOptions = {},
): UseQueryResult<CompanyDetail, Error> {
  const { enabled = true } = options;

  return useQuery<CompanyDetail, Error>({
    queryKey: ['companies', 'detail', id],
    enabled: Boolean(id) && enabled,
    staleTime: 60_000,
    queryFn: ({ signal }) =>
      apiGet<CompanyDetail>(`/api/v1/companies/${encodeURIComponent(id ?? '')}`, undefined, signal),
  });
}

export default useCompany;
