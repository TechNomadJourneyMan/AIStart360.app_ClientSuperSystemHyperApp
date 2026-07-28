import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CLIENT_DIRECTORY_FILTERS,
  filterAndSortClients,
  readClientDirectoryFilters,
  writeClientDirectoryFilters,
} from '@/lib/client-directory'

const CLIENTS = [
  { name: 'Beta Logistics', email: 'beta@example.com', industry: 'Logistics', status: 'approved', griScore: 7.1 },
  { name: 'Альфа Финтех', email: 'alpha@example.com', industry: 'FinTech', status: 'pending_approval', griScore: 8.4 },
  { name: 'Gamma Health', email: 'team@gamma.kz', industry: 'Healthcare', status: 'approved', griScore: 5.2 },
]

describe('client directory filters', () => {
  it('searches across client name, email and industry', () => {
    expect(filterAndSortClients(CLIENTS, {
      ...DEFAULT_CLIENT_DIRECTORY_FILTERS,
      search: 'FINTECH',
    }).map((client) => client.name)).toEqual(['Альфа Финтех'])

    expect(filterAndSortClients(CLIENTS, {
      ...DEFAULT_CLIENT_DIRECTORY_FILTERS,
      search: 'gamma.kz',
    }).map((client) => client.name)).toEqual(['Gamma Health'])
  })

  it('combines status and industry filters and applies the selected sort', () => {
    expect(filterAndSortClients(CLIENTS, {
      search: '',
      industry: '',
      status: 'approved',
      sort: 'gri-asc',
    }).map((client) => client.name)).toEqual(['Gamma Health', 'Beta Logistics'])
  })

  it('round-trips supported URL filters and preserves unrelated parameters', () => {
    const params = writeClientDirectoryFilters(new URLSearchParams('view=compact'), {
      search: 'beta',
      industry: 'Logistics',
      status: 'approved',
      sort: 'name',
    })

    expect(params.get('view')).toBe('compact')
    expect(readClientDirectoryFilters(params)).toEqual({
      search: 'beta',
      industry: 'Logistics',
      status: 'approved',
      sort: 'name',
    })
  })

  it('drops invalid status and sort values from the effective filter state', () => {
    expect(readClientDirectoryFilters(new URLSearchParams('status=unknown&sort=date'))).toEqual(
      DEFAULT_CLIENT_DIRECTORY_FILTERS,
    )
  })
})
