function positiveInteger(name, value) {
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive integer`)
  }
  return value
}

function safeCountAdd(left, right) {
  return Math.min(Number.MAX_SAFE_INTEGER, left + right)
}

function historyTimestampMs(value) {
  let seconds
  try {
    if (typeof value === 'bigint') seconds = Number(value)
    else if (typeof value === 'number') seconds = value
    else if (value && typeof value.toNumber === 'function') seconds = value.toNumber()
    else seconds = Number(value)
  } catch {
    return null
  }
  if (!Number.isFinite(seconds) || seconds <= 0) return null
  const milliseconds = Math.trunc(seconds * 1000)
  return Number.isSafeInteger(milliseconds) ? milliseconds : null
}

function isOneToOneHistoryJid(value) {
  return (
    typeof value === 'string' &&
    /^[A-Za-z0-9._:-]{1,128}@(s\.whatsapp\.net|lid)$/.test(value)
  )
}

function isProviderMessageId(value) {
  return (
    typeof value === 'string' &&
    /^[A-Za-z0-9._:/+=-]{1,256}$/.test(value)
  )
}

function hasImportableContent(rawContent) {
  let current = rawContent
  for (let depth = 0; depth < 5; depth += 1) {
    if (!current || typeof current !== 'object') return false
    if (current.protocolMessage) return false
    const wrapped =
      current.ephemeralMessage?.message ??
      current.viewOnceMessage?.message ??
      current.viewOnceMessageV2?.message ??
      current.viewOnceMessageV2Extension?.message
    if (!wrapped) return true
    current = wrapped
  }
  return false
}

function clampedUnreadCount(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(value)))
}

function chatAliases(chat) {
  return [chat?.id, chat?.lidJid, chat?.pnJid].filter(isOneToOneHistoryJid)
}

function mappingAliases(mapping) {
  return [
    mapping?.lid,
    mapping?.pn,
    mapping?.lidJid,
    mapping?.pnJid,
  ].filter(isOneToOneHistoryJid)
}

function createAliasGroups() {
  const parent = new Map()

  const add = (value) => {
    if (!parent.has(value)) parent.set(value, value)
  }
  const find = (value) => {
    add(value)
    let root = value
    while (parent.get(root) !== root) root = parent.get(root)
    let current = value
    while (parent.get(current) !== root) {
      const next = parent.get(current)
      parent.set(current, root)
      current = next
    }
    return root
  }
  const union = (left, right) => {
    const leftRoot = find(left)
    const rightRoot = find(right)
    if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot)
  }
  const addAliases = (aliases) => {
    if (aliases.length === 0) return
    for (const alias of aliases) add(alias)
    for (const alias of aliases.slice(1)) union(aliases[0], alias)
  }

  return { addAliases, find }
}

function createHistoryAliasContext({ chats, messages, lidPnMappings }) {
  const aliasGroups = createAliasGroups()
  const knownAliases = new Set()
  const register = (aliases) => {
    aliasGroups.addAliases(aliases)
    for (const alias of aliases) knownAliases.add(alias)
  }

  for (const chat of chats) register(chatAliases(chat))
  for (const mapping of lidPnMappings) register(mappingAliases(mapping))
  for (const message of messages) {
    register(
      [message?.key?.remoteJid, message?.key?.remoteJidAlt]
        .filter(isOneToOneHistoryJid),
    )
  }

  const aliasesByRoot = new Map()
  for (const alias of knownAliases) {
    const root = aliasGroups.find(alias)
    const aliases = aliasesByRoot.get(root) ?? []
    aliases.push(alias)
    aliasesByRoot.set(root, aliases)
  }
  return { aliasGroups, aliasesByRoot }
}

function emptyUnreadMetrics({ chats = 0, messages = 0, partial = true } = {}) {
  return {
    partial,
    received: { chats, messages },
    unread: {
      declared: 0,
      candidates: 0,
      selected: 0,
      missing: 0,
    },
    filtered: {
      messages: messages,
      unread: 0,
      duplicates: 0,
    },
  }
}

function analyzeUnreadHistoryMessages({ chats, messages, lidPnMappings = [] }) {
  if (!Array.isArray(chats) || !Array.isArray(messages)) {
    return { selected: [], metrics: emptyUnreadMetrics() }
  }
  const mappings = Array.isArray(lidPnMappings) ? lidPnMappings : []
  const { aliasGroups, aliasesByRoot } = createHistoryAliasContext({
    chats,
    messages,
    lidPnMappings: mappings,
  })
  const chatRows = []
  for (const chat of chats) {
    const id = chat?.id
    const unreadCount = clampedUnreadCount(chat?.unreadCount)
    if (!isOneToOneHistoryJid(id) || unreadCount === null) continue
    chatRows.push({ id, unreadCount })
  }
  if (chatRows.length === 0) {
    return {
      selected: [],
      metrics: emptyUnreadMetrics({ chats: chats.length, messages: messages.length }),
    }
  }

  const chatRecords = new Map()
  for (const row of chatRows) {
    const root = aliasGroups.find(row.id)
    const existing = chatRecords.get(root)
    if (existing) {
      // Duplicate metadata can arrive in separate chunks and under PN/LID
      // aliases. The minimum, including zero, is the only fail-closed quota.
      existing.unreadCount = Math.min(existing.unreadCount, row.unreadCount)
    } else {
      chatRecords.set(root, { id: row.id, unreadCount: row.unreadCount })
    }
  }

  const candidatesByChat = new Map()
  const candidateByMessage = new Map()
  let structurallyFiltered = 0
  let duplicateMessages = 0
  messages.forEach((message, index) => {
    const key = message?.key
    const remoteJid = key?.remoteJid
    if (
      !key ||
      key.fromMe !== false ||
      !isOneToOneHistoryJid(remoteJid) ||
      !isProviderMessageId(key.id)
    ) {
      structurallyFiltered += 1
      return
    }

    const root = aliasGroups.find(remoteJid)
    const record = chatRecords.get(root)
    if (!record) {
      structurallyFiltered += 1
      return
    }

    const timestampMs = historyTimestampMs(message.messageTimestamp)
    if (timestampMs === null) {
      structurallyFiltered += 1
      return
    }

    const candidates = candidatesByChat.get(root) ?? []
    const candidateKey = `${root}\u0000${key.id}`
    const existing = candidateByMessage.get(candidateKey)
    if (existing) {
      duplicateMessages += 1
      // Conflicting repeats still consume the newest-unread slot but are never
      // imported. Exact repeats are collapsed before quota calculation.
      if (
        existing.timestampMs !== timestampMs ||
        existing.importable !== hasImportableContent(message?.message)
      ) {
        existing.timestampMs = Math.max(existing.timestampMs, timestampMs)
        existing.importable = false
      }
      return
    }
    const candidate = {
      chatId: record.id,
      aliases: aliasesByRoot.get(root) ?? [record.id],
      message,
      timestampMs,
      index,
      importable: hasImportableContent(message?.message),
    }
    candidateByMessage.set(candidateKey, candidate)
    candidates.push(candidate)
    candidatesByChat.set(root, candidates)
  })

  const selected = []
  let declaredUnread = 0
  let unreadCandidates = 0
  let missingUnread = 0
  let filteredUnread = 0
  for (const [root, record] of chatRecords) {
    const candidates = candidatesByChat.get(root) ?? []
    candidates.sort((left, right) =>
      right.timestampMs - left.timestampMs || left.index - right.index,
    )
    const ranked = candidates.slice(0, record.unreadCount)
    declaredUnread = safeCountAdd(declaredUnread, record.unreadCount)
    unreadCandidates = safeCountAdd(unreadCandidates, ranked.length)
    missingUnread = safeCountAdd(
      missingUnread,
      Math.max(0, record.unreadCount - candidates.length),
    )
    // Rank before filtering content. Otherwise a non-importable unread event
    // could be removed first and an older, already-read message could slide in.
    for (const candidate of ranked) {
      if (candidate.importable) selected.push(candidate)
      else filteredUnread = safeCountAdd(filteredUnread, 1)
    }
  }

  selected.sort((left, right) =>
    left.timestampMs - right.timestampMs || right.index - left.index,
  )
  return {
    selected: selected.map(({ chatId, aliases, message }) => ({
      chatId,
      aliases,
      message,
    })),
    metrics: {
      // The companion snapshot is not an authoritative export. Keep this true
      // even when no gap is detectable inside the payload itself.
      partial: true,
      received: { chats: chats.length, messages: messages.length },
      unread: {
        declared: declaredUnread,
        candidates: unreadCandidates,
        selected: selected.length,
        missing: missingUnread,
      },
      filtered: {
        messages: structurallyFiltered,
        unread: filteredUnread,
        duplicates: duplicateMessages,
      },
    },
  }
}

/**
 * Selects only the newest `unreadCount` inbound messages for each eligible
 * one-to-one chat, then returns them in chronological delivery order.
 * This is a best-effort selection from the snapshot WhatsApp supplied; it is
 * not evidence that every unread message exists in the payload.
 */
export function selectUnreadHistoryMessages(input) {
  return analyzeUnreadHistoryMessages(input).selected
}

function analyzeMaintenanceFullHistory({ chats, messages, lidPnMappings = [] }) {
  if (!Array.isArray(chats) || !Array.isArray(messages)) {
    return {
      selected: [],
      metrics: {
        partial: true,
        received: { chats: 0, messages: 0 },
        unread: null,
        filtered: { messages: 0, duplicates: 0 },
      },
    }
  }
  const mappings = Array.isArray(lidPnMappings) ? lidPnMappings : []
  const { aliasGroups, aliasesByRoot } = createHistoryAliasContext({
    chats,
    messages,
    lidPnMappings: mappings,
  })
  const preferredChatId = new Map()
  for (const chat of chats) {
    if (!isOneToOneHistoryJid(chat?.id)) continue
    preferredChatId.set(aliasGroups.find(chat.id), chat.id)
  }

  const selectedByMessage = new Map()
  const conflictedMessages = new Set()
  let filteredMessages = 0
  let duplicateMessages = 0
  messages.forEach((message, index) => {
    const key = message?.key
    const remoteJid = key?.remoteJid
    const timestampMs = historyTimestampMs(message?.messageTimestamp)
    if (
      !key ||
      key.fromMe !== false ||
      !isOneToOneHistoryJid(remoteJid) ||
      !isProviderMessageId(key.id) ||
      timestampMs === null ||
      !hasImportableContent(message?.message)
    ) {
      filteredMessages += 1
      return
    }
    const root = aliasGroups.find(remoteJid)
    const candidateKey = `${root}\u0000${key.id}`
    if (conflictedMessages.has(candidateKey)) {
      duplicateMessages += 1
      return
    }
    const existing = selectedByMessage.get(candidateKey)
    if (existing) {
      duplicateMessages += 1
      if (existing.timestampMs !== timestampMs) {
        selectedByMessage.delete(candidateKey)
        conflictedMessages.add(candidateKey)
        filteredMessages += 1
      }
      return
    }
    selectedByMessage.set(candidateKey, {
      chatId: preferredChatId.get(root) ?? remoteJid,
      aliases: aliasesByRoot.get(root) ?? [remoteJid],
      message,
      timestampMs,
      index,
    })
  })

  const selected = [...selectedByMessage.values()].sort((left, right) =>
    left.timestampMs - right.timestampMs || right.index - left.index,
  )
  return {
    selected: selected.map(({ chatId, aliases, message }) => ({
      chatId,
      aliases,
      message,
    })),
    metrics: {
      // FULL maintenance is intentionally bounded and cannot substantiate an
      // "all history" claim even if every candidate in this chunk is accepted.
      partial: true,
      received: { chats: chats.length, messages: messages.length },
      unread: null,
      filtered: {
        messages: filteredMessages,
        duplicates: duplicateMessages,
      },
    },
  }
}

export const HISTORY_SYNC_TYPE = Object.freeze({
  INITIAL_BOOTSTRAP: 0,
  FULL: 2,
  RECENT: 3,
})

const DEFAULT_HISTORY_BUFFER_LIMITS = Object.freeze({
  maxChunks: 64,
  maxChats: 5000,
  maxMessages: 20_000,
})

/**
 * Buffers INITIAL_BOOTSTRAP/RECENT only until an explicit RECENT 100 payload.
 * Every retained dimension is bounded and a malformed, stalled, or oversized
 * stream fails closed. FULL chunks are ignored unless the caller explicitly
 * enables maintenance mode; enabled FULL chunks are emitted independently and
 * still share the same cumulative safety limits.
 */
export function createUnreadHistoryAccumulator(options = {}) {
  const maxChunks = positiveInteger(
    'maxChunks',
    options.maxChunks ?? DEFAULT_HISTORY_BUFFER_LIMITS.maxChunks,
  )
  const maxChats = positiveInteger(
    'maxChats',
    options.maxChats ?? DEFAULT_HISTORY_BUFFER_LIMITS.maxChats,
  )
  const maxMessages = positiveInteger(
    'maxMessages',
    options.maxMessages ?? DEFAULT_HISTORY_BUFFER_LIMITS.maxMessages,
  )
  const allowFullSync = options.allowFullSync ?? false
  if (typeof allowFullSync !== 'boolean') {
    throw new TypeError('allowFullSync must be a boolean')
  }

  let closed = false
  let closureReason = null
  let unreadReleased = false
  let acceptedChunks = 0
  let acceptedChats = 0
  let acceptedMessages = 0
  let observedChunks = 0
  let observedChats = 0
  let observedMessages = 0
  let unreadChunks = 0
  const chats = []
  const messages = []
  const lidPnMappings = []
  const maxMappings = Math.min(Number.MAX_SAFE_INTEGER, maxChats * 4)

  const limits = () => ({ maxChunks, maxChats, maxMessages })
  const receivedTotals = () => ({
    chunks: observedChunks,
    chats: observedChats,
    messages: observedMessages,
  })
  const clearBuffered = () => {
    chats.length = 0
    messages.length = 0
    lidPnMappings.length = 0
  }
  const snapshot = () => ({
    closed,
    closureReason,
    unreadReleased,
    acceptedChunks,
    acceptedChats,
    acceptedMessages,
    observedChunks,
    observedChats,
    observedMessages,
    chats: chats.length,
    messages: messages.length,
    mappings: lidPnMappings.length,
    limits: limits(),
  })
  const close = (reason, summary = {}) => {
    closed = true
    closureReason = reason
    clearBuffered()
    return {
      status: 'closed',
      reason,
      selected: [],
      summary: {
        partial: true,
        received: receivedTotals(),
        limits: limits(),
        ...summary,
      },
    }
  }
  const observeAndAccept = (event) => {
    observedChunks = safeCountAdd(observedChunks, 1)
    observedChats = safeCountAdd(observedChats, event.chats.length)
    observedMessages = safeCountAdd(observedMessages, event.messages.length)
    const mappingCount = Array.isArray(event.lidPnMappings)
      ? event.lidPnMappings.length
      : 0
    const nextMappings = lidPnMappings.length + mappingCount
    if (
      observedChunks > maxChunks ||
      observedChats > maxChats ||
      observedMessages > maxMessages ||
      nextMappings > maxMappings
    ) {
      return false
    }
    acceptedChunks += 1
    acceptedChats += event.chats.length
    acceptedMessages += event.messages.length
    return true
  }

  return {
    add(event) {
      if (closed) {
        return {
          status: 'closed',
          reason: closureReason,
          selected: [],
          summary: { partial: true, received: receivedTotals(), limits: limits() },
        }
      }
      const syncType = event?.syncType
      const isUnreadType =
        syncType === HISTORY_SYNC_TYPE.INITIAL_BOOTSTRAP ||
        syncType === HISTORY_SYNC_TYPE.RECENT
      if (syncType === HISTORY_SYNC_TYPE.FULL && !allowFullSync) {
        return {
          status: 'ignored',
          reason: 'full_maintenance_disabled',
          selected: [],
          summary: {
            mode: 'full_maintenance',
            partial: true,
            received: {
              chunks: 1,
              chats: Array.isArray(event?.chats) ? event.chats.length : 0,
              messages: Array.isArray(event?.messages) ? event.messages.length : 0,
            },
          },
        }
      }
      if (!isUnreadType && syncType !== HISTORY_SYNC_TYPE.FULL) {
        return { status: 'ignored', reason: 'unsupported_sync_type', selected: [] }
      }
      if (unreadReleased && isUnreadType) {
        return { status: 'ignored', reason: 'unread_already_released', selected: [] }
      }
      if (!Array.isArray(event?.chats) || !Array.isArray(event?.messages)) {
        observedChunks = safeCountAdd(observedChunks, 1)
        return close('malformed_history_chunk')
      }
      if (!observeAndAccept(event)) return close('history_buffer_limit_exceeded')

      if (syncType === HISTORY_SYNC_TYPE.FULL) {
        const analysis = analyzeMaintenanceFullHistory(event)
        return {
          status: 'full_ready',
          reason: 'full_maintenance_chunk',
          selected: analysis.selected,
          summary: {
            mode: 'full_maintenance',
            ...analysis.metrics,
            received: { chunks: 1, ...analysis.metrics.received },
            cumulativeReceived: receivedTotals(),
            limits: limits(),
          },
        }
      }

      chats.push(...event.chats)
      messages.push(...event.messages)
      if (Array.isArray(event.lidPnMappings)) {
        lidPnMappings.push(...event.lidPnMappings)
      }
      unreadChunks += 1

      if (syncType !== HISTORY_SYNC_TYPE.RECENT || event.progress !== 100) {
        return {
          status: 'buffering',
          reason: 'waiting_for_explicit_recent_payload',
          selected: [],
          summary: {
            partial: true,
            received: {
              chunks: unreadChunks,
              chats: chats.length,
              messages: messages.length,
            },
            limits: limits(),
          },
        }
      }

      const analysis = analyzeUnreadHistoryMessages({
        chats,
        messages,
        lidPnMappings,
      })
      const summary = {
        mode: 'unread_snapshot',
        ...analysis.metrics,
        received: { chunks: unreadChunks, ...analysis.metrics.received },
        cumulativeReceived: receivedTotals(),
        limits: limits(),
      }
      unreadReleased = true
      clearBuffered()
      if (!allowFullSync) {
        closed = true
        closureReason = 'recent_payload_complete'
      }
      return {
        status: 'ready',
        reason: 'explicit_recent_payload',
        selected: analysis.selected,
        summary,
      }
    },

    handleStatus(event) {
      if (closed) {
        return {
          status: 'closed',
          reason: closureReason,
          selected: [],
          summary: { partial: true, received: receivedTotals(), limits: limits() },
        }
      }
      const syncType = event?.syncType
      const relevant =
        syncType === HISTORY_SYNC_TYPE.INITIAL_BOOTSTRAP ||
        syncType === HISTORY_SYNC_TYPE.RECENT ||
        (allowFullSync && syncType === HISTORY_SYNC_TYPE.FULL)
      if (!relevant || !['complete', 'paused'].includes(event?.status)) {
        return { status: 'ignored', reason: 'unsupported_history_status', selected: [] }
      }
      if (event.status === 'paused') {
        return close('history_status_paused', {
          status: { state: 'paused', explicit: event.explicit === true },
        })
      }
      // Baileys emits the completion milestone before it emits/finishes the
      // corresponding messaging-history.set payload. Observe it, but keep the
      // accumulator open until RECENT progress=100 is actually received.
      return {
        status: 'status_observed',
        reason: 'complete_waiting_for_payload',
        selected: [],
        summary: {
          partial: true,
          received: receivedTotals(),
          status: { state: 'complete', explicit: event.explicit === true },
          limits: limits(),
        },
      }
    },

    discard(reason = 'discarded') {
      if (closed) return snapshot()
      close(reason)
      return snapshot()
    },
    snapshot,
  }
}

/**
 * A per-connection quota shared by append and history batches. Provider message
 * IDs are de-duplicated globally, matching the portal's external-message key.
 * PN/LID aliases are unioned before per-chat accounting; late alias discovery
 * also merges already accepted counts because roots are resolved dynamically.
 */
export function createCatchUpLimiter({ maxTotal, maxPerChat }) {
  const totalLimit = positiveInteger('maxTotal', maxTotal)
  const perChatLimit = positiveInteger('maxPerChat', maxPerChat)
  const aliasGroups = createAliasGroups()
  const accepted = []
  const acceptedMessageIds = new Set()
  let duplicatesSkipped = 0
  let limitedSkipped = 0

  const validIdentity = (value) =>
    typeof value === 'string' && value.length > 0 && value.length <= 160
  const normalizedAliases = (chatId, aliases = []) => [
    chatId,
    ...(Array.isArray(aliases) ? aliases : []),
  ].filter(validIdentity)
  const chatCount = (chatId) => {
    const root = aliasGroups.find(chatId)
    return accepted.reduce(
      (count, record) => count + (aliasGroups.find(record.chatId) === root ? 1 : 0),
      0,
    )
  }
  const accept = ({ chatId, messageId = null, aliases = [] }) => {
    if (!validIdentity(chatId)) return 'invalid'
    if (messageId !== null && !isProviderMessageId(messageId)) return 'invalid'
    aliasGroups.addAliases(normalizedAliases(chatId, aliases))
    if (messageId !== null && acceptedMessageIds.has(messageId)) {
      duplicatesSkipped += 1
      return 'duplicate'
    }
    if (accepted.length >= totalLimit || chatCount(chatId) >= perChatLimit) {
      limitedSkipped += 1
      return 'limited'
    }
    accepted.push({ chatId })
    if (messageId !== null) acceptedMessageIds.add(messageId)
    return 'accepted'
  }

  return {
    tryAccept(chatId) {
      return accept({ chatId }) === 'accepted'
    },
    tryAcceptMessage(input) {
      return accept(input)
    },
    registerAliases(aliases) {
      if (!Array.isArray(aliases)) return false
      const safeAliases = aliases.filter(validIdentity)
      if (safeAliases.length < 2) return false
      aliasGroups.addAliases(safeAliases)
      return true
    },
    snapshot() {
      const roots = new Set(accepted.map(({ chatId }) => aliasGroups.find(chatId)))
      return {
        acceptedTotal: accepted.length,
        chats: roots.size,
        duplicatesSkipped,
        limitedSkipped,
        maxTotal: totalLimit,
        maxPerChat: perChatLimit,
      }
    },
  }
}

export function isCatchUpTimestampAllowed({
  timestampMs,
  nowMs,
  maxAgeSeconds,
  futureSkewSeconds = 60,
}) {
  if (!Number.isFinite(timestampMs) || !Number.isFinite(nowMs)) return false
  if (!Number.isInteger(maxAgeSeconds) || maxAgeSeconds < 1) return false
  if (!Number.isInteger(futureSkewSeconds) || futureSkewSeconds < 0) return false
  return (
    timestampMs >= nowMs - maxAgeSeconds * 1000 &&
    timestampMs <= nowMs + futureSkewSeconds * 1000
  )
}
