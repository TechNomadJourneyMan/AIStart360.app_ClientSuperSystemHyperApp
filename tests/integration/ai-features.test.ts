// ============================================================
// tests/integration/ai-features.test.ts
// Verifies the AI-1 migrations (045–049) against real Supabase:
//   ai_conversations / ai_messages, nba_log, user_consents,
//   founder_psych_profiles, action_items (new columns) and the
//   match_user_document_chunks RPC (046).
// Seeds an ephemeral auth user + profile and cleans up after.
// Skipped when SUPABASE creds are absent (keeps CI green).
// ============================================================

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function loadEnvFile(file: string) {
  if (!existsSync(file)) return
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)
    if (!m) continue
    let val = m[2].trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1)
    if (process.env[m[1]] === undefined) process.env[m[1]] = val
  }
}
loadEnvFile(resolve(process.cwd(), '.env.local'))
loadEnvFile(resolve(process.cwd(), '.env'))

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const SKIP = !SUPABASE_URL || !SERVICE_ROLE_KEY

const describeOrSkip =
  typeof (describe as unknown as { skipIf?: unknown }).skipIf === 'function'
    ? (describe as unknown as { skipIf: (c: boolean) => typeof describe }).skipIf(SKIP)
    : SKIP
      ? describe.skip
      : describe

describeOrSkip('AI-1 migrations integration (real Supabase)', () => {
  let sb: SupabaseClient
  let userId: string

  beforeAll(async () => {
    sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
    const tag = randomUUID()
    const created = await sb.auth.admin.createUser({
      email: `ai1-test-${tag}@aistart360.test`,
      password: `Pw_${tag}`,
      email_confirm: true,
      user_metadata: { full_name: `AI1_TEST_${tag}` },
    })
    if (created.error || !created.data.user) throw new Error(`createUser: ${created.error?.message}`)
    userId = created.data.user.id

    const { data: prof } = await sb.from('profiles').select('id').eq('id', userId).maybeSingle()
    if (!prof) {
      const { error } = await sb.from('profiles').insert({ id: userId, email: `ai1-test-${tag}@aistart360.test`, role: 'client', status: 'approved' })
      if (error) throw new Error(`profile insert: ${error.message}`)
    }
  }, 30_000)

  afterAll(async () => {
    if (sb && userId) await sb.auth.admin.deleteUser(userId).catch(() => {})
  })

  it('ai_conversations + ai_messages: insert, read back, cascade delete', async () => {
    const { data: conv, error: cErr } = await sb
      .from('ai_conversations')
      .insert({ user_id: userId, surface: 'report', persona_id: 'growth_strategist', title: 'Тест' })
      .select('id')
      .single()
    expect(cErr).toBeNull()
    const convId = conv!.id

    const { error: mErr } = await sb.from('ai_messages').insert([
      { conversation_id: convId, role: 'user', content: 'Вопрос?' },
      { conversation_id: convId, role: 'assistant', content: 'Ответ.', grounding: [{ ref: 'gri_top5:0' }], validation: { status: 'approved', risk_level: 'low' } },
    ])
    expect(mErr).toBeNull()

    const { data: msgs } = await sb.from('ai_messages').select('role, content').eq('conversation_id', convId).order('created_at', { ascending: true })
    expect(msgs).toHaveLength(2)
    expect(msgs![0].role).toBe('user')

    await sb.from('ai_conversations').delete().eq('id', convId)
    const { data: after } = await sb.from('ai_messages').select('id').eq('conversation_id', convId)
    expect(after ?? []).toHaveLength(0) // cascade removed the messages
  })

  it('nba_log: records events', async () => {
    const { error } = await sb.from('nba_log').insert([
      { user_id: userId, action_key: 'gri_limit:main', event: 'shown', payload: { score: 80 } },
      { user_id: userId, action_key: 'gri_limit:main', event: 'dismissed' },
    ])
    expect(error).toBeNull()
    const { data } = await sb.from('nba_log').select('event').eq('user_id', userId)
    expect((data ?? []).map((r) => r.event).sort()).toEqual(['dismissed', 'shown'])
  })

  it('user_consents: upsert grant then revoke', async () => {
    await sb.from('user_consents').upsert({ user_id: userId, kind: 'psych_profile', granted: true, granted_at: new Date().toISOString() }, { onConflict: 'user_id,kind' })
    await sb.from('user_consents').upsert({ user_id: userId, kind: 'psych_profile', granted: false, revoked_at: new Date().toISOString() }, { onConflict: 'user_id,kind' })
    const { data } = await sb.from('user_consents').select('granted').eq('user_id', userId).eq('kind', 'psych_profile').single()
    expect(data!.granted).toBe(false)
  })

  it('founder_psych_profiles: stores the result json', async () => {
    const { error } = await sb.from('founder_psych_profiles').upsert({
      user_id: userId, version: 1, answers: { s10_hours_on_ops: 60 }, result: { archetype: { id: 'firefighter' } },
    })
    expect(error).toBeNull()
    const { data } = await sb.from('founder_psych_profiles').select('result').eq('user_id', userId).single()
    expect((data!.result as { archetype: { id: string } }).archetype.id).toBe('firefighter')
  })

  it('action_items: accepts the new interactive columns (049)', async () => {
    const { data, error } = await sb.from('action_items').insert({
      user_id: userId, title: 'Позвонить лидам', status: 'done',
      source: 'bet', week_no: 2, completed_at: new Date().toISOString(),
    }).select('id, source, week_no').single()
    expect(error).toBeNull()
    expect(data!.source).toBe('bet')
    expect(data!.week_no).toBe(2)
    await sb.from('action_items').delete().eq('id', data!.id)
  })

  it('match_user_document_chunks RPC exists and returns no rows for a doc-less user', async () => {
    const vec = `[${Array(1536).fill(0).join(',')}]`
    const { data, error } = await sb.rpc('match_user_document_chunks', { p_user_id: userId, p_query: vec, p_limit: 6, p_min_similarity: 0.25 })
    // The function must exist (no "does not exist"); an empty result is expected.
    expect(error?.message ?? '').not.toContain('does not exist')
    if (!error) expect(data ?? []).toHaveLength(0)
  })
})
