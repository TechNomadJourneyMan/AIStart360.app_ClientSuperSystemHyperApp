/**
 * W2 (PO 2026-10-22, п. 8): «Вернуться в панель» in the client cabinet and
 * «Открыть кабинет клиента (проверка)» in the panels — only for staff, by the
 * role read on the server; a regular client never gets either button.
 */
import { describe, expect, it } from 'vitest'
import {
  CABINET_CHECK_LABEL,
  CLIENT_CABINET_HREF,
  expertCabinetLink,
  gigaCabinetLink,
  staffPanelLink,
} from '@/lib/client-shell/staff-links'

const approved = (profileRole: string, staffRole: string | null = null) => ({ profileRole, staffRole, status: 'approved' })

describe('staffPanelLink — «Вернуться в панель» (role → target)', () => {
  it.each([
    // profiles.role, staff_roles.role, target
    ['super_admin', null, '/admin-giga-panel'],
    ['client', 'super_admin', '/admin-giga-panel'],
    ['client', 'admin', '/admin-giga-panel'],
    ['admin', 'admin', '/admin-giga-panel'],
    ['client', 'crm_manager', '/admin-giga-panel'],
    ['client', 'content_manager', '/admin-giga-panel'],
    ['client', 'analyst', '/admin-giga-panel'],
    ['client', 'support', '/admin-giga-panel'],
    ['client', 'super_expert', '/super-expert'],
    ['expert', null, '/expert/dashboard'],
    // a legacy profiles.role 'admin' without a staff row cannot open GIGA, the expert portal admits it
    ['admin', null, '/expert/dashboard'],
    ['expert', 'crm_manager', '/admin-giga-panel'],
  ])('%s + %s → %s', (profileRole, staffRole, href) => {
    const link = staffPanelLink(approved(profileRole, staffRole))
    expect(link?.href).toBe(href)
    expect(link?.label).toBe('Вернуться в панель')
  })

  it('a regular client gets nothing', () => {
    expect(staffPanelLink(approved('client'))).toBeNull()
    expect(staffPanelLink(approved('owner'))).toBeNull()
    expect(staffPanelLink({ profileRole: null, staffRole: null, status: null })).toBeNull()
  })

  it('an unknown staff_roles value grants nothing', () => {
    expect(staffPanelLink(approved('client', 'god_mode'))).toBeNull()
  })

  it('an account that is not approved gets nothing, whatever the role', () => {
    for (const status of ['pending_approval', 'rejected', 'blocked', 'archived', null]) {
      expect(staffPanelLink({ profileRole: 'super_admin', staffRole: 'super_admin', status })).toBeNull()
    }
  })
})

describe('gigaCabinetLink — the button in GIGA / SuperExpert', () => {
  it('a staff member in their own session opens their own client cabinet', () => {
    expect(gigaCabinetLink({ kind: 'session' })).toEqual({ href: CLIENT_CABINET_HREF, label: CABINET_CHECK_LABEL })
    expect(CLIENT_CABINET_HREF).toBe('/client/home')
    expect(CABINET_CHECK_LABEL).toBe('Открыть кабинет клиента (проверка)')
  })

  it('hidden while impersonating (the browser holds the user\'s session) and without a verified actor', () => {
    expect(gigaCabinetLink({ kind: 'staff_cookie' })).toBeNull()
    expect(gigaCabinetLink(null)).toBeNull()
    expect(gigaCabinetLink(undefined)).toBeNull()
  })
})

describe('expertCabinetLink — the button in the expert portal', () => {
  it('an expert (and staff) get it', () => {
    expect(expertCabinetLink(approved('expert'))?.href).toBe('/client/home')
    expect(expertCabinetLink(approved('super_admin'))?.href).toBe('/client/home')
  })

  it('a client never does', () => {
    expect(expertCabinetLink(approved('client'))).toBeNull()
    expect(expertCabinetLink({ profileRole: 'expert', staffRole: null, status: 'pending_approval' })).toBeNull()
  })
})
