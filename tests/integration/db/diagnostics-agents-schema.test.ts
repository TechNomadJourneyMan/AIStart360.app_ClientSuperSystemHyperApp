/**
 * Schema behaviour of migrations 085–087 on the real database: metric history,
 * provenance rules for findings, report versioning, the agent task queue
 * (lease, retry with backoff, dead-letter, reaper), approval expiry and
 * tenant visibility. Run: npm run test:db:setup && npm run test:db
 */
import { afterAll, describe, expect, it } from 'vitest'
import { dbTestsEnabled } from '../../helpers/db-env'
import { asUser, closeTestPool, inRollback, pgErrorCode, seedCompany, seedUser, type Db } from '../../helpers/pg-rls'

async function tenant(db: Db) {
  const owner = await seedUser(db, { status: 'approved' })
  const company = await seedCompany(db, owner)
  return { owner, company }
}

async function enqueue(db: Db, company: string | null, extra: Record<string, unknown> = {}): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO public.agent_tasks (agent_key, company_id, trigger, input, max_attempts)
     VALUES ($1, $2, 'manual', '{}'::jsonb, $3) RETURNING id`,
    [extra.agent_key ?? 'metrics', company, extra.max_attempts ?? 3],
  )
  return rows[0].id
}

describe.skipIf(!dbTestsEnabled)('085–087 schema', () => {
  afterAll(closeTestPool)

  describe('metric history', () => {
    it('records a point on insert and on value change, not on no-op upserts', () =>
      inRollback(async (db) => {
        const { company, owner } = await tenant(db)
        const { rows } = await db.query(
          `INSERT INTO public.metrics (company_id, metric_key, metric_value, source) VALUES ($1, 'biz.revenue', 100, 'survey') RETURNING id`,
          [company],
        )
        await db.query(`UPDATE public.metrics SET metric_value = 100 WHERE id = $1`, [rows[0].id])
        await db.query(`UPDATE public.metrics SET metric_value = 140 WHERE id = $1`, [rows[0].id])
        const history = await asUser(db, owner, async () =>
          (await db.query(`SELECT value::float FROM public.metric_value_history WHERE company_id = $1 ORDER BY id`, [company])).rows,
        )
        expect(history.map((r) => r.value)).toEqual([100, 140])
      }))

    it('history is read-only for the tenant', () =>
      inRollback(async (db) => {
        const { company, owner } = await tenant(db)
        const forge = asUser(db, owner, () =>
          db.query(`INSERT INTO public.metric_value_history (company_id, metric_key, value) VALUES ($1, 'x', 1)`, [company]),
        )
        expect(await pgErrorCode(forge)).toBe('42501')
      }))
  })

  describe('findings provenance', () => {
    it('refuses to show an unreviewed AI hypothesis to the client', () =>
      inRollback(async (db) => {
        const { company } = await tenant(db)
        const code = await pgErrorCode(db.query(
          `INSERT INTO public.diagnostic_findings (company_id, kind, area, title, provenance_type, confidence, produced_by, visible_to_client)
           VALUES ($1, 'risk', 'finance', 'Кассовый разрыв', 'AI_HYPOTHESIS', 0.6, 'agent:diagnostic', TRUE)`,
          [company],
        ))
        expect(code).toBe('23514')
      }))

    it('clients see visible findings only; staff see all', () =>
      inRollback(async (db) => {
        const { company, owner } = await tenant(db)
        await db.query(
          `INSERT INTO public.diagnostic_findings (company_id, kind, area, title, provenance_type, confidence, produced_by, visible_to_client)
           VALUES ($1, 'gap', 'sales', 'Нет CRM', 'FACT', 0.9, 'engine:point_a', TRUE),
                  ($1, 'risk', 'finance', 'Гипотеза', 'AI_HYPOTHESIS', 0.5, 'agent:diagnostic', FALSE)`,
          [company],
        )
        const staff = await seedUser(db, { role: 'expert', status: 'approved' })
        const count = (uid: string) =>
          asUser(db, uid, async () => (await db.query(`SELECT 1 FROM public.diagnostic_findings`)).rowCount)
        expect(await count(owner)).toBe(1)
        expect(await count(staff)).toBe(2)
        const other = await seedUser(db, { status: 'approved' })
        expect(await count(other)).toBe(0)
      }))
  })

  it('report versions are numbered per company and type', () =>
    inRollback(async (db) => {
      const { company } = await tenant(db)
      const insert = () =>
        db.query(
          `INSERT INTO public.report_versions (company_id, report_type, title, content, provenance, data_hash, created_by)
           VALUES ($1, 'point_a', 'Точка А', '{}', '{}', 'h', 'test') RETURNING version`,
          [company],
        )
      expect((await insert()).rows[0].version).toBe(1)
      expect((await insert()).rows[0].version).toBe(2)
    }))

  it('allows one in-flight diagnostic session per company and kind', () =>
    inRollback(async (db) => {
      const { company } = await tenant(db)
      await db.query(`INSERT INTO public.diagnostic_sessions (company_id) VALUES ($1)`, [company])
      const dup = await pgErrorCode(db.query(`INSERT INTO public.diagnostic_sessions (company_id) VALUES ($1)`, [company]))
      expect(dup).toBe('23505')
    }))

  describe('agent task queue', () => {
    it('claims due tasks once, with a lease', () =>
      inRollback(async (db) => {
        const { company } = await tenant(db)
        const id = await enqueue(db, company)
        const first = await db.query(`SELECT * FROM public.agent_claim_task($1)`, [id])
        expect(first.rows[0]).toMatchObject({ status: 'running', attempts: 1 })
        expect(first.rows[0].lease_token).toBeTruthy()
        const second = await db.query(`SELECT * FROM public.agent_claim_task($1)`, [id])
        expect(second.rowCount).toBe(0)
      }))

    it('retries failures with backoff and dead-letters after max attempts', () =>
      inRollback(async (db) => {
        const { company } = await tenant(db)
        const id = await enqueue(db, company, { max_attempts: 2 })
        const claim = async () => (await db.query(`SELECT lease_token FROM public.agent_claim_task($1)`, [id])).rows[0].lease_token
        const fail = (lease: string) =>
          db.query(`SELECT public.agent_finish_task($1, $2, 'failed', 'LLM_TIMEOUT', 'timeout') AS s`, [id, lease])

        expect((await fail(await claim())).rows[0].s).toBe('queued')
        const { rows } = await db.query(`SELECT run_after > now() AS later FROM public.agent_tasks WHERE id = $1`, [id])
        expect(rows[0].later).toBe(true)

        await db.query(`UPDATE public.agent_tasks SET run_after = now() WHERE id = $1`, [id])
        expect((await fail(await claim())).rows[0].s).toBe('dead')
      }))

    it('ignores a stale lease and reaps expired ones', () =>
      inRollback(async (db) => {
        const { company } = await tenant(db)
        const id = await enqueue(db, company)
        await db.query(`SELECT public.agent_claim_task($1)`, [id])
        const stale = await db.query(
          `SELECT public.agent_finish_task($1, gen_random_uuid(), 'succeeded') AS s`, [id],
        )
        expect(stale.rows[0].s).toBeNull()
        await db.query(`UPDATE public.agent_tasks SET lease_until = now() - interval '1 minute' WHERE id = $1`, [id])
        expect((await db.query(`SELECT public.agent_reap_expired_leases() AS n`)).rows[0].n).toBe(1)
        const { rows } = await db.query(`SELECT status, last_error_code FROM public.agent_tasks WHERE id = $1`, [id])
        expect(rows[0]).toEqual({ status: 'queued', last_error_code: 'LEASE_EXPIRED' })
      }))

    it('expires pending approvals and cancels their task', () =>
      inRollback(async (db) => {
        const { company } = await tenant(db)
        const id = await enqueue(db, company)
        await db.query(`UPDATE public.agent_tasks SET status = 'awaiting_approval' WHERE id = $1`, [id])
        await db.query(
          `INSERT INTO public.agent_approvals (task_id, agent_key, company_id, tool, permission, summary, payload, payload_hash, expires_at)
           VALUES ($1, 'metrics', $2, 'send_email', 'SEND_EMAIL', 'x', '{}', 'h', now() - interval '1 minute')`,
          [id, company],
        )
        expect((await db.query(`SELECT public.agent_expire_approvals() AS n`)).rows[0].n).toBe(1)
        const { rows } = await db.query(`SELECT status FROM public.agent_tasks WHERE id = $1`, [id])
        expect(rows[0].status).toBe('cancelled')
      }))

    it('queue functions are not callable through the API roles', () =>
      inRollback(async (db) => {
        const { owner } = await tenant(db)
        const code = await pgErrorCode(asUser(db, owner, () => db.query(`SELECT * FROM public.agent_claim_tasks(5)`)))
        expect(code).toBe('42501')
      }))
  })

  it('tenants see their own agent activity but never configs, approvals, outbox or notifications', () =>
    inRollback(async (db) => {
      const a = await tenant(db)
      const b = await tenant(db)
      await enqueue(db, a.company)
      await enqueue(db, b.company)
      const tasks = await asUser(db, a.owner, async () =>
        (await db.query(`SELECT company_id FROM public.agent_tasks`)).rows.map((r) => r.company_id),
      )
      expect(tasks).toEqual([a.company])
      for (const table of ['agent_configs', 'agent_approvals', 'platform_events', 'agent_tool_calls', 'notification_events', 'staff_telegram_links']) {
        expect(await pgErrorCode(asUser(db, a.owner, () => db.query(`SELECT 1 FROM public.${table}`))), table).toBe('42501')
      }
    }))
})
