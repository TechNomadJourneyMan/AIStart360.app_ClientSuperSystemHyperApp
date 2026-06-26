import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { apiDelete, apiGet, apiPatch, apiPost, API_BASE_URL } from '@/services/api';
import { getAccessToken, useAuth } from '@/services/auth';

// ---------------------------------------------------------------------------
// Types — mirror backend `app/schemas/saved_list.py`
// ---------------------------------------------------------------------------

export interface SavedListSummary {
  id: string;
  name: string;
  item_count: number;
  created_at: string;
  updated_at: string;
}

export interface SavedListItem {
  company_id: string;
  company_name?: string | null;
  company_country?: string | null;
  industry_code?: string | null;
  industry_label?: string | null;
  added_at: string;
  note?: string | null;
}

export interface SavedListDetail extends SavedListSummary {
  items: SavedListItem[];
}

const LISTS_BASE = '/api/v1/lists';
const STALE = 30_000;

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function useSavedLists(): UseQueryResult<SavedListSummary[], Error> {
  const { user } = useAuth();
  return useQuery<SavedListSummary[], Error>({
    queryKey: ['saved-lists'],
    enabled: !!user,
    staleTime: STALE,
    queryFn: ({ signal }) =>
      apiGet<SavedListSummary[]>(LISTS_BASE, undefined, signal),
  });
}

export function useSavedList(
  id: string | null,
): UseQueryResult<SavedListDetail, Error> {
  const { user } = useAuth();
  return useQuery<SavedListDetail, Error>({
    queryKey: ['saved-lists', 'detail', id],
    enabled: !!user && !!id,
    staleTime: STALE,
    queryFn: ({ signal }) =>
      apiGet<SavedListDetail>(
        `${LISTS_BASE}/${encodeURIComponent(id ?? '')}`,
        undefined,
        signal,
      ),
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function useCreateSavedList(): UseMutationResult<
  SavedListSummary,
  Error,
  { name: string }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars) => apiPost<SavedListSummary>(LISTS_BASE, vars),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['saved-lists'] });
    },
  });
}

export function useRenameSavedList(): UseMutationResult<
  SavedListSummary,
  Error,
  { id: string; name: string }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }) =>
      apiPatch<SavedListSummary>(
        `${LISTS_BASE}/${encodeURIComponent(id)}`,
        { name },
      ),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['saved-lists'] });
      void qc.invalidateQueries({ queryKey: ['saved-lists', 'detail', vars.id] });
    },
  });
}

export function useDeleteSavedList(): UseMutationResult<unknown, Error, { id: string }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) =>
      apiDelete(`${LISTS_BASE}/${encodeURIComponent(id)}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['saved-lists'] });
    },
  });
}

export function useAddSavedListItem(): UseMutationResult<
  SavedListItem,
  Error,
  { list_id: string; company_id: string; note?: string | null }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ list_id, company_id, note }) =>
      apiPost<SavedListItem>(
        `${LISTS_BASE}/${encodeURIComponent(list_id)}/items`,
        { company_id, note },
      ),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['saved-lists'] });
      void qc.invalidateQueries({
        queryKey: ['saved-lists', 'detail', vars.list_id],
      });
    },
  });
}

export function useUpdateSavedListItemNote(): UseMutationResult<
  SavedListItem,
  Error,
  { list_id: string; company_id: string; note: string | null }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ list_id, company_id, note }) =>
      apiPatch<SavedListItem>(
        `${LISTS_BASE}/${encodeURIComponent(list_id)}/items/${encodeURIComponent(company_id)}`,
        { note },
      ),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({
        queryKey: ['saved-lists', 'detail', vars.list_id],
      });
    },
  });
}

export function useRemoveSavedListItem(): UseMutationResult<
  unknown,
  Error,
  { list_id: string; company_id: string }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ list_id, company_id }) =>
      apiDelete(
        `${LISTS_BASE}/${encodeURIComponent(list_id)}/items/${encodeURIComponent(company_id)}`,
      ),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['saved-lists'] });
      void qc.invalidateQueries({
        queryKey: ['saved-lists', 'detail', vars.list_id],
      });
    },
  });
}

// ---------------------------------------------------------------------------
// CSV export — direct browser download, bypasses fetch envelope.
// ---------------------------------------------------------------------------

export async function downloadSavedListCsv(id: string): Promise<void> {
  const token = await getAccessToken();
  const url = `${API_BASE_URL}${LISTS_BASE}/${encodeURIComponent(id)}/export.csv`;
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    credentials: 'omit',
  });
  if (!res.ok) {
    throw new Error(`Export failed (${res.status})`);
  }
  const blob = await res.blob();
  const disp = res.headers.get('content-disposition') ?? '';
  const match = /filename="?([^";]+)"?/i.exec(disp);
  const filename = match?.[1] ?? `list-${id}.csv`;

  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}
