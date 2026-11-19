/**
 * R-045: RLS of the 17 tables of migrations 110–139 that had no test, on the real policies of the
 * disposable test DB — what PostgREST returns to a session that reads or writes the table straight
 * with its JWT (tests/helpers/pg-rls.ts asUser). Per table, the migration's intent:
 *
 *   comm_threads, comm_messages (120)         the client reads his own conversation only; staff work in
 *                                             «Сообщения» through the service role (no staff policy);
 *                                             anon has no grant; nobody writes through the API roles
 *   comm_campaigns, comm_campaign_recipients,
 *   kb_articles (120)                         service role only: no grant to anon or authenticated
 *   metric_facts, data_discrepancies,
 *   metric_overrides (110)                    read by tenant (can_read_company: the owner, members,
 *                                             staff by scope); 147 leaves data_discrepancies out of the
 *                                             paid gate on purpose; written by the service role only
 *   ai_pending_actions (116, 138)             the user who got the proposal, nobody else (staff neither)
 *   pa_company_config (111)                   read by tenant
 *   pa_templates (111)                        any signed-in user reads (block templates); anon nothing
 *   point_a_comments,
 *   point_a_hypothesis_reviews (117, 147)     read by tenant, deleted comments never, and only with the
 *                                             paid section «Точка А» (RESTRICTIVE, 147)
 *   point_a_recalc_queue (111)                no policy: service role only (0 rows for the API roles)
 *   omnichannel_telegram_bots (124),
 *   whatsapp_bridge_status / _commands (123)  service role only: no grant to anon or authenticated
 *
 * -1 = the read is refused with 42501 (no grant), never an empty answer by accident.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { dbTestsEnabled } from '../../helpers/db-env'
import { asUser, closeTestPool, inRollback, seedCompany, seedStaff, seedUser, type Db } from '../../helpers/pg-rls'

const TABLES = [
  'comm_threads', 'comm_messages', 'comm_campaigns', 'comm_campaign_recipients', 'kb_articles',
  'metric_facts', 'data_discrepancies', 'metric_overrides', 'ai_pending_actions',
  'pa_company_config', 'pa_templates', 'point_a_comments', 'point_a_hypothesis_reviews', 'point_a_recalc_queue',
  'omnichannel_telegram_bots', 'whatsapp_bridge_status', 'whatsapp_bridge_commands',
] as const
type Table = (typeof TABLES)[number]
type Seen = Record<Table, number>

/** A column each table has, for an UPDATE that changes nothing (the privilege is what is tested). */
const UPDATE_COLUMN: Record<Table, string> = {
  comm_threads: 'status', comm_messages: 'status', comm_campaigns: 'status', comm_campaign_recipients: 'status',
  kb_articles: 'status', metric_facts: 'note', data_discrepancies: 'status', metric_overrides: 'note',
  ai_pending_actions: 'status', pa_company_config: 'version', pa_templates: 'version', point_a_comments: 'body',
  point_a_hypothesis_reviews: 'rationale', point_a_recalc_queue: 'attempts', omnichannel_telegram_bots: 'status',
  whatsapp_bridge_status: 'state', whatsapp_bridge_commands: 'status',
}

const SESSION = 'rls-test-session'
const TEMPLATE = 'rls_test_template'

interface World {
  owner: string
  company: string
  other: string
  otherCompany: string
  ownerThread: string
  campaign: string
  kb: string[]
}

async function seedTenant(db: Db, user: string, company: string): Promise<string> {
  const thread = (await db.query(`INSERT INTO public.comm_threads (user_id, company_id) VALUES ($1, $2) RETURNING id`, [user, company])).rows[0].id as string
  await db.query(
    `INSERT INTO public.comm_messages (thread_id, direction, channel, author_kind, body) VALUES ($1, 'out', 'app', 'staff', 'Здравствуйте')`,
    [thread],
  )
  await db.query(
    `INSERT INTO public.metric_facts (company_id, metric_key, period_key, value, source_kind, source_ref) VALUES ($1, 'biz.finansy.vyruchka_god', '2026', 1000, 'survey', 'q1')`,
    [company],
  )
  await db.query(`INSERT INTO public.data_discrepancies (company_id, metric_key, period_key, kind) VALUES ($1, 'biz.finansy.vyruchka_god', '2026', 'conflict')`, [company])
  await db.query(`INSERT INTO public.metric_overrides (company_id, metric_key, period_key, value) VALUES ($1, 'biz.finansy.vyruchka_god', '2026', 1200)`, [company])
  await db.query(
    `INSERT INTO public.ai_pending_actions (user_id, company_id, kind, payload, preview) VALUES ($1, $2, 'set_value', '{}'::jsonb, '{"title":"Выручка"}'::jsonb)`,
    [user, company],
  )
  await db.query(`INSERT INTO public.pa_company_config (company_id) VALUES ($1)`, [company])
  await db.query(
    `INSERT INTO public.point_a_comments (company_id, target_kind, body) VALUES ($1, 'overall', 'Комментарий эксперта'), ($1, 'overall', 'Удалённый')`,
    [company],
  )
  await db.query(`UPDATE public.point_a_comments SET deleted_at = now() WHERE company_id = $1 AND body = 'Удалённый'`, [company])
  await db.query(`INSERT INTO public.point_a_hypothesis_reviews (company_id, block_key, inputs_hash, decision) VALUES ($1, 'finance', 'h1', 'rejected')`, [company])
  await db.query(`INSERT INTO public.point_a_recalc_queue (company_id) VALUES ($1)`, [company])
  return thread
}

async function world(db: Db): Promise<World> {
  await db.query(
    `INSERT INTO public.system_settings (key, value) VALUES ('access_gates', 'true'::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
  )
  const owner = await seedUser(db, { status: 'approved' })
  const other = await seedUser(db, { status: 'approved' })
  await db.query(`UPDATE public.profiles SET tier = 'pro' WHERE id = ANY($1)`, [[owner, other]])
  const company = await seedCompany(db, owner, 'Ромашка')
  const otherCompany = await seedCompany(db, other, 'Лютик')
  const ownerThread = await seedTenant(db, owner, company)
  await seedTenant(db, other, otherCompany)

  const campaign = (await db.query(`INSERT INTO public.comm_campaigns (title, body) VALUES ('Рассылка', 'Текст') RETURNING id`)).rows[0].id as string
  await db.query(`INSERT INTO public.comm_campaign_recipients (campaign_id, user_id, channel) VALUES ($1, $2, 'app')`, [campaign, owner])
  const kb = (await db.query(
    `INSERT INTO public.kb_articles (title, body, status) VALUES ('Опубликованная', 'Текст', 'published'), ('Черновик', 'Текст', 'draft') RETURNING id`,
  )).rows.map((r) => r.id as string)
  await db.query(`INSERT INTO public.pa_templates (key, title, blocks) VALUES ($1, 'Тестовый шаблон', '[]'::jsonb)`, [TEMPLATE])
  // One business bot per inbox (unique on TRUE): only when the test database has none.
  await db.query(
    `INSERT INTO public.omnichannel_telegram_bots (bot_id, bot_username, token_ciphertext, webhook_secret_hash)
     SELECT '1234567', 'rls_test_bot', 'v1:cipher', repeat('a', 64)
     WHERE NOT EXISTS (SELECT 1 FROM public.omnichannel_telegram_bots)`,
  )
  await db.query(`INSERT INTO public.whatsapp_bridge_status (session_id, state) VALUES ($1, 'disconnected') ON CONFLICT (session_id) DO NOTHING`, [SESSION])
  await db.query(
    `INSERT INTO public.whatsapp_bridge_commands (session_id, action, idempotency_key, expires_at) VALUES ($1, 'connect', 'rls-test-key-0001', now() + interval '2 minutes')`,
    [SESSION],
  )
  return { owner, company, other, otherCompany, ownerThread, campaign, kb }
}

/** The Postgres code a statement is refused with (null = it ran), inside its own savepoint. */
async function codeOf(db: Db, sql: string, args: unknown[] = []): Promise<string | null> {
  await db.query('SAVEPOINT rls_try')
  try {
    await db.query(sql, args)
    await db.query('RELEASE SAVEPOINT rls_try')
    return null
  } catch (err) {
    await db.query('ROLLBACK TO SAVEPOINT rls_try')
    return (err as { code?: string }).code ?? 'unknown'
  }
}

/** A count, or -1 when the read is refused with 42501 (inside its own savepoint). */
async function count(db: Db, sql: string, args: unknown[]): Promise<number> {
  await db.query('SAVEPOINT rls_read')
  try {
    const n = Number((await db.query(sql, args)).rows[0].n)
    await db.query('RELEASE SAVEPOINT rls_read')
    return n
  } catch (err) {
    await db.query('ROLLBACK TO SAVEPOINT rls_read')
    if ((err as { code?: string }).code !== '42501') throw err
    return -1
  }
}

/** The OWNER's rows (or this test's rows of the global tables) that `uid` (null = anon) reads. */
async function seen(db: Db, uid: string | null, w: World): Promise<Seen> {
  return asUser(db, uid, async () => {
    const byCompany = (t: string) => count(db, `SELECT count(*) AS n FROM public.${t} WHERE company_id = $1`, [w.company])
    return {
      comm_threads: await count(db, `SELECT count(*) AS n FROM public.comm_threads WHERE user_id = $1`, [w.owner]),
      comm_messages: await count(db, `SELECT count(*) AS n FROM public.comm_messages WHERE thread_id = $1`, [w.ownerThread]),
      comm_campaigns: await count(db, `SELECT count(*) AS n FROM public.comm_campaigns WHERE id = $1`, [w.campaign]),
      comm_campaign_recipients: await count(db, `SELECT count(*) AS n FROM public.comm_campaign_recipients WHERE campaign_id = $1`, [w.campaign]),
      kb_articles: await count(db, `SELECT count(*) AS n FROM public.kb_articles WHERE id = ANY($1)`, [w.kb]),
      metric_facts: await byCompany('metric_facts'),
      data_discrepancies: await byCompany('data_discrepancies'),
      metric_overrides: await byCompany('metric_overrides'),
      ai_pending_actions: await count(db, `SELECT count(*) AS n FROM public.ai_pending_actions WHERE user_id = $1`, [w.owner]),
      pa_company_config: await byCompany('pa_company_config'),
      pa_templates: await count(db, `SELECT count(*) AS n FROM public.pa_templates WHERE key = $1`, [TEMPLATE]),
      point_a_comments: await byCompany('point_a_comments'),
      point_a_hypothesis_reviews: await byCompany('point_a_hypothesis_reviews'),
      point_a_recalc_queue: await byCompany('point_a_recalc_queue'),
      omnichannel_telegram_bots: await count(db, `SELECT count(*) AS n FROM public.omnichannel_telegram_bots`, []),
      whatsapp_bridge_status: await count(db, `SELECT count(*) AS n FROM public.whatsapp_bridge_status WHERE session_id = $1`, [SESSION]),
      whatsapp_bridge_commands: await count(db, `SELECT count(*) AS n FROM public.whatsapp_bridge_commands WHERE session_id = $1`, [SESSION]),
    }
  })
}

/** Service-role-only tables: refused to every API role. */
const SERVICE_ONLY = {
  comm_campaigns: -1, comm_campaign_recipients: -1, kb_articles: -1,
  omnichannel_telegram_bots: -1, whatsapp_bridge_status: -1, whatsapp_bridge_commands: -1,
} as const
const TENANT_TABLES = ['metric_facts', 'data_discrepancies', 'metric_overrides', 'pa_company_config', 'point_a_comments', 'point_a_hypothesis_reviews'] as const

/** The owner (Pro): his conversation, his company's data layer and Point A review, his proposals; templates. */
const OWNER: Seen = {
  ...SERVICE_ONLY,
  comm_threads: 1, comm_messages: 1, metric_facts: 1, data_discrepancies: 1, metric_overrides: 1, ai_pending_actions: 1,
  pa_company_config: 1, pa_templates: 1, point_a_comments: 1, point_a_hypothesis_reviews: 1, point_a_recalc_queue: 0,
}
/** Another client: none of the owner's rows; the shared templates only. */
const OTHER: Seen = {
  ...SERVICE_ONLY,
  comm_threads: 0, comm_messages: 0, metric_facts: 0, data_discrepancies: 0, metric_overrides: 0, ai_pending_actions: 0,
  pa_company_config: 0, pa_templates: 1, point_a_comments: 0, point_a_hypothesis_reviews: 0, point_a_recalc_queue: 0,
}
/** Staff in scope: the tenant tables; never the client's conversation or AI proposals (service role there). */
const STAFF: Seen = { ...OTHER, metric_facts: 1, data_discrepancies: 1, metric_overrides: 1, pa_company_config: 1, point_a_comments: 1, point_a_hypothesis_reviews: 1 }
/** anon: no grant on the conversation and the service-only tables; the tenant tables answer empty. */
const ANON: Seen = { ...OTHER, comm_threads: -1, comm_messages: -1, pa_templates: 0 }

async function assign(db: Db, client: string, assignee: string): Promise<void> {
  await db.query(
    `INSERT INTO public.user_assignments (user_id, assignee_id) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET assignee_id = EXCLUDED.assignee_id`,
    [client, assignee],
  )
}

describe.skipIf(!dbTestsEnabled)('RLS of the tables of migrations 110–139 (R-045)', () => {
  afterAll(closeTestPool)

  it('anon reads nothing: no grant on the conversation and the service-only tables, empty tenant tables', () =>
    inRollback(async (db) => {
      const w = await world(db)
      expect(await seen(db, null, w)).toEqual(ANON)
    }))

  it('the owner (Pro) reads his own rows only', () =>
    inRollback(async (db) => {
      const w = await world(db)
      expect(await seen(db, w.owner, w)).toEqual(OWNER)
      // the deleted comment never; only his own proposal, his own thread
      const bodies = await asUser(db, w.owner, async () => (await db.query(`SELECT body FROM public.point_a_comments`)).rows.map((r) => r.body))
      expect(bodies).toEqual(['Комментарий эксперта'])
      const threads = await asUser(db, w.owner, async () => Number((await db.query(`SELECT count(*) AS n FROM public.comm_threads`)).rows[0].n))
      expect(threads).toBe(1)
    }))

  it('another client reads none of the owner’s rows', () =>
    inRollback(async (db) => {
      const w = await world(db)
      expect(await seen(db, w.other, w)).toEqual(OTHER)
    }))

  it('a Free owner with the gates on loses the Point A review tables only (147); the data layer stays (on purpose)', () =>
    inRollback(async (db) => {
      const w = await world(db)
      await db.query(`UPDATE public.profiles SET tier = 'free' WHERE id = $1`, [w.owner])
      expect(await seen(db, w.owner, w)).toEqual({ ...OWNER, point_a_comments: 0, point_a_hypothesis_reviews: 0 })
    }))

  it('staff by scope: admin reads the tenant tables of any client, an «assigned» super_expert only after the assignment; never the conversation, proposals or service-only tables', () =>
    inRollback(async (db) => {
      const w = await world(db)
      const admin = await seedStaff(db, 'admin')
      expect(await seen(db, admin, w)).toEqual(STAFF)
      const scoped = await seedStaff(db, 'super_expert')
      await db.query(`UPDATE public.staff_roles SET client_scope = 'assigned' WHERE user_id = $1`, [scoped])
      expect(await seen(db, scoped, w)).toEqual(OTHER)
      await assign(db, w.owner, scoped)
      expect(await seen(db, scoped, w)).toEqual(STAFF)
    }))

  it('no API role writes any of the 17 tables — not its own rows, not another client’s', () =>
    inRollback(async (db) => {
      const w = await world(db)
      const admin = await seedStaff(db, 'super_admin')
      for (const uid of [null, w.owner, admin]) {
        for (const t of TABLES) {
          const col = UPDATE_COLUMN[t]
          expect(await asUser(db, uid, () => codeOf(db, `INSERT INTO public.${t} DEFAULT VALUES`)), `${uid ?? 'anon'} INSERT ${t}`).toBe('42501')
          expect(await asUser(db, uid, () => codeOf(db, `UPDATE public.${t} SET ${col} = ${col}`)), `${uid ?? 'anon'} UPDATE ${t}`).toBe('42501')
          expect(await asUser(db, uid, () => codeOf(db, `DELETE FROM public.${t}`)), `${uid ?? 'anon'} DELETE ${t}`).toBe('42501')
        }
      }
      // the concrete attacks: a value into another company's data layer, a proposal for another user, a reply in another thread
      expect(await asUser(db, w.owner, () => codeOf(db,
        `INSERT INTO public.metric_overrides (company_id, metric_key, period_key, value) VALUES ($1, 'biz.finansy.vyruchka_god', '2025', 1)`, [w.otherCompany]))).toBe('42501')
      expect(await asUser(db, w.owner, () => codeOf(db,
        `INSERT INTO public.ai_pending_actions (user_id, company_id, kind, payload, preview) VALUES ($1, $2, 'set_value', '{}', '{}')`, [w.other, w.otherCompany]))).toBe('42501')
      expect(await asUser(db, w.owner, () => codeOf(db,
        `UPDATE public.point_a_hypothesis_reviews SET decision = 'confirmed', score = 100 WHERE company_id = $1`, [w.otherCompany]))).toBe('42501')
      // nothing changed underneath
      const other = await db.query(`SELECT decision FROM public.point_a_hypothesis_reviews WHERE company_id = $1`, [w.otherCompany])
      expect(other.rows.map((r) => r.decision)).toEqual(['rejected'])
    }))

  it('the service role (every path of the app) reads and writes all 17', () =>
    inRollback(async (db) => {
      for (const t of TABLES) {
        const r = await db.query(`SELECT has_table_privilege('service_role', $1, 'SELECT, INSERT, UPDATE, DELETE') AS ok`, [`public.${t}`])
        expect(r.rows[0].ok, t).toBe(true)
      }
    }))
})
