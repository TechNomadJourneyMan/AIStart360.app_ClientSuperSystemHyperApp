import type { NormalizedOmnichannelMessage } from './types'
import {
  createMetaClient,
  INSTAGRAM_GRAPH_ORIGIN,
  type MetaClientOptions,
  type MetaEnvironment,
  type MetaFetch,
} from './meta-client'

export const DEFAULT_INSTAGRAM_BACKFILL_CONVERSATION_LIMIT = 25
export const MAX_INSTAGRAM_BACKFILL_MESSAGE_DETAILS = 20
export const MAX_INSTAGRAM_BACKFILL_NESTED_MESSAGE_PAGES = 25
export const INSTAGRAM_BACKFILL_REQUEST_INTERVAL_MS = 500

export type BackfillSleep = (milliseconds: number) => Promise<void>

export interface InstagramBackfillOptions {
  env?: MetaEnvironment
  fetch?: MetaFetch
  fetchImpl?: MetaFetch
  sleep?: BackfillSleep
  graphApiVersion?: string
  timeoutMs?: number
  /** May lower or raise the per-run conversation cap; defaults to 25. */
  maxConversations?: number
  /** Provider message ids already persisted by earlier batches. */
  excludeMessageIds?: Iterable<string>
  /** Sanitized top-level conversations page returned by an earlier batch. */
  conversationPage?: string
}

export interface InstagramBackfillSuccess {
  ok: true
  conversationsScanned: number
  messagesFetched: number
  messages: NormalizedOmnichannelMessage[]
  partialErrors: string[]
  truncated: boolean
  /** Page actually scanned by this batch, used for cross-batch loop guards. */
  conversationPage: string
  /** Current page again while it has work, otherwise the next provider page. */
  nextConversationPage: string | null
}

export interface InstagramBackfillFailure {
  ok: false
  error: string
}

export type InstagramBackfillResult = InstagramBackfillSuccess | InstagramBackfillFailure

export interface WhatsAppHistoryUnsupportedResult {
  ok: false
  unsupported: true
  code: 'whatsapp_history_unsupported'
  reason: 'cloud_api_has_no_history_endpoint'
  error: string
}

interface GraphActor {
  id: string
  username: string | null
}

interface MessageCandidate {
  id: string
  conversationProviderId: string
  createdTimeHint: string | null
  discoveryOrder: number
}

interface ConversationPage {
  data?: unknown
  paging?: unknown
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function positiveInteger(value: unknown, fallback: number, maximum: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(Math.trunc(parsed), maximum)
}

function conversationLimit(options: InstagramBackfillOptions, env: MetaEnvironment): number {
  const configured =
    options.maxConversations ??
    env.INSTAGRAM_BACKFILL_MAX_CONVERSATIONS ??
    env.INSTAGRAM_BACKFILL_CONVERSATION_LIMIT ??
    env.OMNICHANNEL_INSTAGRAM_BACKFILL_LIMIT
  return positiveInteger(configured, DEFAULT_INSTAGRAM_BACKFILL_CONVERSATION_LIMIT, 100)
}

function sanitizedPagingTarget(value: unknown): string | null {
  const next = asNonEmptyString(value)
  if (!next) return null
  try {
    const isAbsolute = /^https?:\/\//iu.test(next)
    const url = new URL(next, INSTAGRAM_GRAPH_ORIGIN)
    // Provider paging URLs sometimes echo the token. Authentication is added
    // by MetaClient, so continuation state must never persist that query value.
    url.searchParams.delete('access_token')
    return isAbsolute
      ? url.toString()
      : `${url.pathname}${url.search}${url.hash}`
  } catch {
    // Malformed provider paths are still rejected by MetaClient when fetched.
    return next
  }
}

function pagingNext(value: unknown): string | null {
  return sanitizedPagingTarget(asRecord(value)?.next)
}

function messageRefs(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  const record = asRecord(value)
  return Array.isArray(record?.data) ? record.data : []
}

function parseTime(value: string | null): number | null {
  if (!value) return null
  const milliseconds = new Date(value).getTime()
  return Number.isFinite(milliseconds) ? milliseconds : null
}

function normalizedOccurredAt(value: unknown): string | null {
  const raw = asNonEmptyString(value)
  if (!raw) return null
  const milliseconds = new Date(raw).getTime()
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null
}

function actor(value: unknown): GraphActor | null {
  const record = asRecord(value)
  const id = asNonEmptyString(record?.id)
  if (!id) return null
  return {
    id,
    username:
      asNonEmptyString(record?.username) ??
      asNonEmptyString(record?.name),
  }
}

function recipients(value: unknown): GraphActor[] {
  const raw = Array.isArray(value)
    ? value
    : Array.isArray(asRecord(value)?.data)
      ? (asRecord(value)?.data as unknown[])
      : []
  return raw.map(actor).filter((entry): entry is GraphActor => entry !== null)
}

function normalizeDetail(input: {
  detail: Record<string, unknown>
  accountId: string
  conversationProviderId: string
}): { message: NormalizedOmnichannelMessage | null; error?: string } {
  const externalMessageId = asNonEmptyString(input.detail.id)
  if (!externalMessageId) {
    return { message: null, error: 'message detail did not include id' }
  }

  const sender = actor(input.detail.from)
  const targets = recipients(input.detail.to)
  let direction: 'in' | 'out'
  let contact: GraphActor | null

  if (sender?.id === input.accountId) {
    direction = 'out'
    contact = targets.find((target) => target.id !== input.accountId) ?? null
  } else if (sender) {
    direction = 'in'
    contact = sender
  } else {
    direction = 'in'
    contact = null
  }

  if (!contact?.id) {
    return {
      message: null,
      error: `message ${externalMessageId} did not include a contact Instagram-scoped ID`,
    }
  }

  const text = typeof input.detail.message === 'string' ? input.detail.message : null
  const metadata: NormalizedOmnichannelMessage['metadata'] = {
    provider: 'meta',
    source: 'instagram_conversations_backfill',
    providerConversationId: input.conversationProviderId,
    ...(direction === 'out' ? { historicalOutbound: true } : {}),
  }

  return {
    message: {
      eventType: 'message',
      channel: 'instagram',
      accountExternalId: input.accountId,
      // A provider thread ID may change; the IGSID remains the stable contact key.
      conversationExternalId: contact.id,
      contactExternalId: contact.id,
      contactName: contact.username,
      externalMessageId,
      direction,
      messageType: text === null ? 'unknown' : 'text',
      text,
      status: 'imported',
      replyToExternalId: null,
      occurredAt: normalizedOccurredAt(input.detail.created_time),
      metadata,
    },
  }
}

function chronological(messages: NormalizedOmnichannelMessage[]): NormalizedOmnichannelMessage[] {
  return messages.sort((left, right) => {
    const leftTime = parseTime(left.occurredAt)
    const rightTime = parseTime(right.occurredAt)
    if (leftTime !== null && rightTime !== null && leftTime !== rightTime) {
      return leftTime - rightTime
    }
    if (leftTime !== null && rightTime === null) return -1
    if (leftTime === null && rightTime !== null) return 1
    return left.externalMessageId.localeCompare(right.externalMessageId)
  })
}

function newestCandidates(candidates: MessageCandidate[]): MessageCandidate[] {
  const deduplicated = new Map<string, MessageCandidate>()
  for (const candidate of candidates) {
    if (!deduplicated.has(candidate.id)) deduplicated.set(candidate.id, candidate)
  }

  return [...deduplicated.values()]
    .sort((left, right) => {
      const leftTime = parseTime(left.createdTimeHint)
      const rightTime = parseTime(right.createdTimeHint)
      if (leftTime !== null && rightTime !== null && leftTime !== rightTime) {
        return rightTime - leftTime
      }
      // Meta returns conversations and their messages newest-first; keep that
      // provider order when lightweight refs do not include created_time.
      return left.discoveryOrder - right.discoveryOrder
    })
}

/**
 * Imports a deliberately small Instagram history window. It only reads Meta;
 * persistence, AI analysis and sending are intentionally left to the caller.
 */
export async function backfillInstagramConversations(
  options: InstagramBackfillOptions = {},
): Promise<InstagramBackfillResult> {
  const env = options.env ?? process.env
  const accountId = asNonEmptyString(env.INSTAGRAM_ACCOUNT_ID)
  if (!accountId || !asNonEmptyString(env.INSTAGRAM_ACCESS_TOKEN)) {
    return {
      ok: false,
      error: 'Instagram backfill is not configured (INSTAGRAM_ACCESS_TOKEN and INSTAGRAM_ACCOUNT_ID are required)',
    }
  }

  const clientOptions: MetaClientOptions = {
    env,
    fetch: options.fetch,
    fetchImpl: options.fetchImpl,
    graphApiVersion: options.graphApiVersion,
    timeoutMs: options.timeoutMs,
  }
  const client = createMetaClient(clientOptions)
  const sleep = options.sleep ?? defaultSleep
  const maxConversations = conversationLimit(options, env)
  const partialErrors: string[] = []
  const candidates: MessageCandidate[] = []
  const excluded = new Set(options.excludeMessageIds ?? [])
  const availableCandidateIds = new Set<string>()
  const nestedPages: Array<{ conversationProviderId: string; page: string }> = []
  const seenPageUrls = new Set<string>()
  let requestCount = 0
  let conversationsScanned = 0
  let discoveryOrder = 0
  let truncated = false

  const addMessageRefs = (value: unknown, conversationProviderId: string) => {
    for (const rawRef of messageRefs(value)) {
      const ref = asRecord(rawRef)
      const id = asNonEmptyString(ref?.id)
      if (!id) {
        partialErrors.push(`Conversation ${conversationProviderId} contained a message without id`)
        continue
      }
      candidates.push({
        id,
        conversationProviderId,
        createdTimeHint: asNonEmptyString(ref?.created_time),
        discoveryOrder,
      })
      discoveryOrder += 1
      if (!excluded.has(id)) availableCandidateIds.add(id)
    }
  }

  const throttledGet = async <T>(pathOrUrl: string) => {
    if (requestCount > 0) {
      await sleep(INSTAGRAM_BACKFILL_REQUEST_INTERVAL_MS)
    }
    requestCount += 1
    return client.getInstagramJson<T>(pathOrUrl)
  }

  const initialParams = new URLSearchParams({
    platform: 'instagram',
    fields: 'messages',
    limit: String(Math.min(maxConversations, 25)),
  })
  const defaultConversationPage = `${encodeURIComponent(accountId)}/conversations?${initialParams}`
  const conversationPage = sanitizedPagingTarget(options.conversationPage)
    ?? defaultConversationPage
  let nextPage: string | null = conversationPage
  let nextTopLevelPage: string | null = null

  while (nextPage && conversationsScanned < maxConversations) {
    if (seenPageUrls.has(nextPage)) {
      partialErrors.push('Instagram conversations pagination repeated the same page URL')
      truncated = true
      break
    }
    seenPageUrls.add(nextPage)

    const pageResult = await throttledGet<ConversationPage>(nextPage)
    if (!pageResult.ok) {
      if (conversationsScanned === 0) {
        return { ok: false, error: `Instagram conversations request failed: ${pageResult.message}` }
      }
      partialErrors.push(`Instagram conversations pagination failed: ${pageResult.message}`)
      truncated = true
      nextTopLevelPage = nextPage
      break
    }

    const page = asRecord(pageResult.data)
    const conversations = Array.isArray(page?.data) ? page.data : []
    const remaining = maxConversations - conversationsScanned
    const selected = conversations.slice(0, remaining)
    if (conversations.length > selected.length) truncated = true

    for (const rawConversation of selected) {
      const conversation = asRecord(rawConversation)
      const conversationProviderId = asNonEmptyString(conversation?.id)
      if (!conversationProviderId) {
        partialErrors.push('Instagram conversation did not include id')
        continue
      }

      conversationsScanned += 1
      const embeddedMessages = asRecord(conversation?.messages)
      addMessageRefs(embeddedMessages, conversationProviderId)
      const nestedNext = pagingNext(embeddedMessages?.paging)
      if (nestedNext) {
        nestedPages.push({ conversationProviderId, page: nestedNext })
      }
    }

    const providerNext = pagingNext(page?.paging)
    if (conversationsScanned >= maxConversations && providerNext) {
      truncated = true
      nextTopLevelPage = providerNext
      break
    }
    nextPage = providerNext
  }

  const seenNestedPageUrls = new Set<string>()
  let nestedPageRequests = 0
  let nestedPaginationIncomplete = false
  while (
    nestedPages.length > 0
    && availableCandidateIds.size < MAX_INSTAGRAM_BACKFILL_MESSAGE_DETAILS
    && nestedPageRequests < MAX_INSTAGRAM_BACKFILL_NESTED_MESSAGE_PAGES
  ) {
    const nested = nestedPages.shift()!
    if (seenNestedPageUrls.has(nested.page)) {
      partialErrors.push(
        `Instagram messages pagination repeated a page URL for conversation ${nested.conversationProviderId}`,
      )
      nestedPaginationIncomplete = true
      continue
    }
    seenNestedPageUrls.add(nested.page)
    nestedPageRequests += 1

    const nestedResult = await throttledGet<ConversationPage>(nested.page)
    if (!nestedResult.ok) {
      partialErrors.push(
        `Instagram messages pagination failed for conversation ${nested.conversationProviderId}: ${nestedResult.message}`,
      )
      nestedPaginationIncomplete = true
      continue
    }

    const nestedPage = asRecord(nestedResult.data)
    addMessageRefs(nestedPage, nested.conversationProviderId)
    const nestedNext = pagingNext(nestedPage?.paging)
    if (nestedNext) {
      nestedPages.push({
        conversationProviderId: nested.conversationProviderId,
        page: nestedNext,
      })
    }
  }

  if (
    nestedPages.length > 0
    && nestedPageRequests >= MAX_INSTAGRAM_BACKFILL_NESTED_MESSAGE_PAGES
  ) {
    partialErrors.push(
      `Instagram nested message pagination was capped at ${MAX_INSTAGRAM_BACKFILL_NESTED_MESSAGE_PAGES} pages for this batch`,
    )
  }
  const nestedHistoryRemaining = nestedPages.length > 0 || nestedPaginationIncomplete

  const remainingCandidates = newestCandidates(candidates)
    .filter((candidate) => !excluded.has(candidate.id))
  const detailCandidates = remainingCandidates.slice(0, MAX_INSTAGRAM_BACKFILL_MESSAGE_DETAILS)
  const detailCandidatesRemain = remainingCandidates.length > detailCandidates.length
  if (detailCandidatesRemain) {
    truncated = true
    partialErrors.push(
      `Instagram message detail import was capped at ${MAX_INSTAGRAM_BACKFILL_MESSAGE_DETAILS} new IDs; ${remainingCandidates.length - detailCandidates.length} accessible IDs remain for the next batch`,
    )
  }

  const messages: NormalizedOmnichannelMessage[] = []
  let messagesFetched = 0
  for (const candidate of detailCandidates) {
    const detailParams = new URLSearchParams({
      fields: 'id,created_time,from,to,message',
    })
    const detailResult = await throttledGet<Record<string, unknown>>(
      `${encodeURIComponent(candidate.id)}?${detailParams}`,
    )
    if (!detailResult.ok) {
      partialErrors.push(`Instagram message ${candidate.id} failed: ${detailResult.message}`)
      continue
    }
    messagesFetched += 1

    const detail = asRecord(detailResult.data)
    if (!detail) {
      partialErrors.push(`Instagram message ${candidate.id} returned an invalid detail object`)
      continue
    }
    const normalized = normalizeDetail({
      detail,
      accountId,
      conversationProviderId: candidate.conversationProviderId,
    })
    if (normalized.message) messages.push(normalized.message)
    if (normalized.error) partialErrors.push(normalized.error)
  }

  // Finish all accessible work from the current conversation page before
  // advancing. The workflow excludes persisted IDs on the next pass, so this
  // safely drains >20 messages without skipping the provider's next page.
  const nextConversationPage = detailCandidatesRemain || nestedHistoryRemaining
    ? conversationPage
    : nextTopLevelPage
  if (nextConversationPage) truncated = true

  return {
    ok: true,
    conversationsScanned,
    messagesFetched,
    messages: chronological(messages),
    partialErrors,
    truncated,
    conversationPage,
    nextConversationPage,
  }
}

/** WhatsApp Cloud API exposes new messages via webhooks, not a normal history endpoint. */
export async function getWhatsAppHistory(): Promise<WhatsAppHistoryUnsupportedResult> {
  return {
    ok: false,
    unsupported: true,
    code: 'whatsapp_history_unsupported',
    reason: 'cloud_api_has_no_history_endpoint',
    error:
      'WhatsApp Cloud API does not provide a normal message-history endpoint; ingest new messages from signed webhooks instead.',
  }
}

export const backfillInstagramHistory = backfillInstagramConversations
export const fetchWhatsAppHistory = getWhatsAppHistory
export const backfillWhatsAppHistory = getWhatsAppHistory
