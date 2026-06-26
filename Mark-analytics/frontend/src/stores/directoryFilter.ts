/**
 * Directory filter store — single source of truth for the BD-persona
 * `/companies` page and any widget that drills into it (e.g. industry heatmap,
 * region distribution, MK Analyst "apply filter" action).
 *
 * Shape mirrors `useCompaniesGeo`'s `CompanyGeoFilters` so cross-widget
 * filtering "just works": picking an industry in the heatmap should narrow
 * both the map and the Directory page to the same set of companies.
 *
 * Numeric ranges (revenue, employees, business age) follow the
 * backend filter taxonomy at `app/filters/registry.py` and are serialized
 * to `"<gte>..<lte>"` strings when sent to the API.
 */

import { create } from 'zustand';

export interface NumberRange {
  gte: number | null;
  lte: number | null;
}

export interface DirectoryFilterState {
  /** Free-text query forwarded as `q`. */
  q: string;
  /** ОКЭД section / full prefix (backend `industry` / `industry_code`). */
  industry_code: string | null;
  /** KATO region code. */
  region_kato: string | null;
  /** Backend-resolved size bucket. */
  size_category: string | null;
  /** Legal status: active / liquidated / suspended / ... */
  status: string | null;
  /** Ownership type: private / public / state / mixed / foreign_owned. */
  ownership_type: string | null;
  /** Revenue range in USD (`revenue_usd` filter). */
  revenue_usd: NumberRange;
  /** Business age range in years (`business_age_years` filter, derived on backend). */
  business_age_years: NumberRange;

  setQ: (q: string) => void;
  setIndustry: (code: string | null) => void;
  setRegion: (kato: string | null) => void;
  setSizeCategory: (size: string | null) => void;
  setStatus: (status: string | null) => void;
  setOwnership: (ownership: string | null) => void;
  setRevenueRange: (range: NumberRange) => void;
  setAgeRange: (range: NumberRange) => void;

  /**
   * Bulk-set the two most common drill-down dimensions in one call. Used by
   * the heatmap (industry × region) and by the MK Analyst "apply filter" action.
   * Unset keys are left untouched; `null` clears.
   */
  setBoth: (next: { industry_code?: string | null; region_kato?: string | null }) => void;
  /** Reset all filters to the empty state. */
  clear: () => void;
}

const EMPTY_RANGE: NumberRange = { gte: null, lte: null };

const INITIAL: Pick<
  DirectoryFilterState,
  | 'q'
  | 'industry_code'
  | 'region_kato'
  | 'size_category'
  | 'status'
  | 'ownership_type'
  | 'revenue_usd'
  | 'business_age_years'
> = {
  q: '',
  industry_code: null,
  region_kato: null,
  size_category: null,
  status: null,
  ownership_type: null,
  revenue_usd: EMPTY_RANGE,
  business_age_years: EMPTY_RANGE,
};

export const useDirectoryFilterStore = create<DirectoryFilterState>((set) => ({
  ...INITIAL,
  setQ: (q) => set({ q }),
  setIndustry: (industry_code) => set({ industry_code }),
  setRegion: (region_kato) => set({ region_kato }),
  setSizeCategory: (size_category) => set({ size_category }),
  setStatus: (status) => set({ status }),
  setOwnership: (ownership_type) => set({ ownership_type }),
  setRevenueRange: (revenue_usd) => set({ revenue_usd }),
  setAgeRange: (business_age_years) => set({ business_age_years }),
  setBoth: (next) =>
    set((s) => ({
      industry_code: next.industry_code !== undefined ? next.industry_code : s.industry_code,
      region_kato: next.region_kato !== undefined ? next.region_kato : s.region_kato,
    })),
  clear: () => set({ ...INITIAL }),
}));

/**
 * Serialize a `NumberRange` to the backend "<gte>..<lte>" string format.
 * Returns `null` when both bounds are empty, so callers can drop the param.
 */
export function serializeRange(r: NumberRange): string | null {
  if (r.gte == null && r.lte == null) return null;
  return `${r.gte ?? ''}..${r.lte ?? ''}`;
}

/**
 * Build the query-param map for `/api/v1/companies` and
 * `/api/v1/export/companies` from the current store state. Skips empty values
 * so the URL stays tidy.
 */
export function buildCompanyQueryParams(
  s: Pick<
    DirectoryFilterState,
    | 'q'
    | 'industry_code'
    | 'region_kato'
    | 'size_category'
    | 'status'
    | 'ownership_type'
    | 'revenue_usd'
    | 'business_age_years'
  >,
): Record<string, string | number | undefined> {
  const params: Record<string, string | number | undefined> = {};
  if (s.q.trim()) params.q = s.q.trim();
  if (s.industry_code) params.industry = s.industry_code;
  if (s.region_kato) params.region_kato = s.region_kato;
  if (s.size_category) params.company_size = s.size_category;
  if (s.status) params.status = s.status;
  if (s.ownership_type) params.ownership_type = s.ownership_type;
  const rev = serializeRange(s.revenue_usd);
  if (rev) params.revenue_usd = rev;
  const age = serializeRange(s.business_age_years);
  if (age) params.business_age_years = age;
  return params;
}

/** Count of active (non-empty) filters, used for badge in collapsed rail. */
export function activeFilterCount(s: DirectoryFilterState): number {
  let n = 0;
  if (s.q.trim()) n += 1;
  if (s.industry_code) n += 1;
  if (s.region_kato) n += 1;
  if (s.size_category) n += 1;
  if (s.status) n += 1;
  if (s.ownership_type) n += 1;
  if (serializeRange(s.revenue_usd)) n += 1;
  if (serializeRange(s.business_age_years)) n += 1;
  return n;
}
