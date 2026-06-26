import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { apiGet } from '../services/api';
import type { TimelineEvent } from '../types/company';

export interface UseCompanyTimelineOptions {
  /** Lazy by default — only fetch when the Timeline tab is visible. */
  enabled?: boolean;
}

/** Fetch company timeline events (`/companies/{id}/timeline`). */
export function useCompanyTimeline(
  id: string | null,
  options: UseCompanyTimelineOptions = {},
): UseQueryResult<TimelineEvent[], Error> {
  const { enabled = false } = options;

  return useQuery<TimelineEvent[], Error>({
    queryKey: ['companies', 'timeline', id],
    enabled: Boolean(id) && enabled,
    staleTime: 60_000,
    queryFn: ({ signal }) =>
      apiGet<TimelineEvent[]>(
        `/api/v1/companies/${encodeURIComponent(id ?? '')}/timeline`,
        undefined,
        signal,
      ),
  });
}

export default useCompanyTimeline;
