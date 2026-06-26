import { getAccessToken } from './auth';
import type { paths } from '@/types/api';
import type { OkResponse, RequestBody } from '@/lib/apiTypes';

const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;

export const API_BASE_URL =
  env.VITE_API_BASE_URL?.replace(/\/$/, '') ?? 'http://localhost:8000';

export interface ApiErrorItem {
  code: string;
  message: string;
  field?: string | null;
  details?: Record<string, unknown> | null;
}

export interface ApiEnvelope<T> {
  data: T | null;
  meta?: Record<string, unknown> | null;
  errors?: ApiErrorItem[] | null;
}

export class ApiError extends Error {
  public readonly status: number;
  public readonly errors: ApiErrorItem[];
  public readonly meta: Record<string, unknown> | null;

  constructor(
    message: string,
    status: number,
    errors: ApiErrorItem[],
    meta: Record<string, unknown> | null,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.errors = errors;
    this.meta = meta;
  }
}

type QueryValue = string | number | boolean | null | undefined | Array<string | number>;
export type QueryParams = Record<string, QueryValue>;

function buildUrl(path: string, params?: QueryParams): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(`${API_BASE_URL}${normalized}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        for (const v of value) url.searchParams.append(key, String(v));
      } else {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

async function request<T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  options: { params?: QueryParams; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const token = await getAccessToken();
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(buildUrl(path, options.params), {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
    credentials: 'omit',
  });

  let envelope: ApiEnvelope<T> | null = null;
  const text = await res.text();
  if (text) {
    try {
      envelope = JSON.parse(text) as ApiEnvelope<T>;
    } catch {
      // non-JSON response (e.g., 502 HTML) — fall through to error path.
    }
  }

  if (!res.ok) {
    const errors = envelope?.errors ?? [
      { code: `http_${res.status}`, message: res.statusText || 'Request failed' },
    ];
    throw new ApiError(
      errors[0]?.message ?? 'Request failed',
      res.status,
      errors,
      envelope?.meta ?? null,
    );
  }

  if (envelope && envelope.errors && envelope.errors.length > 0) {
    const first = envelope.errors[0];
    throw new ApiError(
      first?.message ?? 'Request failed',
      res.status,
      envelope.errors,
      envelope.meta ?? null,
    );
  }

  return (envelope?.data ?? null) as T;
}

// ---------------------------------------------------------------------------
// Public API
//
// Two overloads each:
//   1. Typed overload — pass a known OpenAPI `path` literal; response type
//      is inferred from `paths[P]['<verb>']` via the `OkResponse` helper.
//   2. Generic fallback — `apiGet<MyType>('/anything')` continues to work
//      for paths that are not yet in the generated `paths` map.
//
// This keeps the existing call sites in the codebase compiling without
// changes, while new code gets full type inference for free.
// ---------------------------------------------------------------------------

// Path-string keys only — exclude symbol / number keys that `keyof` introduces.
type PathKey = Extract<keyof paths, string>;

type GetPath = {
  [P in PathKey]: paths[P] extends { get: unknown } ? P : never;
}[PathKey];

type PostPath = {
  [P in PathKey]: paths[P] extends { post: unknown } ? P : never;
}[PathKey];

type PutPath = {
  [P in PathKey]: paths[P] extends { put: unknown } ? P : never;
}[PathKey];

type PatchPath = {
  [P in PathKey]: paths[P] extends { patch: unknown } ? P : never;
}[PathKey];

type DeletePath = {
  [P in PathKey]: paths[P] extends { delete: unknown } ? P : never;
}[PathKey];

// --- GET --------------------------------------------------------------------
export function apiGet<P extends GetPath>(
  path: P,
  params?: QueryParams,
  signal?: AbortSignal,
): Promise<OkResponse<P, 'get'>>;
export function apiGet<T>(path: string, params?: QueryParams, signal?: AbortSignal): Promise<T>;
export function apiGet<T>(path: string, params?: QueryParams, signal?: AbortSignal): Promise<T> {
  return request<T>('GET', path, { params, signal });
}

// --- POST -------------------------------------------------------------------
export function apiPost<P extends PostPath>(
  path: P,
  body?: RequestBody<P, 'post'>,
  signal?: AbortSignal,
): Promise<OkResponse<P, 'post'>>;
export function apiPost<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T>;
export function apiPost<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  return request<T>('POST', path, { body, signal });
}

// --- PUT --------------------------------------------------------------------
export function apiPut<P extends PutPath>(
  path: P,
  body?: RequestBody<P, 'put'>,
  signal?: AbortSignal,
): Promise<OkResponse<P, 'put'>>;
export function apiPut<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T>;
export function apiPut<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  return request<T>('PUT', path, { body, signal });
}

// --- PATCH ------------------------------------------------------------------
export function apiPatch<P extends PatchPath>(
  path: P,
  body?: RequestBody<P, 'patch'>,
  signal?: AbortSignal,
): Promise<OkResponse<P, 'patch'>>;
export function apiPatch<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T>;
export function apiPatch<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  return request<T>('PATCH', path, { body, signal });
}

// --- DELETE -----------------------------------------------------------------
export function apiDelete<P extends DeletePath>(
  path: P,
  params?: QueryParams,
  signal?: AbortSignal,
): Promise<OkResponse<P, 'delete'>>;
export function apiDelete<T>(path: string, params?: QueryParams, signal?: AbortSignal): Promise<T>;
export function apiDelete<T>(path: string, params?: QueryParams, signal?: AbortSignal): Promise<T> {
  return request<T>('DELETE', path, { params, signal });
}
