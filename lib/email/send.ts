/**
 * lib/email/send.ts — единая точка отправки транзакционных писем.
 *
 * Здесь и только здесь письмо уходит в Resend. Что даёт этот слой:
 *   • идемпотентность — `dedupeKey` бронируется строкой в `email_deliveries`
 *     (уникальный индекс), поэтому «анкета пройдена» не уйдёт дважды даже при
 *     гонке двух фоновых задач;
 *   • журнал доставки — что, кому и чем закончилось (без токенов и ссылок);
 *   • повтор при временной ошибке сети/провайдера;
 *   • честный результат — функция никогда не бросает, но и не врёт: при
 *     ошибке возвращает { ok: false, error }.
 *
 * ВАЖНО: в логи не попадают ни ссылки (в них одноразовые токены), ни тело
 * письма — только вид письма, адрес и статус.
 */

import { Resend } from 'resend'
import { createServiceClient } from '@/lib/supabase-service'
import { emailFrom, emailReplyTo } from './brand'
import { renderEmail, type EmailContent } from './layout'

export type EmailKind =
  | 'portal_invitation'
  | 'questionnaire_completed'
  | 'survey_reminder'
  | 'gri_completed'
  | 'portal_access_granted'
  | 'expert_review_published'
  | 'notification'
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

export interface TransactionalEmailInput {
  kind: EmailKind
  to: string
  subject: string
  content: EmailContent
  userId?: string | null
  /** Ключ идемпотентности. Без него письмо отправляется всегда. */
  dedupeKey?: string | null
  metadata?: Record<string, unknown>
}

export interface TransactionalEmailResult {
  ok: boolean
  /** true — письмо с таким dedupeKey уже уходило, повтор не нужен. */
  skipped?: boolean
  providerId?: string
  error?: string
}

const MAX_ATTEMPTS = 3

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

/** Бронь ключа идемпотентности. `false` — письмо уже отправлено. */
async function claimDedupe(input: TransactionalEmailInput): Promise<{ claimed: boolean; rowId: string | null }> {
  if (!input.dedupeKey) return { claimed: true, rowId: null }
  try {
    const { data, error } = await createServiceClient()
      .from('email_deliveries')
      .insert({
        kind: input.kind,
        recipient: input.to,
        subject: input.subject,
        user_id: input.userId ?? null,
        dedupe_key: input.dedupeKey,
        status: 'sent',
        metadata: input.metadata ?? {},
      })
      .select('id')
      .single()
    if (error) {
      // 23505 — уникальный индекс: такое письмо уже уходило.
      if ((error as { code?: string }).code === '23505') return { claimed: false, rowId: null }
      // Таблицы ещё нет (миграция не применена) — не блокируем отправку.
      console.warn(`[email] журнал недоступен (${error.message}) — шлём без идемпотентности`)
      return { claimed: true, rowId: null }
    }
    return { claimed: true, rowId: (data as { id: string }).id }
  } catch (e) {
    console.warn('[email] журнал недоступен:', e instanceof Error ? e.message : e)
    return { claimed: true, rowId: null }
  }
}

async function recordOutcome(
  input: TransactionalEmailInput,
  rowId: string | null,
  status: 'sent' | 'failed',
  extra: { providerId?: string; error?: string },
): Promise<void> {
  try {
    const sb = createServiceClient()
    if (rowId) {
      await sb
        .from('email_deliveries')
        .update({
          status,
          provider_id: extra.providerId ?? null,
          error: extra.error ?? null,
          // Освобождаем ключ: неотправленное письмо должно иметь шанс уйти позже.
          ...(status === 'failed' ? { dedupe_key: null } : {}),
        })
        .eq('id', rowId)
      return
    }
    await sb.from('email_deliveries').insert({
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
  } catch {
    /* журнал — не критичный путь */
  }
}

export async function sendTransactionalEmail(input: TransactionalEmailInput): Promise<TransactionalEmailResult> {
  if (blockedInTests()) {
    return { ok: true, skipped: true }
  }

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    const error = 'RESEND_API_KEY не задан'
    console.error(`[email] ${input.kind} → ${input.to}: ${error}`)
    return { ok: false, error }
  }

  const { claimed, rowId } = await claimDedupe(input)
  if (!claimed) {
    console.info(`[email] ${input.kind} → ${input.to}: уже отправлено ранее, пропуск`)
    return { ok: true, skipped: true }
  }

  const { html, text } = renderEmail(input.content)
  const resend = new Resend(apiKey)
  const replyTo = emailReplyTo()

  let lastError = 'Письмо не отправлено'
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await resend.emails.send({
        from: emailFrom(),
        to: input.to,
        subject: input.subject,
        html,
        text,
        ...(replyTo ? { replyTo } : {}),
      })
      const err = (res as { error?: unknown } | null)?.error
      if (err) {
        lastError = typeof err === 'string' ? err : (err as { message?: string })?.message ?? JSON.stringify(err)
        if (attempt < MAX_ATTEMPTS && isTransient(lastError)) {
          await sleep(attempt * 400)
          continue
        }
        break
      }
      const providerId = (res as { data?: { id?: string } } | null)?.data?.id
      await recordOutcome(input, rowId, 'sent', { providerId })
      console.info(`[email] ${input.kind} → ${input.to}: отправлено${providerId ? ` (${providerId})` : ''}`)
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
  console.error(`[email] ${input.kind} → ${input.to}: ошибка — ${lastError}`)
  return { ok: false, error: lastError }
}
