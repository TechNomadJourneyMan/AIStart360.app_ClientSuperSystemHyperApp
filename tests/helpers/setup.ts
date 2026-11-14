import { afterAll, vi } from 'vitest'
import { installNetworkGuard } from './network-guard'
import { prisma } from './db'

// R-010: no real network from tests — only 127.0.0.1 / localhost / ::1.
// Installed before any test module is imported, so mocks a test installs
// sit on top of the guard and keep working.
installNetworkGuard()

afterAll(async () => {
  await prisma.$disconnect()
})

// R2-A (ревью M-2): in production an unreadable `access_gates` switch fails
// CLOSED (lib/settings/system-settings.ts). The test environment has no
// settings table behind the service client, so every test would see the paid
// sections closed. Give the tests a deterministic value instead — the switch
// is OFF (its default) unless a test mocks the module itself (a per-file
// vi.mock replaces this one). The real fail-closed reader is tested with
// vi.importActual in tests/unit/access/access-gates-fail-closed.test.ts.
vi.mock('@/lib/settings/system-settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/settings/system-settings')>()
  return { ...actual, getAccessGatesEnabled: async () => false }
})
