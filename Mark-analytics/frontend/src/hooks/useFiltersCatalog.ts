/**
 * Fetch the filter taxonomy from `GET /api/v1/filters`. The backend returns
 * `FilterDefinition[]` (see `backend/app/schemas/filters.py`). Used by the
 * Directory page filter rail to render the right control per filter type.
 *
 * If the endpoint is missing (older deployments) the hook falls back to a
 * small hard-coded "core" subset so the UI is still useful.
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { apiGet } from '../services/api';

export type FilterType =
  | 'enum'
  | 'multi_enum'
  | 'multi_text'
  | 'range_number'
  | 'range_date'
  | 'bool'
  | 'text'
  | 'composite';

export interface FilterDefinition {
  key: string;
  type: FilterType;
  values?: string[] | null;
  description?: string | null;
  backed_by?: string | null;
}

const FALLBACK_FILTERS: FilterDefinition[] = [
  { key: 'industry', type: 'multi_enum', values: null, description: 'Industry (ОКЭД)' },
  { key: 'region_kato', type: 'multi_text', description: 'Region (KATO)' },
  {
    key: 'company_size',
    type: 'enum',
    values: ['micro', 'small', 'medium', 'large', 'enterprise'],
    description: 'Company size',
  },
  { key: 'business_age_years', type: 'range_number', description: 'Business age (years)' },
  { key: 'revenue_usd', type: 'range_number', description: 'Revenue (USD)' },
  {
    key: 'ownership_type',
    type: 'enum',
    values: ['private', 'public', 'state', 'mixed', 'foreign_owned'],
    description: 'Ownership',
  },
  {
    key: 'status',
    type: 'enum',
    values: ['active', 'liquidated', 'reorganizing', 'bankrupt', 'suspended'],
    description: 'Status',
  },
];

export function useFiltersCatalog(): UseQueryResult<FilterDefinition[], Error> {
  return useQuery<FilterDefinition[], Error>({
    queryKey: ['filters', 'catalog'],
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    retry: 0,
    queryFn: async ({ signal }) => {
      try {
        const data = await apiGet<FilterDefinition[]>('/api/v1/filters', undefined, signal);
        if (Array.isArray(data) && data.length > 0) return data;
        return FALLBACK_FILTERS;
      } catch {
        return FALLBACK_FILTERS;
      }
    },
  });
}

export default useFiltersCatalog;
