/**
 * Encrypt CRM access tokens that were stored before encryption existed.
 *
 *   SECRETS_ENCRYPTION_KEY=… DIRECT_URL=… npx tsx scripts/encrypt-crm-tokens.ts          # dry run
 *   SECRETS_ENCRYPTION_KEY=… DIRECT_URL=… npx tsx scripts/encrypt-crm-tokens.ts --apply  # write
 *
 * Idempotent: rows already in the "v1:" format are skipped. Each row is
 * verified (decrypt == original) before it is written. Tokens are never printed.
 */
import { Client } from 'pg'
import { decryptSecret, encryptSecret, isEncryptionConfigured } from '../lib/crypto/secrets'

async function main() {
  const apply = process.argv.includes('--apply')
  if (!isEncryptionConfigured()) {
    console.error('SECRETS_ENCRYPTION_KEY is missing or not 32 bytes')
    process.exit(1)
  }
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL
  if (!url) {
    console.error('DIRECT_URL or DATABASE_URL is required')
    process.exit(1)
  }
  const client = new Client({ connectionString: url })
  await client.connect()
  try {
    const { rows } = await client.query<{ id: string; access_token: string }>(
      `SELECT id, access_token FROM public.crm_provider_connections WHERE access_token NOT LIKE 'v1:%'`,
    )
    console.log(`${rows.length} plaintext token(s) found${apply ? '' : ' (dry run, use --apply to encrypt)'}`)
    let done = 0
    for (const r of rows) {
      const sealed = encryptSecret(r.access_token)
      if (decryptSecret(sealed) !== r.access_token) throw new Error(`round-trip check failed for ${r.id}`)
      if (apply) {
        await client.query(
          `UPDATE public.crm_provider_connections SET access_token = $2, updated_at = now() WHERE id = $1 AND access_token = $3`,
          [r.id, sealed, r.access_token],
        )
        done += 1
      }
    }
    if (apply) console.log(`encrypted ${done} token(s)`)
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
