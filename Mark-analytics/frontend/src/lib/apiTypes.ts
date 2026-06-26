/**
 * Named aliases over the auto-generated `components['schemas']` map.
 *
 * Import from here, never directly from `@/types/api`, so that:
 *   1. The rest of the codebase reads naturally
 *      (`CompanyDetail`, not `components['schemas']['CompanyDetail']`).
 *   2. If a schema is renamed upstream, only this file needs an update.
 *   3. We can extend / narrow specific shapes here without polluting the
 *      regenerated `types/api.ts`.
 *
 * After running `npm run gen:api`, add a new alias here for each schema
 * the UI actually consumes. Keep this list curated, not exhaustive.
 */

import type { components, paths } from '@/types/api';

// ---------------------------------------------------------------------------
// Schema aliases
// ---------------------------------------------------------------------------

type Schemas = components['schemas'];

export type CompanyDetail = Schemas['CompanyDetail'];
export type AnalyticsOverview = Schemas['AnalyticsOverview'];

// ---------------------------------------------------------------------------
// Path / response helpers
// ---------------------------------------------------------------------------

/**
 * Extract the 200-OK JSON body type for a given path + method.
 *
 * Usage:
 *   type Me = OkResponse<'/api/v1/me', 'get'>;
 */
export type OkResponse<
  P extends keyof paths,
  M extends keyof paths[P],
> = paths[P][M] extends {
  responses: { 200: { content: { 'application/json': infer R } } };
}
  ? R
  : never;

/**
 * Extract path parameters for a given path + method.
 *
 * Usage:
 *   type Params = PathParams<'/api/v1/companies/{id}', 'get'>;
 */
export type PathParams<
  P extends keyof paths,
  M extends keyof paths[P],
> = paths[P][M] extends { parameters: { path: infer Pp } } ? Pp : never;

/**
 * Extract query parameters for a given path + method.
 */
export type QueryParamsOf<
  P extends keyof paths,
  M extends keyof paths[P],
> = paths[P][M] extends { parameters: { query?: infer Q } } ? Q : never;

/**
 * Extract the JSON request body for a given path + method.
 */
export type RequestBody<
  P extends keyof paths,
  M extends keyof paths[P],
> = paths[P][M] extends {
  requestBody: { content: { 'application/json': infer B } };
}
  ? B
  : never;
