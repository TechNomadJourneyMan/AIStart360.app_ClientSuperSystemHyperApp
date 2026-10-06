/**
 * Migration 092: the second-factor flags move to app_metadata (not editable by
 * the account holder), backfilled from the real enrolment state. Re-applies
 * the migration inside a rolled-back transaction.
 */
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { dbTestsEnabled } from '../../helpers/db-env'
import { closeTestPool, inRollback } from '../../helpers/pg-rls'
import { mfaFlagsEnrolled } from '@/lib/mfa/flags'

const SQL = readFileSync('supabase/migrations/092_mfa_flags_app_metadata.sql', 'utf8')

describe.skipIf(!dbTestsEnabled)('092 mfa flags in app_metadata', () => {
  afterAll(closeTestPool)

  it('backfills TOTP and passkey users, leaves others alone, and is idempotent', async () => {
    await inRollback(async (db) => {
      const [totp, passkey, none] = [randomUUID(), randomUUID(), randomUUID()]
      for (const id of [totp, passkey, none]) {
        // A user who tried to switch the gate off in their own metadata.
        await db.query(`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, '{"mfa_totp": false}'::jsonb)`, [id, `${id}@t.local`])
      }
      await db.query(`INSERT INTO public.user_security (user_id, totp_enabled) VALUES ($1, true)`, [totp])
      await db.query(`INSERT INTO public.webauthn_credentials (id, user_id, public_key) VALUES ($1, $2, 'pk')`, [`cred-${passkey}`, passkey])

      await db.query(SQL)
      await db.query(SQL)

      const { rows } = await db.query<{ id: string; app: Record<string, unknown>; usr: Record<string, unknown> }>(
        `SELECT id, raw_app_meta_data AS app, raw_user_meta_data AS usr FROM auth.users WHERE id = ANY($1::uuid[])`,
        [[totp, passkey, none]],
      )
      const by = Object.fromEntries(rows.map((r) => [r.id, r]))
      expect(by[totp].app).toMatchObject({ mfa_totp: true })
      expect(by[passkey].app).toMatchObject({ mfa_webauthn: true })
      expect(by[none].app?.mfa_totp).toBeUndefined()
      // The gate reads app_metadata OR user_metadata: the user's own `false` cannot switch it off.
      expect(mfaFlagsEnrolled({ app_metadata: by[totp].app, user_metadata: by[totp].usr })).toBe(true)
      expect(mfaFlagsEnrolled({ app_metadata: by[none].app, user_metadata: by[none].usr })).toBe(false)
    })
  })
})
