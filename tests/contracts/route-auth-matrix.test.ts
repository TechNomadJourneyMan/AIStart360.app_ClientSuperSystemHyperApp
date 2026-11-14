/**
 * R-046 — route auth matrix.
 *
 * Every exported HTTP method of every app/api route must be described in
 * tests/contracts/route-auth.manifest.ts. A new route without an entry fails
 * CI, so "who may call this?" is decided at review time, not discovered in
 * production.
 *
 * Level 1: coverage — no missing and no stale entries; values are well-formed
 *          (known kinds, existing RBAC permissions, a reason for every public).
 * Level 2: evidence — for a declared kind the route file really calls a
 *          matching guard (protects against "declared in the manifest, but
 *          the check is missing"). Static and file-level: it proves the check
 *          exists in the file, not that every branch goes through it.
 * UNKNOWN entries are allowed but printed as a warning with a counter.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ALL_PERMISSIONS } from '@/lib/admin/rbac'
import { ROUTE_AUTH_MANIFEST, type HttpMethod, type RouteAccessKind } from './route-auth.manifest'

const ROOT = resolve(__dirname, '../..')
const API_DIR = join(ROOT, 'app', 'api')
const METHODS: HttpMethod[] = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']

function routeFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) routeFiles(p, out)
    else if (e.name === 'route.ts' || e.name === 'route.tsx' || e.name === 'route.js') out.push(p)
  }
  return out
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
}

/** HTTP methods a route module exports (functions, consts, `export { x as GET }`, re-exports). */
function exportedMethods(source: string): HttpMethod[] {
  const src = stripComments(source)
  const found = new Set<HttpMethod>()
  for (const m of METHODS) {
    if (new RegExp(`export\\s+(?:async\\s+)?function\\s*\\*?\\s*${m}\\b`).test(src)) found.add(m)
    if (new RegExp(`export\\s+(?:const|let|var)\\s+${m}\\b`).test(src)) found.add(m)
  }
  for (const block of src.matchAll(/export\s*(?:type\s*)?\{([^}]*)\}/g)) {
    if (/^\s*type\b/.test(block[0].slice(6))) continue
    for (const spec of block[1].split(',')) {
      const parts = spec.trim().split(/\s+as\s+/)
      const name = (parts[1] ?? parts[0]).trim() as HttpMethod
      if (METHODS.includes(name)) found.add(name)
    }
  }
  return METHODS.filter((m) => found.has(m))
}

function routeKey(file: string): string {
  const rel = relative(join(ROOT, 'app'), file).split(sep).join('/')
  return '/' + rel.replace(/\/route\.(ts|tsx|js)$/, '')
}

const files = routeFiles(API_DIR).sort()
const sources = new Map(files.map((f) => [routeKey(f), readFileSync(f, 'utf8')]))
const actual = new Map([...sources].map(([key, src]) => [key, exportedMethods(src)]))

function accessList(key: string, method: HttpMethod): RouteAccessKind[] {
  const v = ROUTE_AUTH_MANIFEST[key]?.[method]
  return v === undefined ? [] : Array.isArray(v) ? v : [v]
}

// ── Level 2: what counts as evidence of each kind in the route file ──────────
// Domain helpers that wrap a guard are listed next to the guard they call.
const STAFF_DIRECT = /\b(requireGiga|requireGigaClient|requireGigaCompany|requireGigaReport|guardComm|authorizeUserDataRead)\s*\(/
const STAFF_DELEGATED = /\b(guardPointAExpert|guardPlanRoute|resolveTokenManager|getGigaActor|isGigaSuperAdmin)\s*\(/
const EVIDENCE: Record<string, RegExp> = {
  session:
    /\.auth\.getUser\s*\(|\b(getSessionUser|getSessionUserId|authorizeClient|requireCrmOrg|resolveTenant\w*|handleDocumentFinalize|decideSuggestion|resolveJourneyActor|resolveTargetUserId|readImpersonation|endImpersonationInThisBrowser|liveFileAccessDeps|resolveCallerContext|sessionUser)\s*\(|from '@\/lib\/point-b\/whatif-http'/,
  expert: /\b(resolveExpert|requireExpert|resolveExpertBotUser|authorizeUserDataRead|resolveTokenManager)\s*\(/,
  cron: /\b(isAuthorizedCron|rejectUnauthorizedCron|isBearerAuthorized)\s*\(/,
  'internal-token': /\b(hasValidInternalToken|verifyInternalToken)\s*\(/,
  'webhook-signature':
    /\bprocessWebhook\s*\(|x-telegram-bot-api-secret-token|x-hub-signature|\bverify\w*(Signature|Request)\w*\s*\(|\bverifySigned\w*\s*\(|hub\.verify_token|timingSafeEqual/i,
  'bearer-token': /\b(handleMcpPost|authenticateMcp|isAuthorized\w*Bearer)\s*\(/,
  'dev-only': /\b(devAccessEnabledForRequest|devNotFound)\b/,
}

function kindOf(a: RouteAccessKind): string {
  return a.includes(':') ? a.slice(0, a.indexOf(':')) : a
}

describe('route auth matrix (R-046)', () => {
  it('finds the API routes', () => {
    expect(files.length).toBeGreaterThan(300)
  })

  it('every exported method of every app/api route has a manifest entry', () => {
    const missing: string[] = []
    for (const [key, methods] of actual) {
      for (const m of methods) if (!accessList(key, m).length) missing.push(`${key} ${m}`)
    }
    expect(
      missing,
      `Маршруты без описанного доступа — добавьте строку в tests/contracts/route-auth.manifest.ts ` +
        `(session / staff:<perm> / expert / cron / webhook-signature / internal-token / bearer-token / dev-only / public:<why>):\n  ` +
        missing.join('\n  '),
    ).toEqual([])
  })

  it('has no stale entries (route or method gone)', () => {
    const stale: string[] = []
    for (const [key, entry] of Object.entries(ROUTE_AUTH_MANIFEST)) {
      const methods = actual.get(key)
      if (!methods) {
        stale.push(`${key} (no route)`)
        continue
      }
      for (const m of Object.keys(entry) as HttpMethod[]) if (!methods.includes(m)) stale.push(`${key} ${m}`)
    }
    expect(stale, `Устаревшие записи манифеста:\n  ${stale.join('\n  ')}`).toEqual([])
  })

  it('every entry is well-formed', () => {
    const known = new Set<string>(ALL_PERMISSIONS)
    const bad: string[] = []
    for (const [key, entry] of Object.entries(ROUTE_AUTH_MANIFEST)) {
      for (const m of Object.keys(entry) as HttpMethod[]) {
        const list = accessList(key, m)
        if (!list.length) bad.push(`${key} ${m}: empty`)
        for (const a of list) {
          const kind = kindOf(a)
          if (kind === 'public' || kind === 'UNKNOWN') {
            if (a.slice(kind.length + 1).trim().length < 8) bad.push(`${key} ${m}: ${kind} needs a reason`)
          } else if (kind === 'staff') {
            const perms = a.slice(6)
            if (perms === 'profile-role' || perms === '*') continue
            for (const p of perms.split(',')) if (!known.has(p.trim())) bad.push(`${key} ${m}: unknown permission ${p}`)
          } else if (!(kind in EVIDENCE)) {
            bad.push(`${key} ${m}: unknown access kind ${a}`)
          }
        }
      }
    }
    expect(bad).toEqual([])
  })

  it('the declared check really exists in the route file (level 2)', () => {
    const problems: string[] = []
    for (const [key, entry] of Object.entries(ROUTE_AUTH_MANIFEST)) {
      const raw = sources.get(key)
      if (!raw) continue
      const src = stripComments(raw)
      for (const m of Object.keys(entry) as HttpMethod[]) {
        for (const a of accessList(key, m)) {
          const kind = kindOf(a)
          if (kind === 'public' || kind === 'UNKNOWN') continue
          if (kind === 'staff') {
            const perms = a.slice(6)
            if (perms === 'profile-role') {
              if (!/\b(isStaffRole|getSessionStaff)\s*\(/.test(src)) problems.push(`${key} ${m}: ${a} but no isStaffRole() / getSessionStaff()`)
              continue
            }
            const direct = STAFF_DIRECT.test(src)
            if (!direct && !STAFF_DELEGATED.test(src)) {
              problems.push(`${key} ${m}: ${a} but no requireGiga*/guardComm/… call`)
              continue
            }
            if (direct && perms !== '*') {
              for (const p of perms.split(',')) {
                if (!src.includes(`'${p.trim()}'`)) problems.push(`${key} ${m}: ${a} but '${p.trim()}' is not checked in the file`)
              }
            }
            continue
          }
          if (!EVIDENCE[kind].test(src)) problems.push(`${key} ${m}: declared ${a}, no matching guard in the file`)
        }
      }
    }
    expect(problems, `Заявленная в манифесте проверка не найдена в файле:\n  ${problems.join('\n  ')}`).toEqual([])
  })

  it('reports UNKNOWN entries (warning, not a failure)', () => {
    const unknown: string[] = []
    let total = 0
    let publicCount = 0
    for (const [key, entry] of Object.entries(ROUTE_AUTH_MANIFEST)) {
      for (const m of Object.keys(entry) as HttpMethod[]) {
        total++
        const list = accessList(key, m)
        if (list.some((a) => a.startsWith('UNKNOWN:'))) unknown.push(`${key} ${m}`)
        if (list.every((a) => a.startsWith('public:'))) publicCount++
      }
    }
    if (unknown.length) {
      console.warn(`[route-auth] UNKNOWN: ${unknown.length} of ${total} methods — ${unknown.join(', ')}`)
    }
    expect(publicCount).toBeLessThan(total)
  })

  it('exportedMethods understands the export forms used by routes', () => {
    expect(exportedMethods('export async function GET() {}\nexport const POST = handler')).toEqual(['GET', 'POST'])
    expect(exportedMethods("export { devNotFound as GET, devNotFound as PUT }\nexport async function POST() {}")).toEqual(['GET', 'POST', 'PUT'])
    expect(exportedMethods("export { GET, POST } from './shared'")).toEqual(['GET', 'POST'])
    expect(exportedMethods('// export async function DELETE() {}\nexport const dynamic = "force-dynamic"')).toEqual([])
  })
})
