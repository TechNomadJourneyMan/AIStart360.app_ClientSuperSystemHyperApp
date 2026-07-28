export type ClientDirectorySort = 'gri-desc' | 'gri-asc' | 'name'

export interface ClientDirectoryFilters {
  search: string
  industry: string
  status: string
  sort: ClientDirectorySort
}

export interface FilterableClient {
  name: string
  email?: string
  industry: string
  status: string
  griScore: number
}

export const DEFAULT_CLIENT_DIRECTORY_FILTERS: ClientDirectoryFilters = {
  search: '',
  industry: '',
  status: '',
  sort: 'gri-desc',
}

const ALLOWED_SORTS = new Set<ClientDirectorySort>(['gri-desc', 'gri-asc', 'name'])
const ALLOWED_STATUSES = new Set(['approved', 'pending_approval', 'requires_clarification'])

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase('ru-RU')
}

export function readClientDirectoryFilters(
  searchParams: Pick<URLSearchParams, 'get'>,
): ClientDirectoryFilters {
  const requestedSort = searchParams.get('sort')
  const requestedStatus = searchParams.get('status') ?? ''

  return {
    search: (searchParams.get('q') ?? '').slice(0, 200),
    industry: (searchParams.get('industry') ?? '').slice(0, 100),
    status: ALLOWED_STATUSES.has(requestedStatus) ? requestedStatus : '',
    sort: ALLOWED_SORTS.has(requestedSort as ClientDirectorySort)
      ? requestedSort as ClientDirectorySort
      : DEFAULT_CLIENT_DIRECTORY_FILTERS.sort,
  }
}

export function writeClientDirectoryFilters(
  searchParams: URLSearchParams,
  filters: ClientDirectoryFilters,
): URLSearchParams {
  const next = new URLSearchParams(searchParams)
  const values: Array<[string, string, string]> = [
    ['q', filters.search.trim(), ''],
    ['industry', filters.industry, ''],
    ['status', filters.status, ''],
    ['sort', filters.sort, DEFAULT_CLIENT_DIRECTORY_FILTERS.sort],
  ]

  values.forEach(([key, value, defaultValue]) => {
    if (!value || value === defaultValue) next.delete(key)
    else next.set(key, value)
  })

  return next
}

export function filterAndSortClients<T extends FilterableClient>(
  clients: T[],
  filters: ClientDirectoryFilters,
): T[] {
  const search = normalize(filters.search)

  return clients
    .filter((client) => {
      const matchesSearch = !search || [
        client.name,
        client.email ?? '',
        client.industry,
      ].some((value) => normalize(value).includes(search))
      const matchesIndustry = !filters.industry || client.industry === filters.industry
      const matchesStatus = !filters.status || client.status === filters.status

      return matchesSearch && matchesIndustry && matchesStatus
    })
    .sort((left, right) => {
      if (filters.sort === 'name') return left.name.localeCompare(right.name, 'ru-RU')
      if (filters.sort === 'gri-asc') return left.griScore - right.griScore
      return right.griScore - left.griScore
    })
}
