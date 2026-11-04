import { describe, expect, it } from 'vitest'
import { hasGigaPanelAccess, panelLinksFor } from '@/lib/panel-links'
import { getNavForRole } from '@/lib/navigation'

const hrefs = (input: Parameters<typeof panelLinksFor>[0]) => panelLinksFor(input).map((l) => l.href)

describe('panelLinksFor — кнопки «Админ-панель» / «Панель эксперта»', () => {
  it('обычный клиент не видит ни одной кнопки', () => {
    expect(hrefs({ role: 'client' })).toEqual([])
    expect(hrefs({ role: 'client', staffRole: null, status: 'approved' })).toEqual([])
    // Мусор в staff_roles кнопку не даёт.
    expect(hrefs({ role: 'client', staffRole: 'owner' })).toEqual([])
  })

  it('super_admin (profiles.role) получает обе панели', () => {
    expect(hrefs({ role: 'super_admin', status: 'approved' })).toEqual(['/admin-giga-panel', '/super-expert'])
  })

  it('неодобренный super_admin — как middleware: без панелей', () => {
    expect(hrefs({ role: 'super_admin', status: 'pending_approval' })).toEqual([])
  })

  it('персонал из staff_roles с profiles.role client', () => {
    expect(hrefs({ role: 'client', staffRole: 'super_admin' })).toEqual(['/admin-giga-panel', '/super-expert'])
    expect(hrefs({ role: 'client', staffRole: 'admin' })).toEqual(['/admin-giga-panel', '/super-expert'])
    expect(hrefs({ role: 'client', staffRole: 'crm_manager' })).toEqual(['/admin-giga-panel', '/super-expert'])
    expect(hrefs({ role: 'client', staffRole: 'content_manager' })).toEqual(['/admin-giga-panel'])
    expect(hrefs({ role: 'client', staffRole: 'analyst' })).toEqual(['/admin-giga-panel'])
    expect(hrefs({ role: 'client', staffRole: 'support' })).toEqual(['/admin-giga-panel'])
  })

  it('SuperExpert — только кабинет эксперта', () => {
    const links = panelLinksFor({ role: 'client', staffRole: 'super_expert' })
    expect(links.map((l) => l.href)).toEqual(['/super-expert'])
    expect(links[0].label).toBe('Панель эксперта')
  })

  it('эксперт по profiles.role без роли персонала — свой кабинет эксперта', () => {
    expect(hrefs({ role: 'expert' })).toEqual(['/expert/dashboard'])
    // С ролью SuperExpert ведём в /super-expert, без дубля.
    expect(hrefs({ role: 'expert', staffRole: 'super_expert' })).toEqual(['/super-expert'])
  })

  it('legacy profiles.role admin без staff_roles панель не получает (middleware её не пустит)', () => {
    expect(hrefs({ role: 'admin' })).toEqual([])
  })

  it('подписи', () => {
    const [giga, se] = panelLinksFor({ role: 'super_admin' })
    expect(giga.label).toBe('Админ-панель')
    expect(se.label).toBe('Панель эксперта')
  })

  it('hasGigaPanelAccess — доступ к ссылкам «Пользователи»/«Заявки»', () => {
    expect(hasGigaPanelAccess({ role: 'client', staffRole: 'support' })).toBe(true)
    expect(hasGigaPanelAccess({ role: 'client', staffRole: 'super_expert' })).toBe(false)
    expect(hasGigaPanelAccess({ role: 'admin' })).toBe(false)
    expect(hasGigaPanelAccess({ role: 'client' })).toBe(false)
  })
})

describe('lib/navigation: ссылки ГИГА-Панели зависят только от доступа к панели', () => {
  it('сотрудник со staff_roles и profiles.role client видит «Пользователи»/«Заявки»', () => {
    const access = { panelAccess: hasGigaPanelAccess({ role: 'client', staffRole: 'crm_manager' }) }
    const nav = getNavForRole('client', access).map((i) => i.href)
    expect(nav).toContain('/admin-giga-panel/users')
    expect(nav).toContain('/admin-giga-panel/requests')
  })

  it('обычный клиент — нет', () => {
    const nav = getNavForRole('client', { panelAccess: hasGigaPanelAccess({ role: 'client' }) }).map((i) => i.href)
    expect(nav).not.toContain('/admin-giga-panel/users')
    expect(getNavForRole('client').map((i) => i.href)).not.toContain('/admin-giga-panel/requests')
  })
})
