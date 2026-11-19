/**
 * lib/email/send.ts — единая точка отправки транзакционных писем.
 *
 * Здесь и только здесь письмо уходит в Resend. Что даёт этот слой:
 *   • идемпотентность — `dedupeKey` бронируется строкой в `email_deliveries`
 *     (уникальный индекс), поэтому «анкета пройдена» не уйдёт дважды даже при
 *     гонке двух фоновых задач. Бронь — 'pending' до отправки, 'sent' после
 *     (R-152): если процесс умер между бронью и отправкой, бронь старше
 *     STALE_CLAIM_MS забирает следующий вызов (условный UPDATE — забирает один)
 *     и шлёт с тем же ключом идемпотентности Resend, что и первая попытка.
 *     Свежая бронь ДРУГОГО процесса — не «доставлено»: ответ { ok: false,
 *     retryable: true } (ревью R5, M-2), повтор задачи вернётся и после
 *     STALE_CLAIM_MS заберёт бронь, если тот процесс умер;
 *   • повтор после зависшей брони безопасен и при другом содержимом письма
 *     (ссылку перевыпустили, текст пересобрали): ключ Resend тот же, и Resend
 *     либо отдаёт ответ первой отправки (то же содержимое), либо отказывает
 *     409 invalid_idempotent_request (содержимое другое — значит, первая
 *     попытка дошла до Resend и письмо ушло: пишем 'sent', второго письма нет),
 *     либо принимает письмо (первая попытка до Resend не дошла — это и есть
 *     единственное письмо). Ключи Resend живут 24 часа: бронь, забранная позже
 *     суток после потерянного исхода отправки, может дать дубль — для этого
 *     нужны и отправка без записанного исхода (две неудачные записи подряд или
 *     падение в миллисекунды между ответом Resend и записью), и повтор позже суток;
 *   • журнал доставки — что, кому и чем закончилось (без токенов и ссылок);
 *     запись исхода проверяет ошибку, которую возвращает клиент, повторяется
 *     один раз и громко пишет в лог, если не удалась (ревью R5, L-4);
 *   • повтор при временной ошибке сети/провайдера;
 *   • честный результат — функция никогда не бросает, но и не врёт: при
 *     ошибке возвращает { ok: false, error }.
 *
 * ВАЖНО: в логи не попадают ни ссылки (в них одноразовые токены), ни тело
 * письма — только вид письма, маскированный адрес (a***@domain, R-138) и статус.
 *
 * Таймаут Resend (INT-05): RESEND_TIMEOUT_MS (по умолчанию 10 с; с вложениями —
 * 30 с). API Resend отвечает за доли секунды; зависший вызов держал cron или
 * запрос бесконечно. Каждое письмо уходит с ключом идемпотентности Resend,
 * общим для всех попыток, поэтому повтор после таймаута не даёт дубля.
 */

import { Resend } from 'resend'
import { createServiceClient } from '@/lib/supabase-service'
import { emailFrom, emailReplyTo } from './brand'
import { renderEmail, type EmailContent } from './layout'
import { maskEmail } from './mask'

export { maskEmail }

export type EmailKind =
  | 'portal_invitation'
  | 'questionnaire_completed'
  | 'survey_reminder'
  | 'gri_completed'
  | 'portal_access_granted'
  | 'expert_review_published'
  | 'notification'
  | 'report_review'
  /** Уведомление клиенту через notifyClient (lib/notifications/notify.ts). */
  | 'client_notification'
  /** Автоматическое напоминание (cron reminders). */
  | 'reminder'
  /** Приветственная серия D1/D3/D7. */
  | 'welcome'
  /** Еженедельный дайджест клиента. */
  | 'client_digest'
  /** Утренний список задач сотрудника. */
  | 'staff_tasks'
  /** Личное сообщение сотрудника пользователю (lib/comm). */
  | 'direct_message'
  /** Напоминание сотруднику: пользователь ждёт ответа дольше срока (lib/comm/escalation.ts). */
  | 'comm_escalation'

/**
 * A file attached to the letter. Resend «Send email» (resend.com/docs/api-reference/emails/send-email):
 * `attachments` — array of { content: buffer | Base64 string, filename, contentType? },
 * at most 40 MB per email after Base64 encoding. Passed to the SDK as is.
 */
export interface EmailAttachment {
  filename: string
  content: Buffer
  contentType?: string
}

/** Resend: «max 40MB per email, after Base64 encoding of the attachments». */
export const EMAIL_ATTACHMENTS_MAX_BASE64_BYTES = 40 * 1024 * 1024

export interface TransactionalEmailInput {
  kind: EmailKind
  to: string
  subject: string
  content: EmailContent
  userId?: string | null
  /** Ключ идемпотентности. Без него письмо отправляется всегда. */
  dedupeKey?: string | null
  metadata?: Record<string, unknown>
  /** Files to attach (see EmailAttachment). Never written to the delivery log. */
  attachments?: EmailAttachment[]
}

export interface TransactionalEmailResult {
  ok: boolean
  /** true — письмо с таким dedupeKey уже уходило, повтор не нужен. */
  skipped?: boolean
  /**
   * true (with ok: false) — NOT delivered by this call, and not failed either: another process
   * holds a fresh claim of this dedupeKey (it is sending right now, or died less than
   * STALE_CLAIM_MS ago), or the claim could not be checked. Retry later: after STALE_CLAIM_MS a
   * dead claim is taken over and sent.
   */
  retryable?: boolean
  providerId?: string
  error?: string
}

export const EMAIL_IN_FLIGHT_ERROR = 'письмо с этим ключом сейчас отправляет другой процесс — повторите позже'

const MAX_ATTEMPTS = 3

/** INT-05: default wait for one Resend call; attachments (up to 40 MB) get more. */
const RESEND_TIMEOUT_MS = 10_000
const RESEND_ATTACHMENTS_TIMEOUT_MS = 30_000

function resendTimeoutMs(withAttachments: boolean): number {
  const raw = Number(process.env.RESEND_TIMEOUT_MS)
  if (Number.isFinite(raw) && raw > 0) return Math.floor(raw)
  return withAttachments ? RESEND_ATTACHMENTS_TIMEOUT_MS : RESEND_TIMEOUT_MS
}


/** The SDK's promise, or a rejection after `ms` (the SDK takes no AbortSignal). */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  return Promise.race([
    work,
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`Resend timeout after ${ms} ms`)), ms)
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

/**
 * Предохранитель: из тестов живые письма не уходят.
 *
 * Поймано на практике — интеграционный тест анкеты не мокал почту, и стоило
 * появиться `RESEND_API_KEY` в `.env.local`, как прогон начал слать настоящие
 * письма и флакать на сетевом ожидании. Ключ окружения — единственный способ
 * осознанно разрешить отправку (им пользуются тесты самого отправителя,
 * где Resend замокан).
 */
function blockedInTests(): boolean {
  if (process.env.EMAIL_ALLOW_SEND_IN_TESTS === '1') return false
  return process.env.VITEST === 'true' || process.env.NODE_ENV === 'test'
}

function isTransient(message: string): boolean {
  return /timeout|network|fetch failed|ECONN|rate.?limit|429|50\d/i.test(message)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * A 'pending' claim older than this belongs to a process that died before the send. Far above
 * the longest send: MAX_ATTEMPTS × the attachments timeout (30 s) + the retry pauses ≈ 95 s.
 */
export const STALE_CLAIM_MS = 10 * 60_000

type ServiceClient = ReturnType<typeof createServiceClient>

/**
 * The claim of a letter's idempotency key:
 *   'claimed'   — this call sends (rowId: its journal row; null — no key, or no journal);
 *   'sent'      — the letter already went out under this key: nothing to do;
 *   'in_flight' — another process holds a fresh claim, or the claim could not be checked:
 *                 not delivered by this call — retryable.
 */
type Claim = { state: 'claimed'; rowId: string | null } | { state: 'sent' } | { state: 'in_flight' }

/** Бронь ключа идемпотентности: строка 'pending'. */
async function claimDedupe(input: TransactionalEmailInput): Promise<Claim> {
  if (!input.dedupeKey) return { state: 'claimed', rowId: null }
  try {
    const sb = createServiceClient()
    const row = {
      kind: input.kind,
      recipient: input.to,
      subject: input.subject,
      user_id: input.userId ?? null,
      dedupe_key: input.dedupeKey,
      metadata: input.metadata ?? {},
    }
    const insert = (status: 'pending' | 'sent') =>
      sb.from('email_deliveries').insert({ ...row, status }).select('id').single()
    // Two rounds: the conflicting row may vanish under us (its send failed and released the key).
    for (let round = 0; round < 2; round++) {
      let { data, error } = await insert('pending')
      // 23514 — CHECK без 'pending' (миграция 158 ещё не применена): бронь значит «отправлено», как раньше.
      if (error && (error as { code?: string }).code === '23514') ({ data, error } = await insert('sent'))
      if (!error) return { state: 'claimed', rowId: (data as { id: string }).id }
      // 23505 — уникальный индекс: такое письмо уже уходило или уходит сейчас.
      if ((error as { code?: string }).code === '23505') {
        const existing = await takeOverStaleClaim(sb, input.dedupeKey)
        if (existing === 'vanished') continue
        return existing
      }
      // Таблицы ещё нет (миграция не применена) — не блокируем отправку.
      console.warn(`[email] журнал недоступен (${error.message}) — шлём без идемпотентности`)
      return { state: 'claimed', rowId: null }
    }
    return { state: 'in_flight' }
  } catch (e) {
    console.warn('[email] журнал недоступен:', e instanceof Error ? e.message : e)
    return { state: 'claimed', rowId: null }
  }
}

/**
 * The key is taken. Only a 'pending' claim older than STALE_CLAIM_MS is taken over — by a
 * conditional UPDATE, so of two callers racing for it exactly one wins. The winner sends under
 * the SAME row (the same Resend idempotency key): if the dead process did reach Resend, Resend
 * drops the repeat (or refuses it with 409 — see sendTransactionalEmail). 'sent' (or 'skipped')
 * — done. A fresh 'pending', a lost race, a read / write error — in flight: retryable, never
 * «delivered». The row gone — 'vanished' (claim again).
 */
async function takeOverStaleClaim(sb: ServiceClient, dedupeKey: string): Promise<Claim | 'vanished'> {
  try {
    const { data: existing, error: readError } = await sb
      .from('email_deliveries')
      .select('id, status, claimed_at')
      .eq('dedupe_key', dedupeKey)
      .maybeSingle()
    if (readError) return { state: 'in_flight' }
    const row = existing as { id: string; status: string; claimed_at: string | null } | null
    if (!row) return 'vanished'
    if (row.status !== 'pending') return { state: 'sent' }
    const { data: taken, error: takeError } = await sb
      .from('email_deliveries')
      .update({ claimed_at: new Date().toISOString() })
      .eq('id', row.id)
      .eq('status', 'pending')
      .lt('claimed_at', new Date(Date.now() - STALE_CLAIM_MS).toISOString())
      .select('id')
    if (takeError || !taken || (taken as unknown[]).length === 0) return { state: 'in_flight' }
    console.warn('[email] бронь письма зависла (процесс не дошёл до отправки или не записал исход) — отправляем повторно с тем же ключом')
    return { state: 'claimed', rowId: row.id }
  } catch {
    return { state: 'in_flight' }
  }
}

/**
 * The journal row of the outcome. The client RETURNS its errors (it does not throw them): both are
 * checked, the write is retried once, then logged loudly. A 'sent' that is not written leaves the
 * claim 'pending' — after STALE_CLAIM_MS a caller takes it over and sends with the same Resend
 * key, which Resend drops or refuses (409): no second letter within the key's 24 hours.
 */
async function recordOutcome(
  input: TransactionalEmailInput,
  rowId: string | null,
  status: 'sent' | 'failed',
  extra: { providerId?: string; error?: string },
): Promise<boolean> {
  const write = async (): Promise<{ error: { message?: string } | null }> => {
    const sb = createServiceClient()
    if (rowId) {
      const { error } = await sb
        .from('email_deliveries')
        .update({
          status,
          provider_id: extra.providerId ?? null,
          error: extra.error ?? null,
          // Освобождаем ключ: неотправленное письмо должно иметь шанс уйти позже.
          ...(status === 'failed' ? { dedupe_key: null } : {}),
        })
        .eq('id', rowId)
      return { error }
    }
    const { error } = await sb.from('email_deliveries').insert({
      kind: input.kind,
      recipient: input.to,
      subject: input.subject,
      user_id: input.userId ?? null,
      dedupe_key: status === 'sent' ? input.dedupeKey ?? null : null,
      status,
      provider_id: extra.providerId ?? null,
      error: extra.error ?? null,
      metadata: input.metadata ?? {},
    })
    return { error }
  }
  let why = ''
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const { error } = await write()
      if (!error) return true
      why = error.message ?? 'error'
    } catch (e) {
      why = e instanceof Error ? e.message : String(e)
    }
  }
  console.error(
    `[email] ${input.kind} → ${maskEmail(input.to)}: журнал не записал «${status}» (2 попытки): ${why}` +
      (rowId && status === 'sent' ? ' — бронь осталась pending; повтор после её устаревания уйдёт с тем же ключом Resend' : '') +
      (rowId && status === 'failed' ? ' — ключ не освобождён; после устаревания брони письмо отправит следующий вызов' : ''),
  )
  return false
}

/** Resend refused the reused idempotency key: an earlier attempt of THIS row used it with other content. */
function keyAlreadyUsed(err: unknown): boolean {
  return (err as { name?: unknown } | null)?.name === 'invalid_idempotent_request'
}

/** Resend is still processing an earlier request with this key (e.g. our own timed-out attempt). */
function keyInProgress(err: unknown): boolean {
  return (err as { name?: unknown } | null)?.name === 'concurrent_idempotent_requests'
}

export async function sendTransactionalEmail(input: TransactionalEmailInput): Promise<TransactionalEmailResult> {
  if (blockedInTests()) {
    return { ok: true, skipped: true }
  }

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    const error = 'RESEND_API_KEY не задан'
    console.error(`[email] ${input.kind} → ${maskEmail(input.to)}: ${error}`)
    return { ok: false, error }
  }

  const attachments = input.attachments?.length
    ? input.attachments.map((a) => ({ filename: a.filename, content: a.content, ...(a.contentType ? { contentType: a.contentType } : {}) }))
    : null
  if (attachments) {
    const base64Bytes = attachments.reduce((sum, a) => sum + Math.ceil(a.content.length / 3) * 4, 0)
    if (base64Bytes > EMAIL_ATTACHMENTS_MAX_BASE64_BYTES) {
      const error = 'вложения больше 40 МБ (лимит Resend)'
      console.error(`[email] ${input.kind} → ${maskEmail(input.to)}: ${error}`)
      return { ok: false, error }
    }
  }

  const claim = await claimDedupe(input)
  if (claim.state === 'sent') {
    console.info(`[email] ${input.kind} → ${maskEmail(input.to)}: уже отправлено ранее, пропуск`)
    return { ok: true, skipped: true }
  }
  if (claim.state === 'in_flight') {
    console.warn(`[email] ${input.kind} → ${maskEmail(input.to)}: бронь занята другим процессом — не доставлено этим вызовом, повторите позже`)
    return { ok: false, retryable: true, error: EMAIL_IN_FLIGHT_ERROR }
  }
  const rowId = claim.rowId

  const { html, text } = renderEmail(input.content)
  const resend = new Resend(apiKey)
  const replyTo = emailReplyTo()

  // One key for every attempt of this letter: a retry after a timeout (the first send may have
  // gone through) is dropped by Resend instead of reaching the client twice.
  const idempotencyKey = `aistart360-${rowId ?? globalThis.crypto.randomUUID()}`
  const timeoutMs = resendTimeoutMs(Boolean(attachments))
  let lastError = 'Письмо не отправлено'
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await withTimeout(resend.emails.send({
        from: emailFrom(),
        to: input.to,
        subject: input.subject,
        html,
        text,
        ...(replyTo ? { replyTo } : {}),
        ...(attachments ? { attachments } : {}),
      }, { idempotencyKey }), timeoutMs)
      const err = (res as { error?: unknown } | null)?.error
      if (err) {
        lastError = typeof err === 'string' ? err : (err as { message?: string })?.message ?? JSON.stringify(err)
        if (rowId && keyAlreadyUsed(err)) {
          // A taken-over claim whose letter was rendered again (a new link, a rebuilt text): the key
          // of this row already reached Resend with the first content — that letter went out.
          await recordOutcome(input, rowId, 'sent', { error: 'resend: ключ уже использован первой попыткой — письмо ушло тогда' })
          console.warn(`[email] ${input.kind} → ${maskEmail(input.to)}: ключ Resend уже использован первой попыткой — письмо ушло тогда, второе не отправляем`)
          return { ok: true, skipped: true }
        }
        if (attempt < MAX_ATTEMPTS && (isTransient(lastError) || keyInProgress(err))) {
          await sleep(attempt * 400)
          continue
        }
        break
      }
      const providerId = (res as { data?: { id?: string } } | null)?.data?.id
      await recordOutcome(input, rowId, 'sent', { providerId })
      console.info(`[email] ${input.kind} → ${maskEmail(input.to)}: отправлено${providerId ? ` (${providerId})` : ''}`)
      return { ok: true, providerId }
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e)
      if (attempt < MAX_ATTEMPTS && isTransient(lastError)) {
        await sleep(attempt * 400)
        continue
      }
      break
    }
  }

  await recordOutcome(input, rowId, 'failed', { error: lastError })
  console.error(`[email] ${input.kind} → ${maskEmail(input.to)}: ошибка — ${lastError}`)
  return { ok: false, error: lastError }
}
