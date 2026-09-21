/**
 * scripts/qa-super-expert.ts — сквозная проверка кабинета SuperExpert.
 *
 *   npx tsx scripts/qa-super-expert.ts [--base=http://localhost:3000] [--keep]
 *
 * Что делает: заводит СЛУЖЕБНЫЙ аккаунт (или переиспользует), выдаёт ему роль
 * super_expert, получает настоящую сессию по одноразовой ссылке (пароль не
 * нужен), после чего дёргает API кабинета — и то, что роли положено, и то, что
 * ей запрещено. В конце роль снимается, чтобы в системе не оставалось лишнего
 * привилегированного аккаунта (флаг --keep оставляет её для ручных проверок).
 *
 * Почему через API, а не кликами: запрет должен жить на сервере. Клик по
 * спрятанной кнопке ничего не доказывает — а прямой запрос к запрещённому
 * маршруту доказывает.
 */

import fs from 'node:fs'
import path from 'node:path'

function loadEnv(file: string): void {
  if (!fs.existsSync(file)) return
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (process.env[m[1]] === undefined) process.env[m[1]] = v
  }
}
loadEnv(path.resolve(process.cwd(), '.env.local'))
loadEnv(path.resolve(process.cwd(), '.env'))

const arg = (n: string, d = ''): string => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(n.length + 3) : d
}
const BASE = arg('base', 'http://localhost:3000').replace(/\/+$/, '')
const KEEP = process.argv.includes('--keep') || process.argv.includes('--link-only')
const QA_EMAIL = arg('email', 'qa.superexpert@support.aistart360.app')
/**
 * Второй фикстур — обычный клиент. Писать проверочные данные в строку самого
 * SuperExpert нельзя: он сотрудник, а правка данных сотрудников роли запрещена
 * (canManageTarget). Поэтому запись проверяем на заведомо «клиентском»
 * аккаунте и не трогаем данные настоящих клиентов.
 */
const QA_CLIENT_EMAIL = arg('client-email', 'qa.client@support.aistart360.app')

/** Минимальная «банка печенья»: fetch в Node сам куки не хранит. */
class Jar {
  private jar = new Map<string, string>()
  absorb(res: Response): void {
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(';')
      const i = pair.indexOf('=')
      if (i < 0) continue
      const name = pair.slice(0, i).trim()
      const value = pair.slice(i + 1).trim()
      if (!value || value === 'deleted') this.jar.delete(name)
      else this.jar.set(name, value)
    }
  }
  header(): string {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ')
  }
  get size(): number { return this.jar.size }
}

const results: Array<{ group: string; name: string; expected: string; got: string; ok: boolean }> = []
const check = (group: string, name: string, expected: string, got: string) =>
  results.push({ group, name, expected, got, ok: expected === got })

async function main(): Promise<void> {
  const { createServiceClient } = await import('@/lib/supabase-service')
  const sb = createServiceClient()
  const jar = new Jar()

  // ── 1. Служебный аккаунт ───────────────────────────────────────────────
  const { data: list } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 })
  let user = list?.users?.find((u) => u.email?.toLowerCase() === QA_EMAIL.toLowerCase()) ?? null
  if (!user) {
    const { data, error } = await sb.auth.admin.createUser({
      email: QA_EMAIL,
      email_confirm: true,
      user_metadata: { full_name: 'QA SuperExpert', qa_fixture: true },
    })
    if (error) throw new Error(`не удалось создать служебный аккаунт: ${error.message}`)
    user = data.user
    console.log('служебный аккаунт создан:', QA_EMAIL)
  } else {
    console.log('служебный аккаунт уже есть:', QA_EMAIL)
  }
  const uid = user!.id

  await sb.from('profiles').upsert({
    id: uid, email: QA_EMAIL, full_name: 'QA SuperExpert',
    role: 'client', status: 'approved', updated_at: new Date().toISOString(),
  }, { onConflict: 'id' })
  await sb.from('staff_roles').upsert({
    user_id: uid, role: 'super_expert', granted_by: 'script:qa-super-expert', updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' })
  console.log('роль super_expert выдана\n')

  // Клиентский фикстур — цель для проверок записи.
  let client = list?.users?.find((u) => u.email?.toLowerCase() === QA_CLIENT_EMAIL.toLowerCase()) ?? null
  if (!client) {
    const { data, error } = await sb.auth.admin.createUser({
      email: QA_CLIENT_EMAIL, email_confirm: true,
      user_metadata: { full_name: 'QA Клиент', qa_fixture: true },
    })
    if (error) throw new Error(`не удалось создать клиентский фикстур: ${error.message}`)
    client = data.user
  }
  const clientId = client!.id
  await sb.from('profiles').upsert({
    id: clientId, email: QA_CLIENT_EMAIL, full_name: 'QA Клиент',
    role: 'client', status: 'approved', updated_at: new Date().toISOString(),
  }, { onConflict: 'id' })
  console.log('клиентский фикстур готов:', QA_CLIENT_EMAIL, '\n')

  // ── 2. Настоящая сессия по одноразовой ссылке (без пароля) ─────────────
  const { data: link, error: linkErr } = await sb.auth.admin.generateLink({ type: 'magiclink', email: QA_EMAIL })
  if (linkErr || !link?.properties?.hashed_token) throw new Error(`Supabase не дал ссылку: ${linkErr?.message}`)

  const verify = `${BASE}/auth/verify?token_hash=${link.properties.hashed_token}&type=magiclink&next=%2Fsuper-expert`

  // --link-only: выдать ссылку и выйти, чтобы открыть кабинет глазами.
  // Подразумевает --keep: без роли открывать нечего.
  if (process.argv.includes('--link-only')) {
    console.log('\nОдноразовая ссылка в кабинет (действует час):')
    console.log(verify)
    return
  }
  const vres = await fetch(verify, { redirect: 'manual' })
  jar.absorb(vres)
  const gotSession = vres.status === 307 && jar.size > 0
  check('вход', 'одноразовая ссылка обменивается на сессию', 'да', gotSession ? 'да' : `нет (${vres.status}, кук: ${jar.size})`)
  check('вход', 'ссылка ведёт в кабинет SuperExpert', '/super-expert', new URL(vres.headers.get('location') ?? BASE, BASE).pathname)

  const get = async (p: string, init: RequestInit = {}) => {
    const res = await fetch(`${BASE}${p}`, {
      ...init,
      redirect: 'manual',
      headers: { cookie: jar.header(), 'content-type': 'application/json', origin: BASE, ...(init.headers ?? {}) },
    })
    jar.absorb(res)
    return res
  }

  // ── 3. Кто я с точки зрения сервера ────────────────────────────────────
  const me = await get('/api/giga-admin/me')
  const meBody = await me.json().catch(() => null)
  check('личность', 'сервер узнаёт роль', 'super_expert', String(meBody?.data?.role))
  const perms: string[] = meBody?.data?.permissions ?? []
  check('личность', 'права выданы по матрице', 'да', perms.length ? 'да' : 'нет')

  // ── 4. Страницы кабинета отдаются ──────────────────────────────────────
  for (const p of ['/super-expert', '/super-expert/users', '/super-expert/surveys', '/super-expert/gri', '/super-expert/activity', '/super-expert/invites', '/super-expert/requests', '/super-expert/accounts']) {
    const r = await get(p)
    check('страницы', p, '200', String(r.status))
  }

  // ── 5. Разрешённые данные ──────────────────────────────────────────────
  const users = await get('/api/giga-admin/users?page=1&pageSize=5')
  const usersBody = await users.json().catch(() => null)
  check('разрешено', 'список пользователей', '200', String(users.status))
  const firstId: string | null = usersBody?.data?.[0]?.id ?? null

  for (const [name, p] of [
    ['главная (сводка)', '/api/giga-admin/overview?days=7'],
    ['анкеты', '/api/giga-admin/surveys?page=1'],
    ['GRI', '/api/giga-admin/gri?page=1'],
    ['активность', '/api/giga-admin/activity?days=7&page=1'],
    ['путь клиента (CJM)', '/api/giga-admin/cjm'],
    ['заявки на доступ', '/api/giga-admin/requests'],
    ['приглашения (список)', '/api/giga-admin/invites'],
    ['аккаунты и компании', '/api/giga-admin/clients?page=1'],
  ] as const) {
    const r = await get(p)
    check('разрешено', name, '200', String(r.status))
  }

  if (firstId) {
    for (const [name, p] of [
      ['карточка пользователя', `/api/giga-admin/users/${firstId}/profile`],
      ['анкета пользователя', `/api/giga-admin/users/${firstId}/survey`],
      ['GRI пользователя', `/api/giga-admin/users/${firstId}/gri`],
      ['события пользователя', `/api/giga-admin/users/${firstId}/events`],
      ['заметки о клиенте', `/api/giga-admin/users/${firstId}/notes`],
      ['письма клиенту', `/api/giga-admin/users/${firstId}/emails`],
      ['качество данных', `/api/giga-admin/users/${firstId}/quality`],
    ] as const) {
      const r = await get(p)
      check('разрешено', name, '200', String(r.status))
    }
  }

  // ── 6. Запрещённое — сервер должен сказать «нет» ───────────────────────
  const forbidden: Array<[string, string, RequestInit]> = [
    ['системные настройки (чтение)', '/api/giga-admin/settings', { method: 'GET' }],
    ['системные настройки (запись)', '/api/giga-admin/settings', { method: 'PUT', body: JSON.stringify({ key: 'maintenance', value: true }) }],
    ['журнал аудита', '/api/giga-admin/audit', { method: 'GET' }],
    ['разделы платформы', '/api/giga-admin/sections', { method: 'PUT', body: JSON.stringify({ sections: [] }) }],
    ['очистка событий', '/api/giga-admin/system/purge-events', { method: 'POST', body: JSON.stringify({ days: 1 }) }],
    ['страницы контента', '/api/giga-admin/content/pages', { method: 'POST', body: JSON.stringify({ title: 'qa', slug: 'qa' }) }],
  ]
  if (firstId) {
    forbidden.push(
      ['выдача ролей персонала', `/api/giga-admin/users/${firstId}/staff-role`, { method: 'PUT', body: JSON.stringify({ role: 'support', reason: 'проверка прав' }) }],
      ['блокировка пользователя', `/api/giga-admin/users/${firstId}/block`, { method: 'POST', body: JSON.stringify({ reason: 'проверка прав' }) }],
      ['архивация пользователя', `/api/giga-admin/users/${firstId}/archive`, { method: 'POST', body: JSON.stringify({ action: 'archive', reason: 'проверка прав' }) }],
      ['смена тарифа', `/api/giga-admin/users/${firstId}/access`, { method: 'PATCH', body: JSON.stringify({ tier: 'pro' }) }],
      ['сброс 2FA', `/api/giga-admin/users/${firstId}/2fa-reset`, { method: 'POST', body: JSON.stringify({ reason: 'проверка прав' }) }],
    )
  }
  for (const [name, p, init] of forbidden) {
    const r = await get(p, init)
    check('запрещено', name, '403', String(r.status))
  }

  // ── 6b. Правка данных: право есть, но проверяем без изменения боевых данных ──
  // Пустой запрос обязан отбиться валидацией (400), а не правом (403):
  // так видно, что маршрут доступен роли, и при этом ничего не записано.
  if (firstId) {
    const company = await get(`/api/giga-admin/users/${firstId}/company`, { method: 'PATCH', body: JSON.stringify({}) })
    check('разрешено', 'данные компании: маршрут открыт роли', '400', String(company.status))
    const survey = await get(`/api/giga-admin/users/${firstId}/survey`, { method: 'PATCH', body: JSON.stringify({}) })
    check('разрешено', 'правка анкеты: маршрут открыт роли', '400', String(survey.status))
  }

  // ── 6c. Настоящая запись — только в СВОЮ строку, данные клиентов не трогаем ──
  const stamp = `QA компания ${new Date().toISOString().slice(11, 19)}`
  const write = await get(`/api/giga-admin/users/${clientId}/company`, {
    method: 'PATCH',
    body: JSON.stringify({ company: { name: stamp, industry: 'QA', employee_count: 7 }, reason: 'автопроверка кабинета' }),
  })
  check('запись', 'данные компании сохраняются', '200', String(write.status))
  const saved = await write.json().catch(() => null)
  check('запись', 'ответ содержит сохранённое название', stamp, String(saved?.data?.company?.name))
  const { data: auditRow } = await sb
    .from('admin_audit_log')
    .select('action, target_user_id')
    .eq('action', 'user.company_edited')
    .eq('target_user_id', clientId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  check('запись', 'правка подписана в журнале', 'user.company_edited', String((auditRow as { action?: string } | null)?.action))

  // Данные сотрудника роли править нельзя — проверяем на себе же.
  const staffWrite = await get(`/api/giga-admin/users/${uid}/company`, {
    method: 'PATCH', body: JSON.stringify({ company: { name: 'не должно сохраниться' } }),
  })
  check('запись', 'данные сотрудника править нельзя', '403', String(staffWrite.status))

  // Заметка — настоящая запись, но в СВОЮ строку: данные клиентов не трогаем.
  const note = await get(`/api/giga-admin/users/${uid}/notes`, {
    method: 'POST', body: JSON.stringify({ body: `Автопроверка кабинета ${new Date().toISOString()}` }),
  })
  check('запись', 'заметка сохраняется', '200', String(note.status))

  // ── 7. Убираем за собой ────────────────────────────────────────────────
  if (!KEEP) {
    await sb.from('staff_roles').delete().eq('user_id', uid)
    console.log('роль у служебного аккаунта снята (--keep оставляет её)\n')
    // Роль перечитывается на КАЖДОМ запросе, поэтому та же живая сессия
    // должна потерять доступ сразу — без ожидания истечения куки.
    const after = await get('/api/giga-admin/me')
    check('отзыв', 'снятие роли закрывает доступ сразу', '403', String(after.status))
    const page = await get('/super-expert/users')
    check('отзыв', 'кабинет больше не открывается', '307', String(page.status))
  }

  // ── Отчёт ──────────────────────────────────────────────────────────────
  let lastGroup = ''
  for (const r of results) {
    if (r.group !== lastGroup) { console.log(`\n[${r.group}]`); lastGroup = r.group }
    console.log(`  ${r.ok ? '✓' : '✗'} ${r.name.padEnd(38)} ожидалось ${r.expected.padEnd(16)} получено ${r.got}`)
  }
  const failed = results.filter((r) => !r.ok)
  console.log(`\nИТОГ: ${results.length - failed.length}/${results.length} проверок пройдено`)
  if (failed.length) process.exitCode = 1
}

main().catch((e) => {
  console.error('Ошибка:', e instanceof Error ? e.message : e)
  process.exitCode = 1
})
