import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { API_BASE_URL, type ApiEnvelope } from '../services/api';
import { getAccessToken } from '../services/auth';

const API_PREFIX = '/api/v1';
const FIVE_MIN_MS = 5 * 60 * 1000;

export interface NewsItem {
  id: string;
  title: string;
  url: string;
  source: string;
  published_at: string;
  summary: string;
}

export interface NewsFeedResult {
  items: NewsItem[];
  degraded: boolean;
  cachedAt: number | null;
}

interface NewsMeta {
  degraded?: boolean;
  cached_at?: number;
  total?: number;
  limit?: number;
}

/**
 * Recent business news, aggregated from RSS feeds server-side.
 *
 * Hits the endpoint directly (rather than going through `apiGet`) so we
 * can read `meta.degraded` and `meta.cached_at`, which the standard
 * helper discards.
 *
 * Returns `degraded: true` when the server couldn't reach any feed —
 * the widget renders an empty state in that case.
 */
export function useRecentNews(limit = 10): UseQueryResult<NewsFeedResult, Error> {
  return useQuery<NewsFeedResult, Error>({
    queryKey: ['news', 'recent', limit],
    staleTime: FIVE_MIN_MS,
    gcTime: FIVE_MIN_MS * 2,
    retry: 0,
    queryFn: async ({ signal }) => {
      const url = `${API_BASE_URL}${API_PREFIX}/news/recent?limit=${limit}`;
      const token = await getAccessToken();
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;

      const res = await fetch(url, { headers, signal, credentials: 'omit' });
      if (!res.ok) {
        return { items: [], degraded: true, cachedAt: null };
      }

      const body = (await res.json()) as ApiEnvelope<NewsItem[]>;
      const meta = (body.meta ?? null) as NewsMeta | null;
      return {
        items: body.data ?? [],
        degraded: Boolean(meta?.degraded),
        cachedAt: typeof meta?.cached_at === 'number' ? meta.cached_at : null,
      };
    },
  });
}
