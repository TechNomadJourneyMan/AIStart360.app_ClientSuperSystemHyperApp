import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { apiDelete, apiGet, apiPatch, apiPost } from '@/services/api';
import {
  isWidgetsApiReady,
  mockCreateWidget,
  mockDeleteWidget,
  mockListWidgets,
  mockReorderWidgets,
  mockUpdateWidget,
} from '@/services/widgets-mock';
import type {
  WidgetCreate,
  WidgetRead,
  WidgetReorderItem,
  WidgetUpdate,
} from '@/types/widgets';

const WIDGETS_PATH = '/api/v1/widgets';
const QK_LIST = ['widgets', 'mine'] as const;

/**
 * Read + mutate the current user's widgets. Mutations are optimistic with
 * full rollback on error. Cache key is `['widgets', 'mine']`.
 */
export interface UseUserWidgetsResult {
  query: UseQueryResult<WidgetRead[], Error>;
  create: UseMutationResult<WidgetRead, Error, WidgetCreate, { prev: WidgetRead[] | undefined }>;
  update: UseMutationResult<
    WidgetRead,
    Error,
    { id: string; patch: WidgetUpdate },
    { prev: WidgetRead[] | undefined }
  >;
  remove: UseMutationResult<void, Error, string, { prev: WidgetRead[] | undefined }>;
  reorder: UseMutationResult<
    WidgetRead[],
    Error,
    WidgetReorderItem[],
    { prev: WidgetRead[] | undefined }
  >;
}

export function useUserWidgets(): UseUserWidgetsResult {
  const qc = useQueryClient();

  const query = useQuery<WidgetRead[], Error>({
    queryKey: QK_LIST,
    staleTime: 60_000,
    queryFn: async ({ signal }) => {
      if (!isWidgetsApiReady()) {
        return mockListWidgets();
      }
      const data = await apiGet<WidgetRead[]>(WIDGETS_PATH, undefined, signal);
      return data ?? [];
    },
  });

  const create = useMutation<
    WidgetRead,
    Error,
    WidgetCreate,
    { prev: WidgetRead[] | undefined }
  >({
    mutationFn: async (body) => {
      if (!isWidgetsApiReady()) {
        return mockCreateWidget(body);
      }
      const created = await apiPost<WidgetRead>(WIDGETS_PATH, body);
      if (!created) throw new Error('create widget returned empty');
      return created;
    },
    onMutate: async (body) => {
      await qc.cancelQueries({ queryKey: QK_LIST });
      const prev = qc.getQueryData<WidgetRead[]>([...QK_LIST]);
      const optimistic: WidgetRead = {
        id: `temp_${Date.now()}`,
        type: body.type,
        name: body.name,
        params: { ...body.params },
        layout: body.layout ?? null,
        order: prev?.length ?? 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      qc.setQueryData<WidgetRead[]>([...QK_LIST], [...(prev ?? []), optimistic]);
      return { prev };
    },
    onError: (_err, _body, ctx) => {
      if (ctx?.prev) qc.setQueryData([...QK_LIST], ctx.prev);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: QK_LIST });
    },
  });

  const update = useMutation<
    WidgetRead,
    Error,
    { id: string; patch: WidgetUpdate },
    { prev: WidgetRead[] | undefined }
  >({
    mutationFn: async ({ id, patch }) => {
      if (!isWidgetsApiReady()) {
        return mockUpdateWidget(id, patch);
      }
      const updated = await apiPatch<WidgetRead>(`${WIDGETS_PATH}/${id}`, patch);
      if (!updated) throw new Error('update widget returned empty');
      return updated;
    },
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: QK_LIST });
      const prev = qc.getQueryData<WidgetRead[]>([...QK_LIST]);
      if (prev) {
        const next = prev.map((w) =>
          w.id === id
            ? {
                ...w,
                ...(patch.name !== undefined ? { name: patch.name } : {}),
                ...(patch.params !== undefined ? { params: { ...w.params, ...patch.params } } : {}),
                ...('layout' in patch ? { layout: patch.layout ?? null } : {}),
                ...(patch.order !== undefined ? { order: patch.order } : {}),
                updated_at: new Date().toISOString(),
              }
            : w,
        );
        qc.setQueryData<WidgetRead[]>([...QK_LIST], next);
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData([...QK_LIST], ctx.prev);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: QK_LIST });
    },
  });

  const remove = useMutation<void, Error, string, { prev: WidgetRead[] | undefined }>({
    mutationFn: async (id) => {
      if (!isWidgetsApiReady()) {
        mockDeleteWidget(id);
        return;
      }
      await apiDelete<null>(`${WIDGETS_PATH}/${id}`);
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: QK_LIST });
      const prev = qc.getQueryData<WidgetRead[]>([...QK_LIST]);
      if (prev) {
        qc.setQueryData<WidgetRead[]>([...QK_LIST], prev.filter((w) => w.id !== id));
      }
      return { prev };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData([...QK_LIST], ctx.prev);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: QK_LIST });
    },
  });

  const reorder = useMutation<
    WidgetRead[],
    Error,
    WidgetReorderItem[],
    { prev: WidgetRead[] | undefined }
  >({
    mutationFn: async (items) => {
      if (!isWidgetsApiReady()) {
        return mockReorderWidgets(items);
      }
      const data = await apiPost<WidgetRead[]>(`${WIDGETS_PATH}/reorder`, items);
      return data ?? [];
    },
    onMutate: async (items) => {
      await qc.cancelQueries({ queryKey: QK_LIST });
      const prev = qc.getQueryData<WidgetRead[]>([...QK_LIST]);
      if (prev) {
        const orderMap = new Map(items.map((it) => [it.id, it.order]));
        const next = prev
          .map((w) => (orderMap.has(w.id) ? { ...w, order: orderMap.get(w.id) ?? w.order } : w))
          .sort((a, b) => a.order - b.order);
        qc.setQueryData<WidgetRead[]>([...QK_LIST], next);
      }
      return { prev };
    },
    onError: (_err, _items, ctx) => {
      if (ctx?.prev) qc.setQueryData([...QK_LIST], ctx.prev);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: QK_LIST });
    },
  });

  return { query, create, update, remove, reorder };
}
