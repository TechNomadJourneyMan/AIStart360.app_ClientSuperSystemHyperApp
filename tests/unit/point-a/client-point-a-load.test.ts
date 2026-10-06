/**
 * #74: the client «Точка А» page must tell a failed diagnostic load apart
 * from "no diagnostic yet" — the old loader swallowed every failure and the
 * page silently dropped all level-2 sections.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DIAGNOSTIC_LOAD_ERROR, DIAGNOSTIC_SESSION_ERROR, loadClientPointA } from '@/components/point-a/client-point-a-load'

type Route = (url: string) => Response | Promise<Response>
const fetchOf = (diag: Route, comp: Route = () => Response.json({ ok: true, data: { id: 'co-1', name: 'ТОО Ромашка', industry: null, employee_count: null } })) =>
  (async (url: string) => (String(url).includes('/diagnostics/current') ? diag(String(url)) : comp(String(url)))) as unknown as typeof fetch

describe('loadClientPointA', () => {
  it('a 500 JSON error, a 502 HTML page and a network failure are errors, not "no diagnostic"', async () => {
    expect(await loadClientPointA('u1', fetchOf(() => Response.json({ ok: false, error: 'db' }, { status: 500 })))).toMatchObject({ ok: false, error: DIAGNOSTIC_LOAD_ERROR })
    expect(await loadClientPointA('u1', fetchOf(() => new Response('<html>Bad gateway</html>', { status: 502 })))).toMatchObject({ ok: false, error: DIAGNOSTIC_LOAD_ERROR })
    expect(await loadClientPointA('u1', fetchOf(() => { throw new TypeError('network') }))).toMatchObject({ ok: false, error: DIAGNOSTIC_LOAD_ERROR })
    expect(await loadClientPointA('u1', fetchOf(() => Response.json({ ok: false }, { status: 401 })))).toMatchObject({ ok: false, error: DIAGNOSTIC_SESSION_ERROR })
  })

  it('no diagnostic yet is ok with null; the company card failing is not fatal', async () => {
    const none = await loadClientPointA('u1', fetchOf(() => Response.json({ ok: true, data: null })))
    expect(none).toEqual({ ok: true, diagnostic: null, company: { id: 'co-1', name: 'ТОО Ромашка', industry: null, employee_count: null } })
    const diag = await loadClientPointA('u1', fetchOf(() => Response.json({ ok: true, data: { id: 'd1', overall_score: 47 } }), () => new Response('x', { status: 500 })))
    expect(diag).toMatchObject({ ok: true, diagnostic: { id: 'd1' }, company: null })
  })

  it('the page renders the load error with a retry instead of nothing', () => {
    const src = readFileSync('app/client/point-a/page.tsx', 'utf8')
    expect(src).toContain('loadClientPointA(userId)')
    expect(src).toMatch(/loadError \? \(/)
    expect(src).not.toMatch(/\} catch \{\}\n\s*setIsLoading\(false\)/)
  })
})
