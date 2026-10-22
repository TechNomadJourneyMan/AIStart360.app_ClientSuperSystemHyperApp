/**
 * W3 (PO 2026-10-22, п. 3): every cabinet / panel route shows a skeleton while
 * it loads instead of a frozen screen.
 *
 * Next.js shows the loading.tsx of segment S for any change of S's direct
 * child (the boundary is keyed by the child segment), so a page is covered on
 * navigation when its PARENT segment (or, for a section root, the segment
 * itself) has a loading.tsx. Client cabinet pages also get their own,
 * page-shaped skeleton.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PageSkeleton, PanelSkeleton, ScreenSkeleton } from '@/components/loading/PageSkeleton'

const ROOT = process.cwd()

function pages(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...pages(p))
    else if (name === 'page.tsx') out.push(dirname(p))
  }
  return out
}

const hasLoading = (dir: string) => existsSync(join(dir, 'loading.tsx'))
const isRedirectOnly = (dir: string) => {
  const src = readFileSync(join(dir, 'page.tsx'), 'utf8')
  return /\bredirect\(/.test(src) && !/return\s*\(?\s*</.test(src)
}

describe('client cabinet: a skeleton for every page', () => {
  const routes = pages(resolve(ROOT, 'app/client')).filter((d) => !isRedirectOnly(d))

  it('finds the cabinet pages', () => {
    expect(routes.length).toBeGreaterThanOrEqual(12)
  })

  it.each(routes.map((d) => [relative(ROOT, d)]))('%s has its own loading.tsx', (dir) => {
    expect(hasLoading(resolve(ROOT, dir))).toBe(true)
  })
})

describe('panels: every route is covered on navigation', () => {
  const roots = ['app/admin-giga-panel', 'app/super-expert/(workspace)', 'app/(expert)/expert']
  const routes = roots.flatMap((r) => pages(resolve(ROOT, r)).map((d) => ({ root: resolve(ROOT, r), dir: d })))

  it('finds the panel pages', () => {
    expect(routes.length).toBeGreaterThan(40)
  })

  it.each(routes.map(({ root, dir }) => [relative(ROOT, dir), root]))('%s', (dir, root) => {
    const abs = resolve(ROOT, dir)
    const covering = abs === root ? abs : dirname(abs)
    expect(hasLoading(covering), `${relative(ROOT, covering)}/loading.tsx`).toBe(true)
  })
})

describe('skeleton markup', () => {
  it.each([
    ['PageSkeleton', createElement(PageSkeleton, { label: 'Загрузка Точки А…' })],
    ['PageSkeleton tabs', createElement(PageSkeleton, { label: 'Загрузка Точки Б…', variant: 'tabs' })],
    ['PageSkeleton form', createElement(PageSkeleton, { label: 'Загрузка анкеты…', variant: 'form' })],
    ['ScreenSkeleton', createElement(ScreenSkeleton, { label: 'Загрузка…' })],
    ['PanelSkeleton', createElement(PanelSkeleton, { label: 'Загрузка раздела…' })],
  ])('%s is a polite busy status with a spoken label, reduced-motion aware, token colours only', (_n, el) => {
    const html = renderToStaticMarkup(el)
    expect(html).toContain('role="status"')
    expect(html).toContain('aria-busy="true"')
    expect(html).toMatch(/<span class="sr-only">Загрузка[^<]*<\/span>/)
    expect(html).toContain('motion-safe:animate-pulse')
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })
})
