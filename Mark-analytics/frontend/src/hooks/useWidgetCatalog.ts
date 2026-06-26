import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { apiGet } from '@/services/api';
import { isWidgetsApiReady, MOCK_CATALOG } from '@/services/widgets-mock';
import type { WidgetCatalogEntry } from '@/types/widgets';

const CATALOG_PATH = '/api/v1/widgets/catalog';
const STALE_MS = 5 * 60_000; // 5 minutes per spec

/**
 * Fetch the widget catalog — the 6 built-in widget types with their
 * JSON-schema params and default values. Cached aggressively (5min stale)
 * since catalog rarely changes.
 */
export function useWidgetCatalog(): UseQueryResult<readonly WidgetCatalogEntry[], Error> {
  return useQuery<readonly WidgetCatalogEntry[], Error>({
    queryKey: ['widgets', 'catalog'],
    staleTime: STALE_MS,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      if (!isWidgetsApiReady()) {
        return MOCK_CATALOG;
      }
      const data = await apiGet<readonly WidgetCatalogEntry[]>(CATALOG_PATH, undefined, signal);
      return data ?? MOCK_CATALOG;
    },
  });
}
