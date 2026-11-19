/**
 * lib/notifications/store.ts — доступ к БД для notifyClient (service role).
 *
 * Вынесено отдельно, чтобы логику notify.ts и cron-ов можно было тестировать
 * с подменой этого модуля, не трогая базу. Все функции никогда не бросают.
 */

import { createServiceClient } from '@/lib/supabase-service'

export interface RecipientProfile {
  id: string
  email: string | null
  fullName: string | null
  telegramChatId: string | null
  preferences: unknown
}

type ProfileRow = {
  id: string
  email?: string | null
  full_name?: string | null
  telegram_chat_id?: string | null
  preferences?: unknown
}

function toRecipient(row: ProfileRow): RecipientProfile {
  return {
    id: row.id,
    email: row.email?.trim() || null,
    fullName: row.full_name?.trim() || null,
    telegramChatId: row.telegram_chat_id ? String(row.telegram_chat_id) : null,
    preferences: row.preferences ?? {},
  }
}

/** Адрес, чат и настройки уведомлений. null — профиль не найден или БД недоступна. */
export async function getRecipient(userId: string): Promise<RecipientProfile | null> {
  try {
    const sb = createServiceClient()
    const primary = await sb
      .from('profiles')
      .select('id, email, full_name, telegram_chat_id, preferences')
      .eq('id', userId)
      .maybeSingle()
    // Колонки telegram_chat_id может не быть (045 не применена) — читаем без неё.
    const res = primary.error
      ? await sb.from('profiles').select('id, email, full_name, preferences').eq('id', userId).maybeSingle()
      : primary
    if (res.error || !res.data) return null
    return toRecipient(res.data as ProfileRow)
  } catch {
    return null
  }
}

/**
 * Сколько учитываемых в потолке касаний было у пользователя с `sinceIso`.
 * null — журнал недоступен (миграция 089 не применена): вызывающий трактует
 * это как «потолок достигнут», чтобы автоматика не спамила без журнала.
 */
export async function countCapTouches(userId: string, sinceIso: string): Promise<number | null> {
  try {
    const { count, error } = await createServiceClient()
      .from('automation_sends')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('counts_toward_cap', true)
      .gte('sent_at', sinceIso)
    if (error) return null
    return count ?? 0
  } catch {
    return null
  }
}

/**
 * 'claimed'     — this call sends;
 * 'duplicate'   — the key was used: the touch already went out;
 * 'in_flight'   — (pending claims only) another process holds a fresh claim of the key, or the
 *                 claim could not be checked: NOT delivered by this call — retry later;
 * 'unavailable' — no journal.
 */
export type ClaimResult = 'claimed' | 'duplicate' | 'in_flight' | 'unavailable'

export interface SendClaim {
  result: ClaimResult
  id: string | null
  /**
   * Only on a 'pending' claim: mark it 'sent' once a channel delivered. Until then a claim older
   * than STALE_SEND_CLAIM_MS is taken over by the next caller with the same key.
   */
  confirm?: () => Promise<boolean>
}

/**
 * A 'pending' claim older than this belongs to a process that died before it confirmed. Far above
 * one notifyClient: the e-mail (≤ ~95 s, lib/email/send.ts), the feed and Telegram in parallel.
 * The same window as the e-mail claim (lib/email/send.ts STALE_CLAIM_MS).
 */
export const STALE_SEND_CLAIM_MS = 10 * 60_000

/** PostgREST / Postgres: the column is not there (migration 158 not applied yet). */
function missingColumn(error: { code?: string } | null | undefined): boolean {
  return error?.code === 'PGRST204' || error?.code === '42703'
}

/**
 * Бронирует отправку в automation_sends. 'duplicate' — ключ уже использован.
 *
 * `pending: true` (notifyClient, R5 review M-2) — the claim is 'pending' until `confirm()`, like
 * the e-mail claim (lib/email/send.ts): a process that dies between the claim and the delivery no
 * longer loses the touch for good — a claim older than STALE_SEND_CLAIM_MS is taken over by ONE
 * caller (conditional UPDATE) and delivered; a fresh one is 'in_flight' (retryable). Without it
 * (staff digest, Point B) the row is final at insert, as before: the column default is 'sent'.
 * Before migration 158 (no status column) a pending claim falls back to the old meaning.
 */
export async function claimSend(input: {
  /** null — касание не конкретному пользователю (сводка администраторам). */
  userId: string | null
  kind: string
  dedupeKey: string | null
  countsTowardCap: boolean
  channels: string[]
  metadata?: Record<string, unknown>
  pending?: boolean
}): Promise<SendClaim> {
  try {
    const sb = createServiceClient()
    const row = {
      user_id: input.userId,
      kind: input.kind.slice(0, 64),
      dedupe_key: input.dedupeKey,
      counts_toward_cap: input.countsTowardCap,
      channels: input.channels,
      metadata: input.metadata ?? {},
    }
    const insert = (pending: boolean) =>
      sb.from('automation_sends').insert(pending ? { ...row, status: 'pending' } : row).select('id').single()
    // Two rounds: the conflicting row may vanish under us (nothing delivered — released).
    for (let round = 0; round < 2; round++) {
      let pending = Boolean(input.pending)
      let { data, error } = await insert(pending)
      if (error && pending && missingColumn(error as { code?: string })) {
        pending = false
        ;({ data, error } = await insert(false))
      }
      if (!error) {
        const id = (data as { id: string }).id
        return pending ? { result: 'claimed', id, confirm: () => confirmSend(id) } : { result: 'claimed', id }
      }
      if ((error as { code?: string }).code !== '23505') {
        console.warn(`[notify] журнал automation_sends недоступен: ${error.message}`)
        return { result: 'unavailable', id: null }
      }
      if (!pending || !input.dedupeKey) return { result: 'duplicate', id: null }
      const existing = await takeOverStaleSend(input.dedupeKey)
      if (existing === 'vanished') continue
      return existing
    }
    return { result: 'in_flight', id: null }
  } catch (e) {
    console.warn('[notify] журнал automation_sends недоступен:', e instanceof Error ? e.message : e)
    return { result: 'unavailable', id: null }
  }
}

/**
 * The key is taken. 'sent' — a duplicate. 'pending' older than STALE_SEND_CLAIM_MS — taken over
 * by a conditional UPDATE (of two racing callers exactly one gets a row back) and sent under the
 * same row. A fresh 'pending', a lost race, a read / write error — in flight (retryable).
 */
async function takeOverStaleSend(dedupeKey: string): Promise<SendClaim | 'vanished'> {
  try {
    const sb = createServiceClient()
    const { data, error } = await sb.from('automation_sends').select('id, status, claimed_at').eq('dedupe_key', dedupeKey).maybeSingle()
    if (error) return missingColumn(error as { code?: string }) ? { result: 'duplicate', id: null } : { result: 'in_flight', id: null }
    const row = data as { id: string; status?: string | null } | null
    if (!row) return 'vanished'
    if (row.status !== 'pending') return { result: 'duplicate', id: null }
    const { data: taken, error: takeError } = await sb
      .from('automation_sends')
      .update({ claimed_at: new Date().toISOString() })
      .eq('id', row.id)
      .eq('status', 'pending')
      .lt('claimed_at', new Date(Date.now() - STALE_SEND_CLAIM_MS).toISOString())
      .select('id')
    if (takeError || !taken || (taken as unknown[]).length === 0) return { result: 'in_flight', id: null }
    console.warn('[notify] бронь уведомления зависла (процесс не подтвердил доставку) — отправляем повторно')
    return { result: 'claimed', id: row.id, confirm: () => confirmSend(row.id) }
  } catch {
    return { result: 'in_flight', id: null }
  }
}

/**
 * A channel delivered: the claim is final ('sent'). The client returns its errors: checked,
 * retried once, then logged loudly — the claim then stays 'pending' and, after
 * STALE_SEND_CLAIM_MS, the next caller with the key takes it over and delivers again (the e-mail
 * is still sent once: email_deliveries keeps its own claim; the feed / Telegram may repeat).
 */
async function confirmSend(id: string): Promise<boolean> {
  let why = ''
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const { error } = await createServiceClient().from('automation_sends').update({ status: 'sent' }).eq('id', id)
      if (!error) return true
      why = error.message
    } catch (e) {
      why = e instanceof Error ? e.message : String(e)
    }
  }
  console.error(`[notify] automation_sends: доставку не удалось подтвердить (2 попытки): ${why} — бронь осталась pending; повтор после её устаревания отправит касание ещё раз`)
  return false
}

/**
 * Снимает бронь, если ни один канал не доставил сообщение — чтобы касание
 * могло уйти в следующий запуск, а не «сгорело» и не съело потолок.
 */
export async function releaseSend(id: string): Promise<void> {
  try {
    await createServiceClient().from('automation_sends').delete().eq('id', id)
  } catch {
    /* не критично */
  }
}
