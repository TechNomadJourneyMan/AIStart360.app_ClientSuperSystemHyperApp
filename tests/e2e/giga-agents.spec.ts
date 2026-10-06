/**
 * E2E: GIGA «ИИ и автоматизация» — the agent control center against a real
 * prod-mirror database (read paths; mutations need the Supabase audit log).
 *
 * Runs only when E2E_DATABASE_URL is set; the dev server must use the same
 * database and a cookie secret:
 *
 *   node scripts/test-db/setup.mjs --db aistart360_e2e
 *   export E2E_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/aistart360_e2e
 *   DATABASE_URL=$E2E_DATABASE_URL DIRECT_URL=$E2E_DATABASE_URL GIGA_COOKIE_SECRET=e2e-secret-0123456789 \
 *     NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9 NEXT_PUBLIC_SUPABASE_ANON_KEY=e2e SUPABASE_SERVICE_ROLE_KEY=e2e \
 *     AGENT_INLINE_EXECUTION=false npx playwright test tests/e2e/giga-agents.spec.ts --project=desktop-chromium
 *
 * Access is the break-glass cookie (Supabase is not reachable in this setup).
 */
import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import pg from 'pg'
import { signGigaRole } from '@/lib/giga-cookie'

const DB = process.env.E2E_DATABASE_URL
test.skip(!DB, 'E2E_DATABASE_URL is not set')

const company = randomUUID()
const owner = randomUUID()
let taskId = ''
let approvalSummary = ''

test.beforeAll(async () => {
  const db = new pg.Client({ connectionString: DB })
  await db.connect()
  try {
    await db.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [owner, `${owner}@e2e.local`])
    await db.query(`INSERT INTO public.companies (id, name, user_id, "updatedAt") VALUES ($1, 'E2E Агентство', $2, now())`, [company, owner])
    const t = await db.query<{ id: string }>(
      `INSERT INTO public.agent_tasks (agent_key, company_id, trigger, requested_by, status, attempts, started_at, finished_at, result_summary)
       VALUES ('data_quality', $1, 'manual', 'e2e', 'succeeded', 1, now() - interval '2 minutes', now() - interval '1 minute', '{"findings": 3}')
       RETURNING id`, [company])
    taskId = t.rows[0].id
    const r = await db.query<{ id: string }>(
      `INSERT INTO public.agent_runs (task_id, agent_key, agent_version, company_id, attempt, status, tools_used, output_summary, finished_at)
       VALUES ($1, 'data_quality', '1.0.0', $2, 1, 'succeeded', ARRAY['metrics.read','findings.write'], 'проблем данных: 3', now())
       RETURNING id`, [taskId, company])
    await db.query(
      `INSERT INTO public.agent_tool_calls (run_id, seq, tool, permission, decision, status, result_summary)
       VALUES ($1, 1, 'metrics.read', 'READ_CLIENT_DATA', 'ALLOW', 'ok', 'метрик 12, документов 2'),
              ($1, 2, 'findings.write', 'CREATE_FINDINGS', 'ALLOW', 'ok', 'новых 3, обновлено 0, заменено 0')`, [r.rows[0].id])
    const pending = await db.query<{ id: string }>(
      `INSERT INTO public.agent_tasks (agent_key, company_id, trigger, requested_by, status, attempts)
       VALUES ('recommendation', $1, 'manual', 'e2e', 'awaiting_approval', 1) RETURNING id`, [company])
    approvalSummary = `E2E: отправить письмо клиенту ${company.slice(0, 6)}`
    await db.query(
      `INSERT INTO public.agent_approvals (task_id, agent_key, company_id, tool, permission, summary, payload, payload_hash)
       VALUES ($1, 'recommendation', $2, 'email.send', 'SEND_EMAIL', $3, '{"args":{}}', repeat('a', 64))`,
      [pending.rows[0].id, company, approvalSummary])
  } finally {
    await db.end()
  }
})

test.afterAll(async () => {
  const db = new pg.Client({ connectionString: DB })
  await db.connect()
  try {
    await db.query(`DELETE FROM public.companies WHERE id = $1`, [company])
    await db.query(`DELETE FROM auth.users WHERE id = $1`, [owner])
  } finally {
    await db.end()
  }
})

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ name: 'aistart360_giga', value: signGigaRole('super_admin'), url: baseURL! }])
})

test('agents overview lists the diagnostic pipeline agents', async ({ page }) => {
  await page.goto('/admin-giga-panel/agents')
  await expect(page.getByRole('heading', { name: /ИИ-агенты/ }).first()).toBeVisible()
  for (const name of ['Оркестратор диагностики', 'Качество данных', 'Гипотезы ИИ', 'Рекомендации', 'Мониторинг']) {
    await expect(page.getByText(name, { exact: false }).first()).toBeVisible()
  }
})

test('a task shows its run and every tool call with the permission decision', async ({ page }) => {
  await page.goto(`/admin-giga-panel/agents/tasks/${taskId}`)
  await expect(page.getByText('проблем данных: 3').first()).toBeVisible()
  await expect(page.getByText('metrics.read').first()).toBeVisible()
  await expect(page.getByText('findings.write').first()).toBeVisible()
  await expect(page.getByText(/CREATE_FINDINGS|Создание выводов/).first()).toBeVisible()
})

test('a pending approval is listed for staff with the decision buttons', async ({ page }) => {
  await page.goto('/admin-giga-panel/agents/approvals')
  await expect(page.getByText(approvalSummary)).toBeVisible()
  await expect(page.getByRole('button', { name: /Одобрить/ }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: /Отклонить/ }).first()).toBeVisible()
})

test('costs page renders the platform budget', async ({ page }) => {
  await page.goto('/admin-giga-panel/agents/costs')
  await expect(page.getByText(/бюджет/i).first()).toBeVisible()
})
