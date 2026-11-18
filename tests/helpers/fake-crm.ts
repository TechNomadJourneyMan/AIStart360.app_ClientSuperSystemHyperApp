/**
 * Fake Bitrix24 and amoCRM REST APIs for the CRM sync tests: a `fetch` that answers like the real
 * services (shapes from the official docs), keeps every call, and never touches the network.
 *
 *   Bitrix24 (apidocs.bitrix24.ru): POST https://<portal>/rest/<user>/<key>/<method>.json, JSON body
 *     { select, order, filter, start }; a list answers { result: [≤ 50], total, next?, time }; `next`
 *     only while more remain; errors as { error, error_description } with an HTTP status.
 *   amoCRM API v4: GET https://<account>/api/v4/<entity>?limit=&page=…, `limit` above 250 is HTTP 400;
 *     a list answers { _page, _links: { self, next? }, _embedded: { <entity>: [...] } }; an empty page
 *     is HTTP 204 without a body; leads carry `_embedded.contacts` only with `with=contacts`.
 */

export interface FakeCall {
  url: string
  method: string
  body: Record<string, unknown> | null
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const byIdDesc = (a: Record<string, unknown>, b: Record<string, unknown>) => Number(b.ID ?? b.id) - Number(a.ID ?? a.id)
const byIdAsc = (a: Record<string, unknown>, b: Record<string, unknown>) => Number(a.ID ?? a.id) - Number(b.ID ?? b.id)

// ── Bitrix24 ─────────────────────────────────────────────────────────────────

export interface BitrixState {
  contacts: Record<string, unknown>[]
  deals: Record<string, unknown>[]
  /** A canned answer for (method, start), e.g. an error of a later page. */
  fail?: (method: string, start: number) => Response | null
}

export function bxContact(id: number, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ID: String(id),
    NAME: `Клиент${id}`,
    SECOND_NAME: null,
    LAST_NAME: 'Тестов',
    PHONE: [{ ID: String(id * 10), VALUE_TYPE: 'WORK', VALUE: `+7 701 ${String(id).padStart(7, '0')}`, TYPE_ID: 'PHONE' }],
    EMAIL: [{ ID: String(id * 10 + 1), VALUE_TYPE: 'WORK', VALUE: `c${id}@example.kz`, TYPE_ID: 'EMAIL' }],
    ...over,
  }
}

export function bxDeal(id: number, contactId: number | null, amount: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ID: String(id),
    TITLE: `Сделка ${id}`,
    CONTACT_ID: contactId === null ? null : String(contactId),
    OPPORTUNITY: amount,
    CURRENCY_ID: 'KZT',
    STAGE_ID: 'WON',
    STAGE_SEMANTIC_ID: 'S',
    ...over,
  }
}

export function fakeBitrix(state: BitrixState) {
  const calls: FakeCall[] = []
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input instanceof Request ? input.url : input)
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null
    calls.push({ url, method: init?.method ?? 'GET', body })
    const m = /\/rest\/(?:\d+\/[A-Za-z0-9]+\/)?([a-z.]+)\.json$/.exec(new URL(url).pathname)
    const method = m?.[1] ?? ''
    const start = Number(body?.start ?? 0)
    const canned = state.fail?.(method, start)
    if (canned) return canned
    if (method === 'profile') return json({ result: { ID: '1', ADMIN: true, NAME: 'Владелец', LAST_NAME: '' }, time: {} })
    const list = method === 'crm.contact.list' ? state.contacts : method === 'crm.deal.list' ? state.deals : null
    if (!list) return json({ error: 'ERROR_METHOD_NOT_FOUND', error_description: 'Method not found!' }, 404)
    const order = (body?.order ?? {}) as Record<string, string>
    const sorted = [...list].sort(order.ID === 'ASC' ? byIdAsc : byIdDesc)
    const select = Array.isArray(body?.select) ? (body!.select as string[]) : null
    const page = sorted.slice(start, start + 50).map((r) => (select ? Object.fromEntries(select.map((k) => [k, r[k] ?? null])) : r))
    const out: Record<string, unknown> = {
      result: page,
      total: sorted.length,
      time: { start: 1763460000.1, finish: 1763460000.2, duration: 0.1, processing: 0.05, date_start: '2026-11-18T10:00:00+05:00', date_finish: '2026-11-18T10:00:00+05:00', operating: 0 },
    }
    if (start + 50 < sorted.length) out.next = start + 50
    return json(out)
  }
  return { fetchImpl, calls }
}

// ── amoCRM ───────────────────────────────────────────────────────────────────

export interface AmoState {
  contacts: Record<string, unknown>[]
  leads: Record<string, unknown>[]
  currency?: string | null
  /** A canned answer for (entity, page). */
  fail?: (entity: string, page: number) => Response | null
}

export function amoContact(id: number, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    name: `Контакт ${id}`,
    first_name: `Контакт`,
    last_name: String(id),
    responsible_user_id: 504141,
    group_id: 0,
    created_by: 504141,
    updated_by: 504141,
    created_at: 1582117331,
    updated_at: 1590943929,
    closest_task_at: null,
    is_deleted: false,
    is_unsorted: false,
    custom_fields_values: [
      { field_id: 3, field_name: 'Телефон', field_code: 'PHONE', field_type: 'multitext', values: [{ value: `+7702${String(id).padStart(7, '0')}`, enum_id: 1, enum_code: 'WORK' }] },
      { field_id: 5, field_name: 'Email', field_code: 'EMAIL', field_type: 'multitext', values: [{ value: `a${id}@example.kz`, enum_id: 3, enum_code: 'WORK' }] },
    ],
    account_id: 28805383,
    _links: { self: { href: `https://acme.amocrm.ru/api/v4/contacts/${id}` } },
    _embedded: { tags: [], companies: [] },
    ...over,
  }
}

export function amoLead(id: number, contactIds: number[], price: number, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    name: `Сделка ${id}`,
    price,
    responsible_user_id: 504141,
    group_id: 0,
    status_id: 142,
    pipeline_id: 3177727,
    loss_reason_id: null,
    created_by: 504141,
    updated_by: 504141,
    created_at: 1589556420,
    updated_at: 1589556420,
    closed_at: 1589556420,
    closest_task_at: null,
    is_deleted: false,
    custom_fields_values: null,
    score: null,
    account_id: 28805383,
    labor_cost: null,
    _links: { self: { href: `https://acme.amocrm.ru/api/v4/leads/${id}` } },
    _embedded: {
      tags: [],
      companies: [],
      contacts: contactIds.map((cid, i) => ({ id: cid, is_main: i === 0, _links: { self: { href: `https://acme.amocrm.ru/api/v4/contacts/${cid}` } } })),
    },
    ...over,
  }
}

export function fakeAmo(state: AmoState) {
  const calls: FakeCall[] = []
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input instanceof Request ? input.url : input))
    calls.push({ url: url.toString(), method: init?.method ?? 'GET', body: null })
    const entity = url.pathname.replace(/^\/api\/v4\//, '')
    const page = Number(url.searchParams.get('page') ?? '1')
    const canned = state.fail?.(entity, page)
    if (canned) return canned
    if (entity === 'account') {
      return json({ id: 28805383, name: 'Acme', subdomain: 'acme', created_at: 1582117331, country: 'KZ', currency: state.currency === undefined ? 'KZT' : state.currency, currency_symbol: '₸', _links: { self: { href: `${url.origin}/api/v4/account` } } })
    }
    const list = entity === 'contacts' ? state.contacts : entity === 'leads' ? state.leads : null
    if (!list) return json({ title: 'Not Found', status: 404 }, 404)
    const limit = Number(url.searchParams.get('limit') ?? '50')
    if (limit > 250) return json({ title: 'Bad Request', type: 'https://httpstatus.es/400', status: 400, detail: 'Request validation failed', 'validation-errors': [{ request_id: '0', errors: [{ code: 'NotSupportedChoice', path: 'limit', detail: 'Value must be less than or equal to 250' }] }] }, 400)
    const desc = url.searchParams.get('order[id]') === 'desc' || url.searchParams.get('order[updated_at]') === 'desc'
    const sorted = [...list].sort(desc ? byIdDesc : byIdAsc)
    const rows = sorted.slice((page - 1) * limit, page * limit)
    if (rows.length === 0) return new Response(null, { status: 204 })
    const withContacts = (url.searchParams.get('with') ?? '').split(',').includes('contacts')
    const shaped = entity === 'leads' && !withContacts
      ? rows.map((r) => ({ ...r, _embedded: { ...(r._embedded as object), contacts: undefined } }))
      : rows
    const self = `${url.origin}${url.pathname}?limit=${limit}&page=${page}`
    const links: Record<string, { href: string }> = { self: { href: self } }
    if (page * limit < sorted.length) links.next = { href: `${url.origin}${url.pathname}?limit=${limit}&page=${page + 1}` }
    return json({ _page: page, _links: links, _embedded: { [entity]: shaped } })
  }
  return { fetchImpl, calls }
}

/** A DNS answer with a public address, for the SSRF guard (lib/crm/endpoint-guard.ts). */
export const publicDns = async (): Promise<string[]> => ['93.184.216.34']
