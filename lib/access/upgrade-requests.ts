/**
 * lib/access/upgrade-requests.ts — заявка клиента на платный доступ (Раунд 2, R2-A).
 *
 * Хранится в существующей таблице заявок персонала `admin_requests` (её видит
 * ГИГА-панель: «Заявки» → вкладка «Доступы»):
 *   type = 'access', source = 'paywall' (новые) | 'upgrade_modal' (до Раунда 2),
 *   payload = { userId, featureKey, features[], name, email, company, subject, description }.
 * admin_requests принадлежит Prisma: колонки в кавычках camelCase ("createdAt",
 * "updatedAt"); "userId" — внешний ключ на Prisma `users`, поэтому id профиля
 * лежит в payload.userId (как у остальных писателей таблицы).
 *
 * Одна ОТКРЫТАЯ заявка на пользователя: повторное нажатие (с того же или другого
 * пейволла) не создаёт новую строку — недостающий раздел дописывается в
 * payload.features существующей. Закрытая (одобрена / отклонена / в архиве)
 * заявка не мешает оставить новую. Гонку двух одновременных вставок закрывает
 * частичный уникальный индекс миграции 144 (дубликат → 23505 → берём существующую).
 *
 * Оплата — намеренная заглушка: заявка ничего не покупает и тариф не меняет;
 * тариф назначает персонал (User 360 → Биллинг, lib/payments/billing.ts).
 *
 * R4 (N4B-1, решение PO 2026-11-16): новая заявка и новый раздел к открытой
 * заявке сразу сообщаются Admin и Super Admin (лента персонала + Telegram, если
 * привязан) — lib/access/request-notices.ts, в фоне, после записи. Повтор того
 * же раздела ничего не шлёт. Так уведомляют ВСЕ писатели заявки (пейволл, меню,
 * «Настройки → Биллинг», пилот без самообслуживания в /api/checkout).
 * Все функции получают SERVICE-ROLE клиент: таблица закрыта для anon/authenticated (083/084).
 */

import type { SupabaseClient } from '@supabase/supabase-js'

/** Источники заявок на тариф (оба — заявки на платный доступ, не на регистрацию). */
export const ACCESS_REQUEST_SOURCES = ['paywall', 'upgrade_modal'] as const
export const NEW_REQUEST_SOURCE = 'paywall'
/** Статусы AdminRequestStatus, при которых заявка ещё в работе. */
export const OPEN_REQUEST_STATUSES = ['new', 'in_review', 'waiting_for_info', 'escalated'] as const

const FEATURES: Record<string, { key: string; label: string }> = {
  point_a: { key: 'point_a', label: 'Точка А' },
  '/point-a': { key: 'point_a', label: 'Точка А' },
  point_b: { key: 'point_b', label: 'Точка Б' },
  '/point-b': { key: 'point_b', label: 'Точка Б' },
  market: { key: 'market', label: 'Рынок' },
  '/market': { key: 'market', label: 'Рынок' },
  gri_full: { key: 'gri_full', label: 'Полный GRI' },
  '/gri': { key: 'gri_full', label: 'Полный GRI' },
  metrics: { key: 'metrics', label: 'Метрики' },
  '/metrics': { key: 'metrics', label: 'Метрики' },
  pdf_export: { key: 'pdf_export', label: 'PDF-экспорт' },
  ai_chat: { key: 'ai_chat', label: 'AI-чат по отчёту' },
  benchmarks: { key: 'benchmarks', label: 'Бенчмарки отрасли' },
  // R2-A (ревью H-1): пилот при выключенном pilot_self_service — тоже заявка.
  pilot: { key: 'pilot', label: 'Пилот (полный доступ на 30 дней)' },
  // R4 (N4B-4): «Настройки → Биллинг» — подключить или продлить тариф целиком.
  pro: { key: 'pro', label: 'Тариф Pro (подключить или продлить)' },
}

/** Ключ раздела из того, что прислал UI (id фичи или href меню). Неизвестное — как есть. */
export function normalizeRequestFeature(raw: string): { key: string; label: string } {
  const k = raw.trim()
  return FEATURES[k] ?? { key: k, label: k }
}

/**
 * R2-A (ревью L-5): только известные разделы. Произвольный текст в заявку
 * (карточка персонала в ГИГА) больше не попадает — API отвечает 400.
 */
export function isKnownRequestFeature(raw: unknown): raw is string {
  return typeof raw === 'string' && Object.prototype.hasOwnProperty.call(FEATURES, raw.trim())
}

export function featureLabel(key: string): string {
  return FEATURES[key]?.label ?? key
}

/** Тариф-заявка (а не регистрация): решение по ней не меняет profiles.status. */
export function isTariffAccessRequest(row: { type?: unknown; source?: unknown } | null | undefined): boolean {
  return !!row && row.type === 'access' && (ACCESS_REQUEST_SOURCES as readonly string[]).includes(String(row.source ?? ''))
}

export interface OpenAccessRequest {
  id: string
  features: string[]
  payload: Record<string, unknown>
  /** Version of the row for the compare-and-swap update ("updatedAt"). */
  updatedAt: string | null
  /** When the request was left ("createdAt"): the answer deadline counts from it (N4B-1). */
  createdAt: string | null
}

/** Sections of a request (payload.features, or the single featureKey of an old row). */
export function requestFeatures(payload: Record<string, unknown> | null | undefined): string[] {
  return featuresOf(payload ?? {})
}

function featuresOf(payload: Record<string, unknown>): string[] {
  const list = Array.isArray(payload.features) ? payload.features.filter((f): f is string => typeof f === 'string') : []
  if (list.length) return list
  return typeof payload.featureKey === 'string' ? [normalizeRequestFeature(payload.featureKey).key] : []
}

/** Открытая заявка пользователя на платный доступ, если есть. Ошибка чтения — исключение. */
export async function findOpenAccessRequest(service: SupabaseClient, userId: string): Promise<OpenAccessRequest | null> {
  const { data, error } = await service
    .from('admin_requests')
    .select('id, payload, updatedAt, createdAt')
    .eq('type', 'access')
    .in('source', [...ACCESS_REQUEST_SOURCES])
    .in('status', [...OPEN_REQUEST_STATUSES])
    .eq('payload->>userId', userId)
    .order('createdAt', { ascending: false })
    .limit(1)
  if (error) throw new Error(`admin_requests read failed: ${error.message}`)
  const row = (data as Array<{ id: string; payload: Record<string, unknown> | null; updatedAt?: string | null; createdAt?: string | null }> | null)?.[0]
  if (!row) return null
  const payload = row.payload ?? {}
  return { id: row.id, features: featuresOf(payload), payload, updatedAt: row.updatedAt ?? null, createdAt: row.createdAt ?? null }
}

function texts(person: { name: string; email: string }, features: string[]) {
  const labels = features.map(featureLabel)
  return {
    subject: `Платный доступ: ${labels.join(', ')}`,
    description:
      `Клиент ${person.name} (${person.email}) оставил заявку на платный доступ: ${labels.join(', ')}. ` +
      'Онлайн-оплата не подключена: свяжитесь с клиентом; тариф назначается в User 360 → Биллинг.',
  }
}

export interface SubmitResult {
  id: string
  /** false — заявка уже была открыта, новая строка не создана. */
  created: boolean
  features: string[]
  /** Раздел, который этот вызов дописал в уже открытую заявку; null — ничего нового (N4B-1). */
  added: string | null
}

export interface RequestPerson {
  name: string
  email: string
  company: string | null
}

async function readPerson(service: SupabaseClient, userId: string): Promise<RequestPerson> {
  const [{ data: profile }, { data: company }] = await Promise.all([
    service.from('profiles').select('full_name, email').eq('id', userId).maybeSingle(),
    service.from('companies').select('name').eq('user_id', userId).limit(1).maybeSingle(),
  ])
  const p = (profile ?? {}) as { full_name?: string | null; email?: string | null }
  const c = (company ?? null) as { name?: string | null } | null
  return { name: p.full_name || p.email || 'Неизвестный', email: p.email || '—', company: c?.name ?? null }
}

/**
 * Add `feature` to the open request — atomically (ревью L-4): a compare-and-swap
 * on the row version ("updatedAt") and on the request still being OPEN. A
 * concurrent click (another section) or a request closed in between → 0 rows →
 * null, and the caller reads again (no lost section, never into a closed request).
 */
async function tryMerge(service: SupabaseClient, open: OpenAccessRequest, feature: string, person: { name: string; email: string }): Promise<SubmitResult | null> {
  const features = [...open.features, feature]
  let q = service
    .from('admin_requests')
    .update({ payload: { ...open.payload, features, ...texts(person, features) }, updatedAt: new Date().toISOString() })
    .eq('id', open.id)
    .in('status', [...OPEN_REQUEST_STATUSES])
  if (open.updatedAt) q = q.eq('updatedAt', open.updatedAt)
  const { data, error } = await q.select('id')
  if (error) throw new Error(`admin_requests update failed: ${error.message}`)
  return Array.isArray(data) && data.length > 0 ? { id: open.id, created: false, features, added: feature } : null
}

/** Insert a new open request; 'conflict' when a parallel one won (unique index of migration 144). */
async function tryInsert(service: SupabaseClient, userId: string, feature: string, person: { name: string; email: string; company: string | null }): Promise<SubmitResult | 'conflict'> {
  const now = new Date().toISOString()
  const id = crypto.randomUUID()
  const features = [feature]
  const { error } = await service.from('admin_requests').insert({
    id,
    type: 'access',
    status: 'new',
    priority: 'medium',
    source: NEW_REQUEST_SOURCE,
    payload: { userId, featureKey: feature, features, name: person.name, email: person.email, company: person.company, ...texts(person, features) },
    createdAt: now,
    updatedAt: now,
  })
  if (!error) return { id, created: true, features, added: null }
  if ((error as { code?: string }).code === '23505') return 'conflict'
  throw new Error(`admin_requests insert failed: ${error.message}`)
}

const MAX_ATTEMPTS = 4

/**
 * Создать заявку или дописать раздел в уже открытую. Никогда не плодит вторую
 * открытую заявку того же пользователя и не теряет раздел при одновременных
 * кликах (оптимистичная блокировка + повтор).
 */
export async function submitAccessRequest(service: SupabaseClient, args: { userId: string; featureKey: string }): Promise<SubmitResult> {
  const feature = normalizeRequestFeature(args.featureKey).key
  const person = await readPerson(service, args.userId)
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const open = await findOpenAccessRequest(service, args.userId)
    if (open) {
      // The same section again: nothing new — no row, no notice.
      if (open.features.includes(feature)) return { id: open.id, created: false, features: open.features, added: null }
      const merged = await tryMerge(service, open, feature, person)
      if (merged) {
        tellStaff(service, merged, args.userId, person, open.createdAt)
        return merged
      }
      continue // lost the compare-and-swap: read again
    }
    const inserted = await tryInsert(service, args.userId, feature, person)
    if (inserted !== 'conflict') {
      tellStaff(service, inserted, args.userId, person, null)
      return inserted
    }
  }
  throw new Error('admin_requests: the request could not be stored (concurrent changes)')
}

/**
 * N4B-1: tell Admin / Super Admin about a new request or a new section — in the
 * background, after the row is stored (the client's answer never waits for
 * Telegram, a failed notice never fails the request). Idempotent by the
 * notice's dedupe key (lib/access/request-notices.ts).
 */
function tellStaff(service: SupabaseClient, result: SubmitResult, userId: string, person: RequestPerson, createdAt: string | null): void {
  void import('@/lib/background')
    .then(({ runInBackground }) => runInBackground('access-request-notice', async () => {
      const { notifyStaffAccessRequested } = await import('./request-notices')
      await notifyStaffAccessRequested(service, {
        requestId: result.id,
        userId,
        person,
        features: result.features,
        added: result.added,
        createdAt,
      })
    }))
    .catch(() => undefined)
}
