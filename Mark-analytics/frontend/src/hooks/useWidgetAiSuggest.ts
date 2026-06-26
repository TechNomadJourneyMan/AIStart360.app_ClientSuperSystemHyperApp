import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import { apiPost } from '@/services/api';
import { isWidgetsApiReady, mockAiSuggest } from '@/services/widgets-mock';
import type { WidgetAiSuggestRequest, WidgetAiSuggestResponse } from '@/types/widgets';

/**
 * Mutation hook for `POST /api/v1/widgets/ai-suggest`.
 *
 * Returns a discriminated `{ok: true, ...}` / `{ok: false, reason, message}`
 * response so the editor can render an inline retry hint on
 * `schema_validation` failures.
 */
export function useWidgetAiSuggest(): UseMutationResult<
  WidgetAiSuggestResponse,
  Error,
  WidgetAiSuggestRequest
> {
  return useMutation<WidgetAiSuggestResponse, Error, WidgetAiSuggestRequest>({
    mutationFn: async (req) => {
      if (!isWidgetsApiReady()) {
        // Simulated network latency so the UI animation is visible.
        await new Promise<void>((r) => window.setTimeout(r, 350));
        return mockAiSuggest(req);
      }
      const data = await apiPost<WidgetAiSuggestResponse>(
        '/api/v1/widgets/ai-suggest',
        req,
      );
      if (!data) throw new Error('ai-suggest returned empty');
      return data;
    },
  });
}
