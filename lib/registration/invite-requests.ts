/**
 * lib/registration/invite-requests.ts — «Запросить приглашение» (Раунд 4, B3, N4B-3).
 *
 * Регистрация на платформе — по приглашению (registration_mode = 'invite',
 * решение PO). Вместо формы регистрации человек оставляет запрос: имя, почта,
 * компания, при желании телефон или Telegram, согласие на обработку данных.
 * Аккаунт НЕ создаётся.
 *
 *   • Запрос — строка admin_requests: type 'registration', "userId" NULL,
 *     source 'invite_request', payload.kind 'invite_request' (+ данные). Таблица
 *     принадлежит Prisma: колонки "createdAt"/"updatedAt" в кавычках.
 *   • Одна ОТКРЫТАЯ заявка на почту: повтор с той же почтой обновляет её
 *     (имя, компания, контакт, число повторов) и ничего второй раз не шлёт.
 *   • Персонал узнаёт сразу — как о заявке на оплату (lib/access/request-notices.ts):
 *     лента ГИГА + Telegram Admin / Super Admin, кто привязал Telegram; ночью тоже.
 *     В тексте нет ни почты, ни телефона (правило WB-2: ленту видит любой
 *     сотрудник) — они в карточке заявки, для ролей с users.sensitive.
 *     Тумблер — «Запрос приглашения с формы входа» (admin_notifications.invite_requested).
 *   • В ГИГА «Заявки» → «Регистрация» карточка «Запрос приглашения»:
 *     «Отправить приглашение» (POST /api/giga-admin/requests/:id/invite →
 *     lib/admin/invites.ts sendPlatformInvite) или «Отклонить» / «Архив».
 *   • Бейдж «Заявки» считает и открытые запросы приглашения.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { getSetting } from '@/lib/settings/store'
import { normalizeEmail } from '@/lib/admin/invite-shared'
import { OPEN_REQUEST_STATUSES } from '@/lib/access/upgrade-requests'
import { REQUESTS_PATH, requestDeciders } from '@/lib/access/request-notices'
import type { StaffNotification } from '@/lib/notifications/staff'
import { INVITE_REQUEST_KIND, INVITE_REQUEST_SOURCE } from './invite-request-shared'

export { INVITE_REQUEST_KIND, INVITE_REQUEST_SOURCE, isInviteRequestRow } from './invite-request-shared'

export const INVITE_REQUEST_NEW = 'invite_request.new'

type Sb = Pick<SupabaseClient, 'from'>

const OPEN = [...OPEN_REQUEST_STATUSES] as string[]

/** Тело формы. `website` — ловушка для ботов: человек его не видит и не заполняет. */
export const InviteRequestBody = z.object({
  name: z.string().trim().min(2, 'Укажите имя').max(120),
  email: z.string().trim().max(200).email('Укажите почту'),
  company: z.string().trim().min(2, 'Укажите компанию').max(200),
  contact: z.string().trim().max(120).optional().default(''),
  consent: z.literal(true, { errorMap: () => ({ message: 'Нужно согласие на обработку данных' }) }),
  website: z.string().max(500).optional(),
})
export type InviteRequestInput = z.infer<typeof InviteRequestBody>

/** Ловушка сработала: поле, которого человек не видит, заполнено. */
export function isBotSubmission(input: { website?: string | null }): boolean {
  return typeof input.website === 'string' && input.website.trim().length > 0
}

export interface InviteRequestPerson {
  name: string
  company: string | null
}

/** «Имя · Компания» без почты (WB-2): имя-почта не выводится. */
export function inviteRequestWho(p: InviteRequestPerson): string {
  const raw = (p.name ?? '').trim()
  const name = !raw || raw.includes('@') ? 'Без имени' : raw
  return `${name}${p.company ? ` · ${p.company}` : ''}`
}

/** Есть ли уже аккаунт с этой почтой (профиль создаётся вместе с аккаунтом). Ошибка — null. */
async function accountExists(sb: Sb, email: string): Promise<boolean | null> {
  try {
    const { data, error } = await sb.from('profiles').select('id').eq('email', email).limit(1).maybeSingle()
    if (error) return null
    return !!data
  } catch {
    return null
  }
}

interface OpenRow { id: string; payload: Record<string, unknown> | null }

async function findOpenRequest(sb: Sb, email: string): Promise<OpenRow | null> {
  const { data, error } = await sb
    .from('admin_requests')
    .select('id, payload')
    .eq('type', 'registration')
    .eq('source', INVITE_REQUEST_SOURCE)
    .eq('payload->>email', email)
    .in('status', OPEN)
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`invite request lookup: ${String(error.message ?? '').slice(0, 160)}`)
  return (data as OpenRow | null) ?? null
}

export interface SubmitResult {
  /** created — новая заявка (персоналу ушло уведомление); repeated — повтор открытой заявки. */
  outcome: 'created' | 'repeated'
  requestId: string
  person: InviteRequestPerson
  accountExists: boolean
}

/**
 * Записать запрос приглашения. Повтор с той же почтой, пока заявка открыта,
 * обновляет её. Ошибка базы — исключение (маршрут отвечает 500, а не «принято»).
 */
export async function submitInviteRequest(sb: Sb, input: InviteRequestInput, now: Date = new Date()): Promise<SubmitResult> {
  const email = normalizeEmail(input.email)
  if (!email) throw new Error('invite request: bad email')
  const nowIso = now.toISOString()
  const person: InviteRequestPerson = { name: input.name.trim(), company: input.company.trim() || null }
  const contact = (input.contact ?? '').trim() || null
  const subject = `Запрос приглашения: ${inviteRequestWho(person)}`.slice(0, 200)

  const open = await findOpenRequest(sb, email)
  if (open) {
    const prev = open.payload ?? {}
    const repeats = (typeof prev.repeats === 'number' && Number.isFinite(prev.repeats) ? prev.repeats : 1) + 1
    const { error } = await sb
      .from('admin_requests')
      .update({
        payload: { ...prev, name: person.name, company: person.company, contact: contact ?? prev.contact ?? null, subject, repeats, lastRequestedAt: nowIso },
        updatedAt: nowIso,
      })
      .eq('id', open.id)
    if (error) throw new Error(`invite request update: ${String(error.message ?? '').slice(0, 160)}`)
    return { outcome: 'repeated', requestId: open.id, person, accountExists: prev.accountExists === true }
  }

  const exists = (await accountExists(sb, email)) === true
  const id = crypto.randomUUID()
  const { error } = await sb.from('admin_requests').insert({
    id,
    type: 'registration',
    status: 'new',
    priority: 'medium',
    source: INVITE_REQUEST_SOURCE,
    payload: {
      kind: INVITE_REQUEST_KIND,
      email,
      name: person.name,
      company: person.company,
      contact,
      accountExists: exists,
      consentAt: nowIso,
      requestedAt: nowIso,
      lastRequestedAt: nowIso,
      repeats: 1,
      subject,
      description: exists
        ? 'Просит приглашение на платформу (регистрация сейчас по приглашению). Аккаунт с этой почтой уже есть — приглашение придёт как ссылка для входа.'
        : 'Просит приглашение на платформу (регистрация сейчас по приглашению). Аккаунта с этой почтой нет — его создаст приглашение.',
    },
    createdAt: nowIso,
    updatedAt: nowIso,
  })
  if (error) throw new Error(`invite request insert: ${String(error.message ?? '').slice(0, 160)}`)
  return { outcome: 'created', requestId: id, person, accountExists: exists }
}

/** Уведомление персоналу о новом запросе (чистая функция). Ни почты, ни телефона (WB-2). */
export function inviteRequestNotice(
  info: { requestId: string; person: InviteRequestPerson; accountExists: boolean },
  opts: { audience: string[] },
): StaffNotification {
  const who = inviteRequestWho(info.person)
  return {
    level: 'WARNING',
    type: INVITE_REQUEST_NEW,
    title: `Запрос приглашения: ${who}`.slice(0, 200),
    lines: [
      `Кто: ${who}`,
      ...(info.accountExists ? ['Аккаунт с этой почтой уже есть — приглашение придёт как ссылка для входа.'] : []),
      'Почта и контакт — в карточке заявки: «Заявки» → «Регистрация». Отправьте приглашение или отклоните запрос.',
    ],
    entityType: 'admin_request',
    entityId: info.requestId,
    link: REQUESTS_PATH,
    dedupeKey: `${INVITE_REQUEST_NEW}:${info.requestId}`,
    audienceUserIds: opts.audience,
    // Ключ уже не даёт повтора; общий cooldown по типу заглушил бы запрос другого человека.
    skipCooldown: true,
    // «Сразу», как заявка на оплату (WB-1): и ночью; «без звука» и уровни сотрудника действуют.
    quietHoursExempt: true,
    data: { requestId: info.requestId, kind: INVITE_REQUEST_KIND },
  }
}

/** Тумблер «Запрос приглашения с формы входа» (admin_notifications.invite_requested). Настройки недоступны — включено. */
async function noticesEnabled(): Promise<boolean> {
  try {
    const n = await getSetting('admin_notifications')
    return (n as Record<string, boolean | undefined>).invite_requested !== false
  } catch {
    return true
  }
}

export type InviteNoticeOutcome = 'sent' | 'disabled' | 'failed'

/**
 * Новый запрос → лента ГИГА + Telegram Admin / Super Admin. Никогда не бросает.
 * Адресатов нет или их не удалось прочитать — только лента (WB-7).
 */
export async function notifyStaffInviteRequested(
  sb: Sb,
  info: { requestId: string; person: InviteRequestPerson; accountExists: boolean },
  deps: { notifyStaff?: (n: StaffNotification) => Promise<unknown> } = {},
): Promise<InviteNoticeOutcome> {
  try {
    if (!(await noticesEnabled())) return 'disabled'
    let audience: string[] = []
    try {
      audience = await requestDeciders(sb)
    } catch (err) {
      console.error('[invite-requests] deciders unavailable:', err instanceof Error ? err.message : err)
    }
    const send = deps.notifyStaff ?? (async (n: StaffNotification) => (await import('@/lib/notifications/staff')).notifyStaff(n))
    await send(inviteRequestNotice(info, { audience }))
    return 'sent'
  } catch (err) {
    console.error('[invite-requests] staff notice failed:', err instanceof Error ? err.message : err)
    return 'failed'
  }
}

/** Сколько запросов приглашения ждут решения (бейдж «Заявки»). Ошибка — исключение. */
export async function countOpenInviteRequests(sb: Sb, limit = 500): Promise<number> {
  const { data, error } = await sb
    .from('admin_requests')
    .select('id')
    .eq('type', 'registration')
    .eq('source', INVITE_REQUEST_SOURCE)
    .in('status', OPEN)
    .limit(limit)
  if (error) throw new Error(`open invite requests: ${String(error.message ?? '').slice(0, 160)}`)
  return ((data ?? []) as unknown[]).length
}
