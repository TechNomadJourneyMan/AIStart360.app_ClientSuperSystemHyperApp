import type { SupabaseClient } from '@supabase/supabase-js'
import type { TelegramClient } from 'telegram'
import { answerUserQuestion } from '@/lib/assistant/answer'
import { buildAssistantContext } from '@/lib/assistant/context'
import { createExpertCase } from '@/lib/assistant/escalation/adapter'
import {
  buildEscalatedText,
  buildHelpText,
  buildUnlinkedText,
  extractTelegramLinkToken,
  localeFromTelegramUser,
  parseTelegramCommand,
  splitTelegramText,
} from '@/lib/telegram/private-bot'
import {
  bindProfileByTelegramIdentity,
  createTelegramAdminClient,
  findProfileByTelegramUserId,
  unlinkProfileTelegram,
  type TelegramLinkedProfile,
} from '@/lib/telegram/profiles'
import {
  createTelegramPersonalClient,
  disconnectTelegramPersonalClient,
} from '@/lib/telegram/personal-client'

interface TelegramPersonalChatRow {
  telegram_user_id: string
  linked_profile_id: string | null
  last_processed_message_id: number | null
  muted: boolean | null
}

interface TelegramPersonalIdentity {
  id: string
  username: string | null
  firstName: string | null
  lastName: string | null
  languageCode: string | null
}

interface IncomingPersonalMessage {
  id: number
  text: string
  entity: unknown
  identity: TelegramPersonalIdentity
  firstSeenChat: boolean
}

export interface TelegramPersonalSyncResult {
  ok: true
  scannedDialogs: number
  processedMessages: number
  linkedProfiles: number
  repliedMessages: number
  ignoredMessages: number
}

function intEnv(name: string, fallback: number): number {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

function identityFromEntity(entity: any): TelegramPersonalIdentity | null {
  if (!entity || entity.className !== 'User' || entity.bot || entity.self || entity.deleted) {
    return null
  }

  const id = entity.id?.toString?.() ?? String(entity.id ?? '')
  if (!id) return null

  return {
    id,
    username: entity.username ?? null,
    firstName: entity.firstName ?? null,
    lastName: entity.lastName ?? null,
    languageCode: entity.langCode ?? null,
  }
}

function telegramUserForLocale(identity: TelegramPersonalIdentity) {
  return {
    id: Number(identity.id),
    username: identity.username ?? undefined,
    first_name: identity.firstName ?? undefined,
    last_name: identity.lastName ?? undefined,
    language_code: identity.languageCode ?? undefined,
  }
}

async function getChatState(
  admin: SupabaseClient,
  identity: TelegramPersonalIdentity,
): Promise<TelegramPersonalChatRow | null> {
  const { data, error } = await admin
    .from('telegram_personal_chats')
    .select('telegram_user_id,linked_profile_id,last_processed_message_id,muted')
    .eq('telegram_user_id', identity.id)
    .maybeSingle()

  if (error) {
    console.error('[telegram/personal-sync] chat state lookup failed:', error)
    return null
  }

  return (data as TelegramPersonalChatRow | null) ?? null
}

async function upsertChatState(
  admin: SupabaseClient,
  identity: TelegramPersonalIdentity,
  patch: Partial<TelegramPersonalChatRow> = {},
): Promise<void> {
  const { error } = await admin.from('telegram_personal_chats').upsert(
    {
      telegram_user_id: identity.id,
      username: identity.username,
      first_name: identity.firstName,
      last_name: identity.lastName,
      ...patch,
    },
    { onConflict: 'telegram_user_id' },
  )

  if (error) {
    console.error('[telegram/personal-sync] chat state upsert failed:', error)
  }
}

async function setLastProcessed(
  admin: SupabaseClient,
  identity: TelegramPersonalIdentity,
  messageId: number,
  patch: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await admin
    .from('telegram_personal_chats')
    .update({
      ...patch,
      last_processed_message_id: messageId,
      last_incoming_at: new Date().toISOString(),
    })
    .eq('telegram_user_id', identity.id)

  if (error) {
    console.error('[telegram/personal-sync] last_processed update failed:', error)
  }
}

async function insertMessageLog(
  admin: SupabaseClient,
  message: IncomingPersonalMessage,
  status: 'processing' | 'linked' | 'replied' | 'ignored' | 'failed',
  extra: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await admin.from('telegram_personal_messages').upsert(
    {
      telegram_user_id: message.identity.id,
      telegram_message_id: message.id,
      direction: 'in',
      text: message.text.slice(0, 4000),
      status,
      processed_at: new Date().toISOString(),
      ...extra,
    },
    { onConflict: 'telegram_user_id,telegram_message_id,direction' },
  )

  if (error) {
    console.error('[telegram/personal-sync] message log insert failed:', error)
  }
}

async function sendPersonalMessage(
  client: TelegramClient,
  entity: unknown,
  text: string,
  replyTo?: number,
): Promise<number | null> {
  let lastId: number | null = null

  for (const chunk of splitTelegramText(text)) {
    const sent = await (client as any).sendMessage(entity, {
      message: chunk,
      replyTo,
    })
    const id = Number((sent as any)?.id)
    if (Number.isFinite(id)) lastId = id
  }

  return lastId
}

async function handleLinkCode(
  admin: SupabaseClient,
  client: TelegramClient,
  message: IncomingPersonalMessage,
  token: string,
): Promise<'linked' | 'invalid'> {
  const locale = localeFromTelegramUser(telegramUserForLocale(message.identity))
  const result = await bindProfileByTelegramIdentity(admin, token, {
    telegramChatId: message.identity.id,
    telegramUserId: message.identity.id,
    telegramUsername: message.identity.username,
  })

  if (!result.ok) {
    await sendPersonalMessage(
      client,
      message.entity,
      locale === 'en'
        ? 'The code is invalid or expired. Generate a fresh Telegram code in AIStart360 settings.'
        : 'Код недействителен или истёк. Создайте новый Telegram-код в настройках AIStart360.',
      message.id,
    )
    await insertMessageLog(admin, message, 'ignored', { error: result.reason })
    await setLastProcessed(admin, message.identity, message.id)
    return 'invalid'
  }

  await upsertChatState(admin, message.identity, {
    linked_profile_id: result.profile.id,
    last_processed_message_id: message.id,
  })

  const name = result.profile.full_name?.trim()
  await sendPersonalMessage(
    client,
    message.entity,
    locale === 'en'
      ? `Telegram is linked${name ? ` to ${name}` : ''}.\n\n${buildHelpText(locale)}`
      : `Telegram привязан${name ? ` к профилю ${name}` : ''}.\n\n${buildHelpText(locale)}`,
    message.id,
  )

  await insertMessageLog(admin, message, 'linked', { linked_profile_id: result.profile.id })
  return 'linked'
}

async function handleLinkedMessage(
  admin: SupabaseClient,
  client: TelegramClient,
  message: IncomingPersonalMessage,
  profile: TelegramLinkedProfile,
): Promise<'replied' | 'ignored'> {
  const locale = localeFromTelegramUser(telegramUserForLocale(message.identity))
  const command = parseTelegramCommand(message.text)

  if (command?.command === 'help') {
    await sendPersonalMessage(client, message.entity, buildHelpText(locale), message.id)
    await insertMessageLog(admin, message, 'replied', { linked_profile_id: profile.id })
    await setLastProcessed(admin, message.identity, message.id)
    return 'replied'
  }

  if (command?.command === 'unlink') {
    await unlinkProfileTelegram(admin, profile.id)
    await upsertChatState(admin, message.identity, {
      linked_profile_id: null,
      last_processed_message_id: message.id,
    })
    await sendPersonalMessage(
      client,
      message.entity,
      locale === 'en' ? 'Telegram chat is disconnected.' : 'Telegram-чат отвязан.',
      message.id,
    )
    await insertMessageLog(admin, message, 'replied', { linked_profile_id: profile.id })
    return 'replied'
  }

  if (command) {
    await sendPersonalMessage(client, message.entity, buildHelpText(locale), message.id)
    await insertMessageLog(admin, message, 'ignored', { linked_profile_id: profile.id })
    await setLastProcessed(admin, message.identity, message.id)
    return 'ignored'
  }

  const ctx = await buildAssistantContext(profile.id, admin)
  const result = await answerUserQuestion(ctx, message.text, locale)
  const mustEscalate =
    result == null ||
    !result.can_answer ||
    result.needs_expert ||
    result.confidence === 'low'

  let reply: string
  if (mustEscalate) {
    await createExpertCase(ctx, {
      triggerType: 'user_requested_help',
      userMessage: message.text,
      assistantRecommendation: result?.answer || undefined,
    })
    reply = buildEscalatedText(result?.answer, locale)
  } else {
    reply = result.answer
  }

  const sentMessageId = await sendPersonalMessage(client, message.entity, reply, message.id)
  await insertMessageLog(admin, message, 'replied', {
    linked_profile_id: profile.id,
    reply_text: reply.slice(0, 4000),
    reply_message_id: sentMessageId,
  })
  await setLastProcessed(admin, message.identity, message.id, { last_outgoing_at: new Date().toISOString() })
  return 'replied'
}

async function collectIncomingMessages(
  client: TelegramClient,
  admin: SupabaseClient,
): Promise<{ messages: IncomingPersonalMessage[]; scannedDialogs: number; ignored: number }> {
  const dialogLimit = intEnv('TELEGRAM_PERSONAL_DIALOG_LIMIT', 40)
  const messagesPerDialog = intEnv('TELEGRAM_PERSONAL_MESSAGES_PER_DIALOG', 5)
  const dialogs = (await (client as any).getDialogs({ limit: dialogLimit })) as any[]
  const incoming: IncomingPersonalMessage[] = []
  let ignored = 0

  for (const dialog of dialogs) {
    const identity = identityFromEntity(dialog.entity)
    if (!identity) {
      ignored++
      continue
    }

    const messages = (await (client as any).getMessages(dialog.entity, {
      limit: messagesPerDialog,
    })) as any[]

    const inbox = messages
      .filter((m) => m && !m.out && Number.isFinite(Number(m.id)))
      .map((m) => ({ id: Number(m.id), text: String(m.message ?? '').trim(), entity: dialog.entity }))
      .filter((m) => m.text.length > 0)
      .sort((a, b) => a.id - b.id)

    if (inbox.length === 0) continue

    const state = await getChatState(admin, identity)
    const firstSeenChat = !state
    const lastProcessed = Number(state?.last_processed_message_id ?? 0)
    const latestIncomingId = inbox[inbox.length - 1]?.id ?? lastProcessed

    await upsertChatState(admin, identity, {
      linked_profile_id: state?.linked_profile_id ?? null,
      last_processed_message_id: firstSeenChat ? latestIncomingId : lastProcessed,
    })

    for (const message of inbox) {
      const linkToken = extractTelegramLinkToken(message.text)
      if (firstSeenChat && !linkToken) continue
      if (!firstSeenChat && message.id <= lastProcessed) continue
      incoming.push({ ...message, identity, firstSeenChat })
    }
  }

  return { messages: incoming, scannedDialogs: dialogs.length, ignored }
}

export async function syncTelegramPersonalInbox(): Promise<TelegramPersonalSyncResult> {
  const admin = createTelegramAdminClient()
  const client = await createTelegramPersonalClient()
  const maxMessages = intEnv('TELEGRAM_PERSONAL_MAX_MESSAGES_PER_RUN', 20)

  let scannedDialogs = 0
  let processedMessages = 0
  let linkedProfiles = 0
  let repliedMessages = 0
  let ignoredMessages = 0

  try {
    const collected = await collectIncomingMessages(client, admin)
    scannedDialogs = collected.scannedDialogs
    ignoredMessages += collected.ignored

    for (const message of collected.messages.slice(0, maxMessages)) {
      processedMessages++

      try {
        const linkToken = extractTelegramLinkToken(message.text)
        if (linkToken) {
          const status = await handleLinkCode(admin, client, message, linkToken)
          if (status === 'linked') linkedProfiles++
          else ignoredMessages++
          continue
        }

        const profile = await findProfileByTelegramUserId(admin, message.identity.id)
        if (!profile) {
          await insertMessageLog(admin, message, 'ignored')
          await setLastProcessed(admin, message.identity, message.id)
          ignoredMessages++
          continue
        }

        const status = await handleLinkedMessage(admin, client, message, profile)
        if (status === 'replied') repliedMessages++
        else ignoredMessages++
      } catch (error) {
        console.error('[telegram/personal-sync] message processing failed:', error)
        await insertMessageLog(admin, message, 'failed', {
          error: error instanceof Error ? error.message : String(error),
        })
        await setLastProcessed(admin, message.identity, message.id)
        ignoredMessages++
      }
    }

    return {
      ok: true,
      scannedDialogs,
      processedMessages,
      linkedProfiles,
      repliedMessages,
      ignoredMessages,
    }
  } finally {
    await disconnectTelegramPersonalClient(client)
  }
}
