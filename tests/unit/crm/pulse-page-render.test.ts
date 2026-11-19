/**
 * The «Клиенты» CRM screen (app/(dashboard)/pulse/page.tsx, components/crm/*), rendered:
 *   L7 — a failed /api/v1/crm/today no longer takes the whole section down: the tabs (Base,
 *        Integrations) stay, and the failure is said with a retry;
 *   M2 — nothing on screen pretends to be order data: no fake order history, no «Цикл 30 дней»,
 *        no 999 days, no 0 ₸ for an unknown check, money at risk «нет данных» when unknown;
 *   M3 — the Base tab says «Показаны N из M» and reaches every client («Показать ещё»);
 *        the hook reads every page of /api/v1/crm/clients.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const s = vi.hoisted(() => ({
  today: { data: undefined as unknown, isLoading: false, error: null as unknown, isFetching: false },
  clients: { data: undefined as unknown, isLoading: false, error: null as unknown },
}))

vi.mock('@/hooks/useCrm', async (orig) => {
  const real = await orig<typeof import('@/hooks/useCrm')>()
  const mutation = () => ({ mutate: () => {}, isPending: false })
  return {
    ...real,
    useCrmToday: () => ({ ...s.today, refetch: async () => ({}) }),
    useCrmClients: () => ({ ...s.clients, refetch: async () => ({}) }),
    useCrmInteractions: () => ({ data: [], isLoading: false, error: null }),
    useCrmReminders: () => ({ data: [], isLoading: false, error: null }),
    useLogInteraction: mutation, useUpdateClient: mutation, useDeleteClient: mutation,
    useAddReminder: mutation, useCompleteReminder: mutation, useAddClient: mutation,
  }
})

import PulsePage from '@/app/(dashboard)/pulse/page'
import { ClientsTable } from '@/components/crm/ClientsTable'
import { CsvImportDialog } from '@/components/crm/CsvImportDialog'
import { funnelSumLabel } from '@/components/crm/FunnelBar'
import { fetchWholeBase } from '@/hooks/useCrm'

function render(el: Parameters<typeof createElement>[0]) {
  const qc = new QueryClient()
  return renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, createElement(el as never)))
}

const row = (over: Record<string, unknown> = {}) => ({
  id: 'c1', name: 'ТОО Ромашка', status: 'new', statusLabel: 'Новый', phone: null, phoneRaw: null, email: null, note: null, noteTruncated: false,
  nextContactAt: null, lastContactAt: null, daysSince: null, avgCheck: null, checkVsAvgPct: null, riskScore: 50,
  churnLevel: 'medium', action: 'call', comment: 'Нет ни одного касания', queueBucket: 2, ...over,
})

beforeEach(() => {
  s.today = { data: undefined, isLoading: false, error: null, isFetching: false }
  s.clients = { data: undefined, isLoading: false, error: null }
})

describe('CRM section when /api/v1/crm/today fails (L7)', () => {
  it('keeps the tabs (Base, Integrations) and says the queue failed, with a retry', () => {
    s.today.error = new Error('500')
    const html = render(PulsePage)
    expect(html).toContain('Не удалось загрузить очередь «Кому звонить сегодня»')
    expect(html).toContain('Повторить')
    expect(html).toContain('База клиентов')
    expect(html).toContain('CRM-интеграции')
    expect(html).not.toContain('Ошибка загрузки данных')
  })
})

describe('CRM section with data (M2: no invented numbers)', () => {
  it('unknown check / never touched / unknown money at risk are said as such', () => {
    s.today.data = {
      day: '2026-11-19',
      stats: { totalClients: 2, highRisk: 1, mediumRisk: 1, revenueAtRisk: null, highRiskWithoutCheck: 1, processedToday: 0, queue: { overdue: 0, today: 0, noPlan: 1, sleeping: 0 } },
      todayClients: [row()],
      todayClientsTotal: 1,
      riskClients: [row({ id: 'c2', name: 'Потерянный', status: 'lost', statusLabel: 'Потерян', churnLevel: 'high', riskScore: 95, queueBucket: null }), row()],
      riskClientsTotal: 2,
      aiBriefing: null,
    }
    const html = render(PulsePage)
    expect(html).toContain('нет данных') // money at risk
    expect(html).toContain('Сумма под угрозой неизвестна')
    expect(html).toContain('нет касаний')
    for (const invented of ['История заказов', 'Цикл ', 'просрочили цикл заказа', 'Возможна потеря', '999', '0 ₸', 'Изм. объёма', 'Вер-сть оттока', 'Дней без заказа', 'Последний заказ']) {
      expect(html).not.toContain(invented)
    }
    expect(html).not.toMatch(/Средний · \d+%/) // a heuristic level, not a «probability»
  })

  it('an empty queue says so instead of an empty table', () => {
    s.today.data = {
      day: '2026-11-19',
      stats: { totalClients: 3, highRisk: 0, mediumRisk: 0, revenueAtRisk: 0, highRiskWithoutCheck: 0, processedToday: 3, queue: { overdue: 0, today: 0, noPlan: 0, sleeping: 0 } },
      todayClients: [], todayClientsTotal: 0, riskClients: [], riskClientsTotal: 0, aiBriefing: null,
    }
    expect(render(PulsePage)).toContain('Очередь на сегодня пуста')
  })

  // Review M3: the queue is capped (50 rows) — the screen says how many there are in all.
  it('a capped queue says «показаны N из M»; the tab counts the whole queue', () => {
    const rows = Array.from({ length: 50 }, (_, i) => row({ id: `c${i}`, name: `Лид ${i}` }))
    s.today.data = {
      day: '2026-11-19',
      stats: { totalClients: 2000, highRisk: 0, mediumRisk: 2000, revenueAtRisk: 0, highRiskWithoutCheck: 0, processedToday: 0, queue: { overdue: 0, today: 0, noPlan: 2000, sleeping: 0 } },
      todayClients: rows, todayClientsTotal: 2000, riskClients: [], riskClientsTotal: 2000, aiBriefing: null,
    }
    const html = render(PulsePage)
    expect(html).toContain('Показаны первые 50 из 2000 по приоритету')
    expect(html).toContain('в очереди осталось 2000')
    // the tooltips name every rule of the score and of the action (review, low)
    expect(html).toContain('чек выше двух средних −5')
    expect(html).toContain('Звонок — статус «Потерян»')
  })
})

// Review (medium): a name-only row is the one client with that name; with several, it is skipped —
// and the dialog says the rule it applies (it said «без телефона и email — имя и комментарий»).
describe('import dialog copy', () => {
  it('states the name rule for rows without a phone and an e-mail', () => {
    const html = renderToStaticMarkup(
      createElement(QueryClientProvider, { client: new QueryClient() }, createElement(CsvImportDialog, { open: true, onClose: () => {} })),
    )
    expect(html).toContain('Строка только с именем (без телефона и email) дополняет клиента с таким же именем')
    expect(html).toContain('если таких клиентов несколько, строка пропускается')
    expect(html).not.toContain('имя и комментарий')
  })
})

describe('Base tab (M3)', () => {
  const client = (i: number) => ({
    id: `id-${i}`, user_id: 'u', name: `Клиент ${i}`, phone: null, phone_raw: null, email: null, status: 'new', source: null,
    avg_check: null, note: null, next_contact_at: null, last_contact_at: null, created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z',
  })

  it('shows «Показаны N из M» and a «Показать ещё» for the rest — every client is reachable', () => {
    s.clients.data = { clients: Array.from({ length: 150 }, (_, i) => client(i)), total: 150 }
    const html = render(ClientsTable)
    expect(html).toContain('Показаны 100 из 150')
    expect(html).toContain('Показать ещё 50')
    expect((html.match(/Клиент \d+/g) ?? []).length).toBe(100)
  })

  it('the funnel sums known checks only: «—» when none is known, «≥» when some are missing', () => {
    expect(funnelSumLabel(0, 0, 5)).toBe('—')
    expect(funnelSumLabel(1500, 1, 2)).toBe('≥ 2К ₸')
    expect(funnelSumLabel(1500, 2, 2)).toBe('2К ₸')
  })

  it('the hook reads every page of /api/v1/crm/clients (keyset cursor) — not the first 500', async () => {
    const urls: string[] = []
    const pages = [
      { clients: Array.from({ length: 1000 }, (_, i) => client(i)), total: 1205, nextCursor: 'id-999' },
      { clients: Array.from({ length: 205 }, (_, i) => client(1000 + i)), total: 1205, nextCursor: null },
    ]
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(url)
      return new Response(JSON.stringify({ ok: true, data: pages[urls.length - 1] }), { status: 200 })
    })
    try {
      const all = await fetchWholeBase()
      expect(all.total).toBe(1205)
      expect(all.clients).toHaveLength(1205)
      expect(urls).toEqual(['/api/v1/crm/clients?limit=1000', '/api/v1/crm/clients?limit=1000&after=id-999'])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  // Review (low): a server whose max-rows is below the page size returns short pages that are not the end.
  it('keeps reading after short pages until the server says there is no next page', async () => {
    const urls: string[] = []
    const pages = [0, 400, 800].map((from) => {
      const clients = Array.from({ length: Math.min(400, 1005 - from) }, (_, i) => client(from + i))
      return { clients, total: 1005, nextCursor: clients[clients.length - 1].id }
    })
    pages.push({ clients: [], total: 1005, nextCursor: null as unknown as string }) // the end: an empty page
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(url)
      return new Response(JSON.stringify({ ok: true, data: pages[urls.length - 1] }), { status: 200 })
    })
    try {
      const all = await fetchWholeBase()
      expect(all.clients).toHaveLength(1005)
      expect(urls).toHaveLength(4)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  // Review (low): it stopped once it had `total` clients — but the count is a separate query, stale
  // during a concurrent insert: a client added between the count and the pages was never shown.
  it('the end is nextCursor == null, not «as many as the count said»', async () => {
    const urls: string[] = []
    const pages = [
      // counted 1000 before the import's last row landed; the page already has a next cursor
      { clients: Array.from({ length: 1000 }, (_, i) => client(i)), total: 1000, nextCursor: 'id-999' },
      { clients: [client(1000)], total: 1001, nextCursor: 'id-1000' },
      { clients: [], total: 1001, nextCursor: null },
    ]
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(url)
      return new Response(JSON.stringify({ ok: true, data: pages[urls.length - 1] }), { status: 200 })
    })
    try {
      const all = await fetchWholeBase()
      expect(all.clients.map((c) => c.id)).toContain('id-1000')
      expect(all.clients).toHaveLength(1001)
      expect(all.total).toBe(1001)
      expect(urls).toHaveLength(3)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
