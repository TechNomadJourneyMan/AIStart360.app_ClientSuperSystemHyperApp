// Apply a Supabase migration file via DIRECT_URL.
// Usage: node scripts/apply-migration.js <migration_file>
// Loads env from .env.local then .env.
//
// Why a one-shot script: this repo has no `supabase` CLI and migrations
// live as plain SQL in supabase/migrations/. We run them as a single
// multi-statement query through pg's simple-query protocol so DO $$...$$
// blocks survive intact.

const { Client } = require('pg')
const fs = require('fs')
const path = require('path')

function loadEnv(file) {
  if (!fs.existsSync(file)) return
  const content = fs.readFileSync(file, 'utf8')
  for (const line of content.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)
    if (!m) continue
    let val = m[2].trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = val
  }
}

async function main() {
  loadEnv(path.resolve(__dirname, '..', '.env.local'))
  loadEnv(path.resolve(__dirname, '..', '.env'))

  const file = process.argv[2]
  if (!file) {
    console.error('Usage: node scripts/apply-migration.js <migration_file>')
    process.exit(1)
  }

  const absPath = path.isAbsolute(file) ? file : path.resolve(process.cwd(), file)
  if (!fs.existsSync(absPath)) {
    console.error(`Migration file not found: ${absPath}`)
    process.exit(1)
  }

  const rawConnectionString = process.env.DIRECT_URL || process.env.DATABASE_URL
  if (!rawConnectionString) {
    console.error('Neither DIRECT_URL nor DATABASE_URL is set.')
    process.exit(1)
  }
  // Vercel may preserve a trailing escaped newline when a secret was added
  // from stdin. Strip only that transport artifact before handing the URL to
  // node-postgres; never log the unmasked value.
  const connectionString = rawConnectionString.replace(/\\n$/g, '').trim()

  const client = new Client({ connectionString })
  await client.connect()
  console.log(`✓ Connected to Postgres (${connectionString.replace(/:[^:@]+@/, ':***@')})`)
  console.log(`→ Applying ${path.basename(absPath)}`)

  const sql = fs.readFileSync(absPath, 'utf8')
  try {
    await client.query(sql)
    console.log(`✓ Migration applied successfully`)
  } catch (err) {
    console.error(`✗ Migration failed: ${err.message}`)
    if (err.position) console.error(`  at position ${err.position}`)
    if (err.detail) console.error(`  detail: ${err.detail}`)
    if (err.hint) console.error(`  hint: ${err.hint}`)
    process.exitCode = 1
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
