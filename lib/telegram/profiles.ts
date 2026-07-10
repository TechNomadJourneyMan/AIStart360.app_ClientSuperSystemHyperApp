import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { TelegramMessage } from './private-bot'
import { hashTelegramLinkToken } from './private-bot'

export interface TelegramLinkedProfile {
  id: string
  email: string | null
  full_name: string | null
  telegram_chat_id: string | null
  telegram_user_id: string | null
  telegram_username: string | null
  telegram_linked_at: string | null
}

export function createTelegramAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error('[telegram] missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }

  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export async function findProfileByTelegramMessage(
  admin: SupabaseClient,
  message: TelegramMessage,
): Promise<TelegramLinkedProfile | null> {
  const chatId = String(message.chat.id)
  const telegramUserId = message.from?.id ? String(message.from.id) : null
  const filters = [`telegram_chat_id.eq.${chatId}`]

  if (telegramUserId) {
    filters.push(`telegram_user_id.eq.${telegramUserId}`)
  }

  const { data, error } = await admin
    .from('profiles')
    .select('id,email,full_name,telegram_chat_id,telegram_user_id,telegram_username,telegram_linked_at')
    .or(filters.join(','))
    .limit(1)

  if (error) {
    console.error('[telegram] profile lookup failed:', error)
    return null
  }

  return (data?.[0] as TelegramLinkedProfile | undefined) ?? null
}

export async function bindProfileByTelegramToken(
  admin: SupabaseClient,
  token: string,
  message: TelegramMessage,
): Promise<{ ok: true; profile: TelegramLinkedProfile } | { ok: false; reason: 'invalid_or_expired' | 'conflict' | 'error' }> {
  return bindProfileByTelegramIdentity(admin, token, {
    telegramChatId: String(message.chat.id),
    telegramUserId: message.from?.id ? String(message.from.id) : null,
    telegramUsername: message.from?.username ?? null,
  })
}

export async function bindProfileByTelegramIdentity(
  admin: SupabaseClient,
  token: string,
  identity: {
    telegramChatId?: string | null
    telegramUserId?: string | null
    telegramUsername?: string | null
  },
): Promise<{ ok: true; profile: TelegramLinkedProfile } | { ok: false; reason: 'invalid_or_expired' | 'conflict' | 'error' }> {
  const tokenHash = hashTelegramLinkToken(token)
  const now = new Date().toISOString()

  const { data, error } = await admin
    .from('profiles')
    .select('id,email,full_name,telegram_chat_id,telegram_user_id,telegram_username,telegram_linked_at')
    .eq('telegram_link_token_hash', tokenHash)
    .gt('telegram_link_token_expires_at', now)
    .limit(1)

  if (error) {
    console.error('[telegram] token lookup failed:', error)
    return { ok: false, reason: 'error' }
  }

  const profile = data?.[0] as TelegramLinkedProfile | undefined
  if (!profile) return { ok: false, reason: 'invalid_or_expired' }

  const { data: updated, error: updateError } = await admin
    .from('profiles')
    .update({
      telegram_chat_id: identity.telegramChatId ?? identity.telegramUserId ?? null,
      telegram_user_id: identity.telegramUserId ?? identity.telegramChatId ?? null,
      telegram_username: identity.telegramUsername ?? null,
      telegram_linked_at: now,
      telegram_link_token_hash: null,
      telegram_link_token_expires_at: null,
    })
    .eq('id', profile.id)
    .select('id,email,full_name,telegram_chat_id,telegram_user_id,telegram_username,telegram_linked_at')
    .single()

  if (updateError) {
    if (updateError.code === '23505') return { ok: false, reason: 'conflict' }
    console.error('[telegram] profile bind failed:', updateError)
    return { ok: false, reason: 'error' }
  }

  return { ok: true, profile: updated as TelegramLinkedProfile }
}

export async function findProfileByTelegramUserId(
  admin: SupabaseClient,
  telegramUserId: string,
): Promise<TelegramLinkedProfile | null> {
  const { data, error } = await admin
    .from('profiles')
    .select('id,email,full_name,telegram_chat_id,telegram_user_id,telegram_username,telegram_linked_at')
    .eq('telegram_user_id', telegramUserId)
    .maybeSingle()

  if (error) {
    console.error('[telegram] profile by user id lookup failed:', error)
    return null
  }

  return (data as TelegramLinkedProfile | null) ?? null
}

export async function unlinkProfileTelegram(
  admin: SupabaseClient,
  profileId: string,
): Promise<boolean> {
  const { error } = await admin
    .from('profiles')
    .update({
      telegram_chat_id: null,
      telegram_user_id: null,
      telegram_username: null,
      telegram_linked_at: null,
      telegram_link_token_hash: null,
      telegram_link_token_expires_at: null,
    })
    .eq('id', profileId)

  if (error) {
    console.error('[telegram] unlink failed:', error)
    return false
  }

  return true
}
