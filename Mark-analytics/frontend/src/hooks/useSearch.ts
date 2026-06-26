import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { apiGet } from '@/services/api';

/**
 * Global search hook backed by `GET /api/v1/search`.
 * Backend may currently return an empty result envelope (Phase 0 stub).
 */

export type SearchEntityType = 'companies' | 'persons' | 'tenders';

export interface SearchHitBase {
  id: string;
  type: SearchEntityType;
  title: string;
  subtitle?: string | null;
  score?: number | null;
}

export interface CompanySearchHit extends SearchHitBase {
  type: 'companies';
  bin?: string | null;
  region_kato?: string | null;
  industry?: string | null;
}

export interface PersonSearchHit extends SearchHitBase {
  type: 'persons';
  role?: string | null;
  company_id?: string | null;
}

export interface TenderSearchHit extends SearchHitBase {
  type: 'tenders';
  amount?: number | null;
  status?: string | null;
}

export type SearchHit = CompanySearchHit | PersonSearchHit | TenderSearchHit;

export interface SearchResponse {
  companies: CompanySearchHit[];
  persons: PersonSearchHit[];
  tenders: TenderSearchHit[];
  total: number;
}

const EMPTY_RESPONSE: SearchResponse = {
  companies: [],
  persons: [],
  tenders: [],
  total: 0,
};

type RawSearchHit = Partial<SearchHit> & {
  id?: string;
  type?: string;
  title?: string;
  name?: string;
};

interface RawSearchResponse {
  companies?: RawSearchHit[] | null;
  persons?: RawSearchHit[] | null;
  tenders?: RawSearchHit[] | null;
  items?: RawSearchHit[] | null;
  total?: number | null;
}

function normalizeHits<T extends SearchHit>(
  raw: RawSearchHit[] | null | undefined,
  type: SearchEntityType,
): T[] {
  if (!raw) return [];
  return raw
    .filter((h): h is RawSearchHit => Boolean(h && h.id))
    .map((h) => ({
      ...h,
      id: String(h.id),
      type,
      title: h.title ?? h.name ?? String(h.id),
    })) as T[];
}

function parseEnvelope(raw: RawSearchResponse | null): SearchResponse {
  if (!raw) return EMPTY_RESPONSE;

  // Support either grouped shape or flat `items` shape with `type` discriminator.
  if (Array.isArray(raw.items)) {
    const companies: CompanySearchHit[] = [];
    const persons: PersonSearchHit[] = [];
    const tenders: TenderSearchHit[] = [];
    for (const item of raw.items) {
      if (!item || !item.id) continue;
      const id = String(item.id);
      const title = item.title ?? item.name ?? id;
      switch (item.type) {
        case 'companies':
          companies.push({ ...(item as CompanySearchHit), id, type: 'companies', title });
          break;
        case 'persons':
          persons.push({ ...(item as PersonSearchHit), id, type: 'persons', title });
          break;
        case 'tenders':
          tenders.push({ ...(item as TenderSearchHit), id, type: 'tenders', title });
          break;
        default:
          break;
      }
    }
    return {
      companies,
      persons,
      tenders,
      total:
        typeof raw.total === 'number'
          ? raw.total
          : companies.length + persons.length + tenders.length,
    };
  }

  const companies = normalizeHits<CompanySearchHit>(raw.companies, 'companies');
  const persons = normalizeHits<PersonSearchHit>(raw.persons, 'persons');
  const tenders = normalizeHits<TenderSearchHit>(raw.tenders, 'tenders');
  return {
    companies,
    persons,
    tenders,
    total:
      typeof raw.total === 'number'
        ? raw.total
        : companies.length + persons.length + tenders.length,
  };
}

export interface UseSearchOptions {
  query: string;
  types?: SearchEntityType[];
  enabled?: boolean;
}

const DEFAULT_TYPES: SearchEntityType[] = ['companies', 'persons', 'tenders'];

export function useSearch(
  options: UseSearchOptions,
): UseQueryResult<SearchResponse, Error> {
  const { query, types = DEFAULT_TYPES, enabled = true } = options;
  const normalizedQuery = query.trim();
  const isActive = enabled && normalizedQuery.length >= 2;

  return useQuery<SearchResponse, Error>({
    queryKey: ['search', normalizedQuery, types],
    enabled: isActive,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    placeholderData: (prev) => prev,
    queryFn: async ({ signal }) => {
      const raw = await apiGet<RawSearchResponse | null>(
        '/api/v1/search',
        {
          q: normalizedQuery,
          types: types.join(','),
        },
        signal,
      );
      return parseEnvelope(raw);
    },
  });
}

export default useSearch;
