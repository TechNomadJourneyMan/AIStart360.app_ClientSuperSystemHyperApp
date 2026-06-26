import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import { apiPost } from '../services/api';

/**
 * MK Analyst (Track A) — non-streaming v1.
 *
 * Single mutation: send one user turn, get one assistant turn back.
 * `conversation_id` is opaque and produced by the backend on first turn.
 * The caller is responsible for persisting it (we persist in sessionStorage
 * inside `AnalystDrawer.tsx` so refresh inside a session keeps context).
 */

export interface AnalystAction {
  type: string;
  payload: Record<string, unknown>;
}

export interface AnalystToolCall {
  name: string;
  input: Record<string, unknown>;
  output_summary: string;
  error: string | null;
}

export interface AnalystResponse {
  conversation_id: string;
  message: string;
  actions: AnalystAction[];
  tool_calls: AnalystToolCall[];
}

export interface AnalystRequest {
  query: string;
  conversation_id?: string;
}

export function useAnalystQuery(): UseMutationResult<
  AnalystResponse,
  Error,
  AnalystRequest
> {
  return useMutation<AnalystResponse, Error, AnalystRequest>({
    mutationKey: ['analyst', 'query'],
    mutationFn: (body) =>
      apiPost<AnalystResponse>('/api/v1/analyst/query', body),
  });
}

export default useAnalystQuery;
