import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/** Railway's deployment id is a UUID; anything else in the variable is not echoed. */
const DEPLOYMENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const COMMIT_SHA = /^[0-9a-f]{7,40}$/i

/**
 * What is deployed (R4-A4, N4A-6), read per request from variables Railway sets at runtime:
 *   deploymentId — RAILWAY_DEPLOYMENT_ID, set for every deployment, `railway up` included;
 *   commit       — RAILWAY_GIT_COMMIT_SHA, which Railway sets ONLY for deploys triggered from GitHub.
 *                  A `railway up` deploy has no commit at runtime: null here, and the commit is found
 *                  by the deployment id in `railway deployment list --json` (the deploy plan attaches
 *                  the commit as the deployment message, `railway up -m`) — docs/deploy/runbook.md §8.
 * A value of the wrong shape is reported as null rather than echoed.
 */
function deployedVersion(env: NodeJS.ProcessEnv): { deploymentId: string | null; commit: string | null } {
  const deploymentId = env.RAILWAY_DEPLOYMENT_ID?.trim() ?? ''
  const commit = env.RAILWAY_GIT_COMMIT_SHA?.trim() ?? ''
  return {
    deploymentId: DEPLOYMENT_ID.test(deploymentId) ? deploymentId.toLowerCase() : null,
    commit: COMMIT_SHA.test(commit) ? commit.toLowerCase() : null,
  }
}

/**
 * GET /api/healthz — process liveness for the deploy health check (Railway).
 *
 * Deliberately independent of the database, Supabase and server configuration:
 * when the database stalls, /api/health answers 503 and a platform probe that
 * pointed at it would restart a perfectly healthy server in a loop. This route
 * only proves the process is up and serving requests; readiness of the
 * dependencies stays with /api/health. Middleware lets every /api/* path
 * through without auth, so no credentials are needed.
 *
 * It also says which deployment answers (deployedVersion above): two environment reads, no I/O, so
 * the answer stays instant. The post-deploy smoke (scripts/smoke/post-deploy.mjs) prints it.
 */
export async function GET() {
  return NextResponse.json(
    { ok: true, uptimeS: Math.round(process.uptime()), ...deployedVersion(process.env) },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  )
}
