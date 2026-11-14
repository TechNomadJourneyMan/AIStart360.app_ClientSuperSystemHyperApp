import { afterAll } from 'vitest'
import { installNetworkGuard } from './network-guard'
import { prisma } from './db'

// R-010: no real network from tests — only 127.0.0.1 / localhost / ::1.
// Installed before any test module is imported, so mocks a test installs
// sit on top of the guard and keep working.
installNetworkGuard()

afterAll(async () => {
  await prisma.$disconnect()
})
