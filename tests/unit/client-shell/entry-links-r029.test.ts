/**
 * R-029 / N4B-6: the client-side entries that cannot be rendered without a DOM
 * (they act in effects / handlers) — checked in their source, the behaviour of
 * the target is covered by tests/unit/auth/middleware-landing-r029.test.ts:
 *  - the welcome screen sends an onboarded client and «Просто посмотрю» to the
 *    cabinet's home page, not to the old /dashboard;
 *  - the finished password reset (also the invitation's first password) and the
 *    e-mail sign-in link go to the cabinet by role (CABINET_ENTRY_PATH);
 *  - «Мои документы» (the header quick action, the upload dialogs) lead to the
 *    free documents page, not to the paid Point A.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CABINET_ENTRY_PATH } from '@/lib/role-landing'
import { CLIENT_DOCUMENTS_HREF } from '@/lib/documents/client-upload'
import { CLIENT_NAV_DEFS } from '@/lib/client-shell/nav'

const src = (f: string) => readFileSync(f, 'utf8')
/** Navigation calls / links that point at the old shell's dashboard. */
const OLD_DASHBOARD = /(?:replace|push|redirect)\(\s*['"]\/dashboard['"]|href=["']\/dashboard["']|['"]\/dashboard['"]\s*[:)]/

describe('R-029: client entries lead to the cabinet', () => {
  it('the welcome screen: onboarded → /client/home, «Просто посмотрю» → /client/home', () => {
    const s = src('app/client/welcome/page.tsx')
    expect(s).not.toMatch(OLD_DASHBOARD)
    expect(s).toContain("const CABINET_HOME = '/client/home'")
    expect(s.match(/router\.replace\(CABINET_HOME\)/g)).toHaveLength(2)
    expect(s).not.toContain('Открыть пустой дашборд')
  })

  it('the finished password reset / invitation password → the cabinet by role', () => {
    const s = src('app/auth/reset-password/ResetPasswordForm.tsx')
    expect(s).toContain('router.replace(CABINET_ENTRY_PATH)')
    expect(s).toContain('href={CABINET_ENTRY_PATH}')
    expect(CABINET_ENTRY_PATH).toBe('/login')
  })

  it('the sign-in form sends the e-mail link back to the cabinet by role', () => {
    const s = src('components/auth-home/LoginForm.tsx')
    expect(s).toContain('safeInternalPath(rawFrom, CABINET_ENTRY_PATH)')
    expect(s).not.toMatch(OLD_DASHBOARD)
  })

  it('the auth routes and the invitation have no /dashboard fallback left', () => {
    for (const f of ['app/auth/verify/route.ts', 'app/auth/callback/route.ts', 'app/api/v1/auth/email-link/route.ts', 'lib/admin/invites.ts', 'app/not-found.tsx', 'app/error.tsx', 'components/common/RouteError.tsx']) {
      expect(src(f), f).not.toMatch(/['"]\/dashboard['"]/)
    }
  })
})

describe('N4B-6: «Мои документы» → the free documents page', () => {
  it('is the cabinet menu\'s «Документы» page, not Point A', () => {
    expect(CLIENT_DOCUMENTS_HREF).toBe(CLIENT_NAV_DEFS.find((d) => d.key === 'documents')?.href)
    expect(CLIENT_DOCUMENTS_HREF.startsWith('/point-a')).toBe(false)
  })

  it('the header quick action and both upload dialogs use it', async () => {
    const { QUICK_ACTION_GROUPS } = await import('@/components/layout/Header')
    const docs = QUICK_ACTION_GROUPS.flatMap((g) => g.items).find((a) => a.label === 'Мои документы')
    expect(docs?.href).toBe(CLIENT_DOCUMENTS_HREF)
    for (const f of ['components/layout/Header.tsx', 'components/point-a/PointAQuickToolbar.tsx']) {
      const s = src(f)
      expect(s, f).not.toContain('/point-a#files')
      expect(s, f).toContain('documentsHref={CLIENT_DOCUMENTS_HREF}')
    }
  })
})
