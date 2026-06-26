import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { apiGet } from '../services/api';
import type { CompanyListItem } from '../types/company';

export interface UseCompanySimilarOptions {
  /** Lazy by default — load when Overview/Similar block scrolls into view. */
  enabled?: boolean;
  limit?: number;
}

/** Fetch top-N similar companies via `/companies/{id}/similar?limit=`. */
export function useCompanySimilar(
  id: string | null,
  options: UseCompanySimilarOptions = {},
): UseQueryResult<CompanyListItem[], Error> {
  const { enabled = false, limit = 5 } = options;

  return useQuery<CompanyListItem[], Error>({
    queryKey: ['companies', 'similar', id, limit],
    enabled: Boolean(id) && enabled,
    staleTime: 5 * 60_000,
    queryFn: ({ signal }) =>
      apiGet<CompanyListItem[]>(
        `/api/v1/companies/${encodeURIComponent(id ?? '')}/similar`,
        { limit },
        signal,
      ),
  });
}

export default useCompanySimilar;
