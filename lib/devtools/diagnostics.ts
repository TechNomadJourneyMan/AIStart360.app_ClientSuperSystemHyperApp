/**
 * lib/devtools/diagnostics.ts — чистые части вкладки «Диагностика» Dev-tools.
 * Значения секретов никогда не возвращаются — только сам факт настройки
 * (это делает lib/admin/system-health.ts envChecks()).
 */

export interface BuildInfo {
  vercelEnv: string | null
  nodeEnv: string | null
  commitSha: string | null
  commitShort: string | null
  commitRef: string | null
  commitMessage: string | null
  region: string | null
  deploymentUrl: string | null
  deploymentId: string | null
  node: string
}

type Env = Record<string, string | undefined>

export function buildInfo(env: Env = process.env, node = process.version): BuildInfo {
  const sha = env.VERCEL_GIT_COMMIT_SHA || null
  const msg = env.VERCEL_GIT_COMMIT_MESSAGE ? env.VERCEL_GIT_COMMIT_MESSAGE.split('\n')[0].slice(0, 160) : null
  return {
    vercelEnv: env.VERCEL_ENV || null,
    nodeEnv: env.NODE_ENV || null,
    commitSha: sha,
    commitShort: sha ? sha.slice(0, 7) : null,
    commitRef: env.VERCEL_GIT_COMMIT_REF || null,
    commitMessage: msg,
    region: env.VERCEL_REGION || null,
    deploymentUrl: env.VERCEL_URL || null,
    deploymentId: env.VERCEL_DEPLOYMENT_ID || null,
    node,
  }
}

export const DEVTOOLS_MIGRATION_FILE = '120_content_filter_devtools.sql'

export interface MigrationRow { file: string; applied_at: string | null; applied_by?: string | null }

/**
 * Применена ли миграция 120: запись в журнале schema_migrations ИЛИ уже
 * существующая колонка profiles.is_test (миграцию могли применить вручную).
 */
export function migration120Status(ledgerHas120: boolean | null, columnReady: boolean | null): 'applied' | 'missing' | 'unknown' {
  if (ledgerHas120 || columnReady) return 'applied'
  if (ledgerHas120 === false && columnReady === false) return 'missing'
  return 'unknown'
}
