/**
 * E2E: GIGA «ИИ и автоматизация» → «Провайдеры и ключи» against a real
 * prod-mirror database with migration 094 applied (seeded providers
 * `openrouter` and `alem` with the model `alemllm`). Read paths only —
 * mutations need the Supabase audit journal, which is not reachable here.
 *
 * Runs only when E2E_DATABASE_URL and E2E_AUTH_SEAM_SECRET are set; the dev
 * server must use the same database and the same seam secret (≥32 chars):
 *
 *   node scripts/test-db/setup.mjs --db aistart360_e2e
 *   export E2E_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/aistart360_e2e
 *   export E2E_AUTH_SEAM_SECRET=$(openssl rand -hex 32)
 *   DATABASE_URL=$E2E_DATABASE_URL DIRECT_URL=$E2E_DATABASE_URL GIGA_COOKIE_SECRET=e2e-secret-0123456789 \
 *     NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9 NEXT_PUBLIC_SUPABASE_ANON_KEY=e2e SUPABASE_SERVICE_ROLE_KEY=e2e \
 *     npx playwright test tests/e2e/giga-providers.spec.ts --project=desktop-chromium
 *
 * Access: a seeded super_admin + the test-only E2E auth seam cookie
 * (tests/e2e/giga-seam.ts; Supabase is not reachable here).
 */
import { expect, test } from '@playwright/test'
import { seedSeamSuperAdmin, type SeamStaff } from './giga-seam'

const DB = process.env.E2E_DATABASE_URL
test.skip(!DB || !process.env.E2E_AUTH_SEAM_SECRET, 'E2E_DATABASE_URL / E2E_AUTH_SEAM_SECRET is not set')

let staff: SeamStaff
test.beforeAll(async () => {
  staff = await seedSeamSuperAdmin(DB!)
})
test.afterAll(async () => {
  await staff?.cleanup()
})

test.beforeEach(async ({ context, baseURL }) => {
  await staff.login(context, baseURL!)
})

test('the page lists the seeded providers alem and openrouter with their models', async ({ page }) => {
  await page.goto('/admin-giga-panel/ai-providers')
  await expect(page.getByRole('heading', { name: 'Провайдеры и ключи' }).first()).toBeVisible()
  const alem = page.locator('[data-testid="provider-card"][data-provider-key="alem"]')
  const openrouter = page.locator('[data-testid="provider-card"][data-provider-key="openrouter"]')
  await expect(alem).toBeVisible()
  await expect(openrouter).toBeVisible()
  await expect(alem.getByText('Alem Plus').first()).toBeVisible()
  await expect(alem.getByText('https://llm.alem.ai/v1')).toBeVisible()
  await expect(alem.getByText('alemllm').first()).toBeVisible()
  await expect(openrouter.getByText('https://openrouter.ai/api/v1')).toBeVisible()
  // Super Admin manages: the controls are there.
  await expect(page.getByRole('button', { name: 'Добавить провайдера' })).toBeVisible()
})

test('the menu has «Провайдеры и ключи» in «ИИ и автоматизация»', async ({ page }) => {
  await page.goto('/admin-giga-panel/agents')
  await page.getByRole('link', { name: 'Провайдеры и ключи' }).first().click()
  await expect(page).toHaveURL(/\/admin-giga-panel\/ai-providers$/)
})

test('routing, budgets and spend tabs render honest states', async ({ page }) => {
  await page.goto('/admin-giga-panel/ai-providers')
  await page.getByRole('tab', { name: 'Маршрутизация' }).click()
  await expect(page.locator('[data-testid="route-row"]')).toHaveCount(6)
  const light = page.getByRole('combobox', { name: 'Модель для «Чат · light»' })
  await expect(light).toBeVisible()
  await expect(light.locator('option', { hasText: 'по умолчанию (OpenRouter из env)' })).toHaveCount(1)
  await expect(light.locator('option', { hasText: 'Alem Plus' })).toHaveCount(1)

  await page.getByRole('tab', { name: 'Бюджеты' }).click()
  await expect(page.getByText(/источник: (БД|env)/).first()).toBeVisible()

  await page.getByRole('tab', { name: 'Расходы' }).click()
  await expect(page.getByText(/Расход за/).first()).toBeVisible()
})

test('the API never returns a key secret or ciphertext', async ({ page }) => {
  const res = await page.request.get('/api/giga-admin/ai-providers')
  expect(res.ok()).toBe(true)
  const text = await res.text()
  expect(text).not.toContain('secret_ciphertext')
  const body = JSON.parse(text) as { providers: Array<{ key: string; credentials: Array<Record<string, unknown>> }> }
  expect(body.providers.map((p) => p.key)).toEqual(expect.arrayContaining(['alem', 'openrouter']))
  for (const p of body.providers) for (const c of p.credentials) expect(String(c.masked)).toMatch(/^••••/)
})
