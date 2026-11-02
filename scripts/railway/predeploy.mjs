#!/usr/bin/env node
/**
 * scripts/railway/predeploy.mjs — Railway's pre-deploy command (runs once per deploy, before the
 * new instance starts taking traffic).
 *
 * With the Postgres Workflow world it creates the queue tables: it runs the `bootstrap` command of
 * @workflow/world-postgres (the documented `npx --package=@workflow/world-postgres bootstrap`,
 * here taken from node_modules so a deploy never fetches anything). Bootstrap is idempotent.
 * With any other world there is nothing to prepare and the script steps aside with exit 0.
 *
 * The database is only ever the one named in WORKFLOW_POSTGRES_URL. Bootstrap would otherwise fall
 * back to DATABASE_URL or to a localhost default, and a quiet fallback is not what a deploy step
 * should do to a database, so a missing URL stops the deploy.
 */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'

const WORLD = '@workflow/world-postgres'

if (process.env.WORKFLOW_TARGET_WORLD !== WORLD) {
  console.log(`predeploy: пропуск (WORKFLOW_TARGET_WORLD=${process.env.WORKFLOW_TARGET_WORLD || '<не задан>'}, не ${WORLD})`)
  process.exit(0)
}

if (!process.env.WORKFLOW_POSTGRES_URL) {
  console.error(`predeploy: ${WORLD} выбран, но WORKFLOW_POSTGRES_URL не задан - таблицы очереди не создаются`)
  process.exit(1)
}

// The package's `exports` has no path to its bin, so go from the entry point (dist/index.js) up to bin/.
const entry = createRequire(import.meta.url).resolve(WORLD)
const bootstrap = path.join(path.dirname(entry), '..', 'bin', 'setup.js')

console.log(`predeploy: ${WORLD} bootstrap`)
const result = spawnSync(process.execPath, [bootstrap], { stdio: 'inherit', env: process.env })
if (result.error) {
  console.error(`predeploy: bootstrap не запустился: ${result.error.message}`)
  process.exit(1)
}
process.exit(result.status ?? 1)
