/**
 * Widens the `diagnostics_ai_status_check` constraint so it accepts BOTH
 * vocabularies in play.
 *
 * The live database only allows 'not_requested' | 'pending' | 'completed' |
 * 'fallback' | 'error', while this repository's code writes 'none' |
 * 'processing' | 'completed' | 'failed'. Every Point A recalculation therefore
 * fails with 23514 before it can be stored — for every client, not just the
 * demo one.
 *
 * Widening (rather than replacing) is deliberate: the deployed production build
 * comes from a different branch and may still write the old values, so dropping
 * them would break the live site. This only ADDS accepted values.
 *
 *   node scripts/fix-ai-status-constraint.mjs            # inspect only
 *   node scripts/fix-ai-status-constraint.mjs --apply    # apply
 *   node scripts/fix-ai-status-constraint.mjs --rollback # restore the old check
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const ROLLBACK = args.includes('--rollback')

function envValue(key) {
  for (const file of ['.env.local', '.env']) {
    let raw
    try {
      raw = readFileSync(resolve(ROOT, file), 'utf8')
    } catch {
      continue
    }
    const m = raw.match(new RegExp(`^${key}=(.*)$`, 'm'))
    if (m) return m[1].trim().replace(/^["']|["']$/g, '')
  }
  return ''
}

const CONSTRAINT = 'diagnostics_ai_status_check'
const UNION_VALUES = [
  'none',
  'processing',
  'completed',
  'failed',
  'not_requested',
  'pending',
  'fallback',
  'error',
]
const LEGACY_VALUES = ['not_requested', 'pending', 'completed', 'fallback', 'error']

const url = envValue('DATABASE_URL')
if (!url) {
  console.error('DATABASE_URL не найден в .env')
  process.exit(1)
}

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await client.connect()

async function showConstraint(label) {
  const { rows } = await client.query(
    `SELECT pg_get_constraintdef(oid) AS def
       FROM pg_constraint
      WHERE conname = $1
        AND conrelid = 'public.diagnostics'::regclass`,
    [CONSTRAINT],
  )
  console.log(`${label}: ${rows[0]?.def ?? '(ограничения нет)'}`)
  return rows[0]?.def ?? null
}

function buildCheck(values) {
  const list = values.map((v) => `'${v}'`).join(', ')
  return `CHECK (ai_status IN (${list}))`
}

try {
  console.log(`база : ${new URL(url).hostname}`)
  const before = await showConstraint('ДО  ')

  const { rows: counts } = await client.query(
    `SELECT ai_status, count(*)::int AS n FROM public.diagnostics GROUP BY 1 ORDER BY 2 DESC`,
  )
  console.log(
    `строк в diagnostics: ${counts.reduce((s, r) => s + r.n, 0)} — ${
      counts.map((r) => `${r.ai_status}:${r.n}`).join(', ') || 'таблица пуста'
    }`,
  )

  if (!APPLY && !ROLLBACK) {
    console.log('\nсухой прогон. --apply чтобы расширить, --rollback чтобы вернуть прежнее.')
    process.exit(0)
  }

  const target = ROLLBACK ? LEGACY_VALUES : UNION_VALUES
  await client.query('BEGIN')
  await client.query(`ALTER TABLE public.diagnostics DROP CONSTRAINT IF EXISTS ${CONSTRAINT}`)
  await client.query(`ALTER TABLE public.diagnostics ADD CONSTRAINT ${CONSTRAINT} ${buildCheck(target)}`)
  await client.query('COMMIT')

  const after = await showConstraint('ПОСЛЕ')
  if (before === after) console.log('внимание: определение не изменилось')
} catch (e) {
  await client.query('ROLLBACK').catch(() => {})
  console.error('ошибка, изменения откачены:', e.message)
  process.exitCode = 1
} finally {
  await client.end()
}
