import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'node:path'
import {
  syncSurveyAnswersToGoogleSheet,
  type SurveySheetRow,
} from '@/lib/google-sheets/survey-sync'

config({ path: resolve(process.cwd(), '.env.local'), override: false, quiet: true })
config({ path: resolve(process.cwd(), '.env'), override: false, quiet: true })

const PAGE_SIZE = 500
const SYNC_BATCH_SIZE = 200

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

async function main(): Promise<void> {
  const configuration = await syncSurveyAnswersToGoogleSheet([])
  if (configuration.status === 'skipped') {
    throw new Error(
      configuration.reason === 'disabled'
        ? 'Google Sheets sync is disabled by GOOGLE_SHEETS_SYNC_ENABLED=false'
        : 'Google Sheets service-account credentials are not configured',
    )
  }

  const sb = createClient(
    requiredEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  )

  let offset = 0
  let read = 0
  let synced = 0

  while (true) {
    const { data, error } = await sb
      .from('survey_answers')
      .select('user_id,company_id,step,question_key,answer,answered_at')
      .order('user_id', { ascending: true })
      .order('question_key', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)

    if (error) throw new Error(`Failed to read survey answers: ${error.message}`)
    const rows = data ?? []
    if (rows.length === 0) break
    read += rows.length

    const projected: SurveySheetRow[] = rows.map((row) => ({
      userId: String(row.user_id),
      companyId: row.company_id == null ? null : String(row.company_id),
      step: Number(row.step),
      questionKey: String(row.question_key),
      answer: row.answer,
      answeredAt: String(row.answered_at),
    }))

    for (let index = 0; index < projected.length; index += SYNC_BATCH_SIZE) {
      const batch = projected.slice(index, index + SYNC_BATCH_SIZE)
      const result = await syncSurveyAnswersToGoogleSheet(batch)
      if (result.status !== 'synced') {
        throw new Error(`Google Sheets sync stopped: ${result.reason}`)
      }
      synced += result.synced
      process.stdout.write(`\rGoogle Sheets backfill: ${synced}/${read}`)
    }

    if (rows.length < PAGE_SIZE) break
    offset += rows.length
  }

  process.stdout.write('\n')
  console.log(`Google Sheets backfill completed: ${synced} survey rows synced`)
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : 'Google Sheets backfill failed',
  )
  process.exitCode = 1
})
