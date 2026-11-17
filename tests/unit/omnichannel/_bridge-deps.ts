import { existsSync } from 'node:fs'
import path from 'node:path'

/**
 * The bridge (services/whatsapp-web-bridge) has its own package.json; its dependencies, `baileys`
 * first of all, are installed by `npm --prefix services/whatsapp-web-bridge ci` (a CI step), not by
 * the root `npm ci`. Without them server.mjs dies on import and the end-to-end tests failed with
 * «bridge exited before readiness» — nothing said why. Say it.
 */
export function assertBridgeDependencies(): void {
  const baileys = path.resolve('services/whatsapp-web-bridge/node_modules/baileys/package.json')
  if (!existsSync(baileys)) {
    throw new Error(
      'The WhatsApp bridge dependencies are not installed (services/whatsapp-web-bridge/node_modules/baileys is missing). '
      + 'Run: npm --prefix services/whatsapp-web-bridge ci',
    )
  }
}
