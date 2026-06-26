import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { apiPost } from '@/services/api';
import { isWidgetsApiReady, mockWidgetData } from '@/services/widgets-mock';
import type { WidgetData, WidgetRead } from '@/types/widgets';

const STALE_MS = 30_000; // 30 seconds per spec

/**
 * Fetch the data payload for a single widget.
 *
 * The endpoint is `POST /api/v1/widgets/{id}/data` so the backend can
 * accept a draft body (used by the editor's live preview). When `draft`
 * is passed we send `{params: draft.params, type: draft.type}` so the
 * preview shows what the saved widget *would* render without persisting.
 */
export function useWidgetData(
  widget: WidgetRead,
  draft?: { type?: WidgetRead['type']; params?: WidgetRead['params'] },
): UseQueryResult<WidgetData, Error> {
  // Draft branches are cached separately so the live preview doesn't
  // poison the saved widget's cache slot.
  const draftKey = draft ? JSON.stringify(draft) : null;
  return useQuery<WidgetData, Error>({
    queryKey: ['widgets', 'data', widget.id, draftKey],
    staleTime: STALE_MS,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      if (!isWidgetsApiReady()) {
        const effective: WidgetRead = draft
          ? {
              ...widget,
              type: draft.type ?? widget.type,
              params: draft.params ?? widget.params,
            }
          : widget;
        return mockWidgetData(effective);
      }
      const body = draft ? { params: draft.params, type: draft.type } : {};
      const data = await apiPost<WidgetData>(
        `/api/v1/widgets/${widget.id}/data`,
        body,
        signal,
      );
      if (!data) throw new Error('widget data endpoint returned empty');
      return data;
    },
  });
}
