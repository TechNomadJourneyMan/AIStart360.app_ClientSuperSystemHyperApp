/**
 * .railway/railway.ts — Railway Infrastructure as Code for the portal (R-020). DRAFT, NOT APPLIED.
 *
 * Replaces the deprecated Config as Code file `railway.json` (Railway stops reading it on
 * 2026-12-01). Railway does NOT read `.railway/` during deploys: nothing here takes effect until
 * someone runs `railway config apply`. Before that, follow docs/deploy/railway-config.md:
 *   1. `npm i -D railway` (the SDK this file imports; not installed in the repo yet),
 *   2. `railway config pull --file /tmp/railway.pulled.ts` and reconcile with this file,
 *   3. `railway config plan` must show NO changes (this file only restates today's settings).
 *
 * `partial = "portal"`: a named partial only creates/updates/deletes the resources it owns. The
 * project has ~14 other services (self-hosted Supabase, Postgres, db-backup, bucket…) that this
 * file must never touch — without a partial, every resource missing here would be DELETED.
 *
 * Values mirror the live `portal` service (set with update-service on 2026-11-04) and railway.json:
 *   start        node node_modules/next/dist/bin/next start -H 0.0.0.0   (-H 0.0.0.0: IPv4 listen)
 *   build        npm run build                     (Railpack)
 *   preDeploy    node scripts/railway/predeploy.mjs (Workflow tables; no-op with PORTAL_ROLE=agents)
 *   healthcheck  /api/healthz, timeout 300 s
 *   restart      ON_FAILURE
 *   teardown     overlap 45 s, draining 60 s (> 55 s wait in lib/runtime/server-start.ts)
 *   region       europe-west4 (ams), 1 replica
 * Variables are deliberately NOT declared here (secrets stay in Railway; see the doc).
 *
 * This file lives outside the TypeScript project: tsconfig's `**` glob skips dot-directories, so
 * `tsc`/`next build` never type-check it (the `railway` package is not a dependency).
 */
import { defineRailway, project, service } from 'railway/iac'

export const partial = 'portal'

export default defineRailway(() => {
  const portal = service('portal', {
    build: 'npm run build',
    start: 'node node_modules/next/dist/bin/next start -H 0.0.0.0',
    healthcheck: '/api/healthz',
    healthcheckTimeout: 300,
    replicas: { 'europe-west4': 1 },
    // The settings below exist on the live service but their IaC field names could not be confirmed
    // from the docs on 2026-11-14 (docs.railway.com/infrastructure-as-code/reference). Take the exact
    // spelling from `railway config pull` and uncomment; until then `plan` must not show them changing.
    // preDeployCommand: ['node scripts/railway/predeploy.mjs'],
    // restartPolicyType: 'ON_FAILURE',
    // overlapSeconds: 45,
    // drainingSeconds: 60,
  })

  // The agents service (PORTAL_ROLE=agents, docs/railway-agents-service.md) is built from the same
  // repo with the same build/start. Add it here under its real name once `railway config pull`
  // shows it, e.g. service('<agents service name>', { …same build/start/healthcheck…, no preDeploy }).

  return project('aistart360-portal', { resources: [portal] })
})
