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

export type ClaimResult = 'claimed' | 'duplicate' | 'unavailable'

/** Бронирует отправку в automation_sends. 'duplicate' — ключ уже использован. */
export async function claimSend(input: {
  /** null — касание не конкретному пользователю (сводка администраторам). */
  userId: string | null
  kind: string
  dedupeKey: string | null
  countsTowardCap: boolean
  channels: string[]
  metadata?: Record<string, unknown>
}): Promise<{ result: ClaimResult; id: string | null }> {
  try {
    const { data, error } = await createServiceClient()
      .from('automation_sends')
      .insert({
        user_id: input.userId,
        kind: input.kind.slice(0, 64),
        dedupe_key: input.dedupeKey,
        counts_toward_cap: input.countsTowardCap,
        channels: input.channels,
        metadata: input.metadata ?? {},
      })
      .select('id')
      .single()
    if (error) {
      if ((error as { code?: string }).code === '23505') return { result: 'duplicate', id: null }
      console.warn(`[notify] журнал automation_sends недоступен: ${error.message}`)
      return { result: 'unavailable', id: null }
    }
    return { result: 'claimed', id: (data as { id: string }).id }
  } catch (e) {
    console.warn('[notify] журнал automation_sends недоступен:', e instanceof Error ? e.message : e)
    return { result: 'unavailable', id: null }
  }
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
