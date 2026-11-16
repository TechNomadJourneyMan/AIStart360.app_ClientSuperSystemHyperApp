/**
 * R-102 / R-029: error and 404 pages lead to the home of their section, never
 * to the bare `/` and never to the old /dashboard shell:
 *  - the GIGA panel and the SuperExpert workspace have their own error
 *    boundary (the shell stays) with «На главную» → their own home;
 *  - the client cabinet → /client/home, the expert portal → /expert/dashboard;
 *  - the shared RouteError, the root error page and the 404 → the cabinet by
 *    role (CABINET_ENTRY_PATH: middleware sends a signed-in user to the
 *    landing of the role, a guest sees the sign-in form).
 */
import { statSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { createElement, type ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/image', () => ({ default: (p: { alt: string; src: string }) => createElement('img', { alt: p.alt, src: p.src }) }))

type BoundaryProps = { error: Error & { digest?: string }; reset: () => void }
const props: BoundaryProps = { error: Object.assign(new Error('boom'), { digest: 'd1' }), reset: () => {} }
const hrefs = (html: string) => Array.from(html.matchAll(/href="([^"]*)"/g), (m) => m[1])
const renderBoundary = async (path: string) => {
  const { default: Boundary } = (await import(path)) as { default: ComponentType<BoundaryProps> }
  return renderToStaticMarkup(createElement(Boundary, props))
}

describe('R-102: each section has its own error boundary with its own home', () => {
  it.each([
    ['@/app/admin-giga-panel/error', '/admin-giga-panel', 'На главную панели'],
    ['@/app/super-expert/(workspace)/error', '/super-expert', 'На главную кабинета'],
    ['@/app/client/error', '/client/home', 'На главную'],
    ['@/app/(expert)/error', '/expert/dashboard', 'На главную'],
  ])('%s → %s', async (path, home, label) => {
    const html = await renderBoundary(path)
    expect(hrefs(html)).toEqual([home])
    expect(html).toContain(label)
    expect(html).toContain('Повторить')
    expect(html).toContain('Код: d1')
  })

  it('the boundaries exist next to the layouts they protect', () => {
    for (const f of ['app/admin-giga-panel/error.tsx', 'app/super-expert/(workspace)/error.tsx']) expect(() => statSync(f), f).not.toThrow()
  })
})

describe('R-102 / R-029: no error page leads to «/» or to the old /dashboard', () => {
  it('the shared RouteError defaults to the cabinet by role', async () => {
    const { default: RouteError } = await import('@/components/common/RouteError')
    const html = renderToStaticMarkup(createElement(RouteError, props))
    expect(hrefs(html)).toEqual(['/login'])
  })

  it('the auth and public groups re-use it (→ the cabinet by role)', async () => {
    for (const path of ['@/app/(auth)/error', '@/app/(public)/error']) expect(hrefs(await renderBoundary(path)), path).toEqual(['/login'])
  })

  it('the root error page', async () => {
    expect(hrefs(await renderBoundary('@/app/error'))).toEqual(['/login'])
  })

  it('the 404 page: «В кабинет» by role instead of «На дашборд»', async () => {
    const { default: NotFound } = await import('@/app/not-found')
    const html = renderToStaticMarkup(createElement(NotFound))
    expect(html).toContain('В кабинет')
    expect(html).not.toContain('На дашборд')
    expect(hrefs(html)).toContain('/login')
    expect(hrefs(html)).not.toContain('/dashboard')
  })
})
