import { randomBytes } from 'node:crypto'
import {
  chmod,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
} from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const EVENT_ID_PATTERN = /^[a-f0-9]{64}$/
const TEMP_FILE_PATTERN = /^[a-f0-9]{64}\.\d+\.[a-f0-9]{12}\.tmp$/

async function syncDirectory(directory) {
  let handle
  try {
    handle = await open(directory, 'r')
    await handle.sync()
  } catch (error) {
    // Some filesystems do not support fsync on directory handles. The file
    // itself is still fsynced before the atomic rename.
    if (!['EINVAL', 'ENOTSUP', 'EBADF'].includes(error?.code)) throw error
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

export async function atomicWriteOwnerOnly(target, raw) {
  const directory = path.dirname(target)
  const basename = path.basename(target, '.json')
  const temporary = path.join(
    directory,
    `${basename}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`,
  )
  let handle
  let renamed = false
  try {
    handle = await open(temporary, 'wx', 0o600)
    await handle.writeFile(raw, { encoding: 'utf8' })
    await handle.sync()
    await handle.close()
    handle = null
    await rename(temporary, target)
    renamed = true
    await chmod(target, 0o600)
    await syncDirectory(directory)
  } finally {
    await handle?.close().catch(() => undefined)
    if (!renamed) await rm(temporary, { force: true }).catch(() => undefined)
  }
}

export function isPermanentWebhookStatus(status) {
  return (
    Number.isInteger(status) &&
    status >= 400 &&
    status < 500 &&
    // Vercel returns 402 while a deployment is temporarily disabled (for
    // example DEPLOYMENT_DISABLED / Payment Required). Keep those events in
    // the durable outbox so delivery resumes after the deployment recovers.
    status !== 402 &&
    status !== 408 &&
    status !== 429
  )
}

function timestamp(now) {
  return new Date(now()).toISOString()
}

function sanitizedError(kind, now, status) {
  return {
    at: timestamp(now),
    kind,
    ...(Number.isInteger(status) ? { status } : {}),
  }
}

export class FixedWindowRateLimiter {
  #limit
  #windowMs
  #maxBuckets
  #now
  #buckets = new Map()
  #overflowBucket = null

  /**
   * @param {{
   *   limit: number,
   *   windowMs: number,
   *   maxBuckets?: number,
   *   now?: () => number,
   * }} options
   */
  constructor({ limit, windowMs, maxBuckets = 1000, now = Date.now }) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new TypeError('limit must be a positive integer')
    }
    if (!Number.isInteger(windowMs) || windowMs < 1) {
      throw new TypeError('windowMs must be a positive integer')
    }
    if (!Number.isInteger(maxBuckets) || maxBuckets < 1) {
      throw new TypeError('maxBuckets must be a positive integer')
    }
    if (typeof now !== 'function') throw new TypeError('now must be a function')
    this.#limit = limit
    this.#windowMs = windowMs
    this.#maxBuckets = maxBuckets
    this.#now = now
  }

  #freshBucket(now) {
    return { count: 0, resetAt: now + this.#windowMs }
  }

  #pruneExpired(now) {
    for (const [key, bucket] of this.#buckets) {
      if (bucket.resetAt <= now) this.#buckets.delete(key)
    }
    if (this.#overflowBucket?.resetAt <= now) this.#overflowBucket = null
  }

  consume(key) {
    if (typeof key !== 'string' || !key) {
      throw new TypeError('rate-limit key must be a non-empty string')
    }
    const now = this.#now()
    this.#pruneExpired(now)

    let bucket = this.#buckets.get(key)
    if (!bucket) {
      if (this.#buckets.size < this.#maxBuckets) {
        bucket = this.#freshBucket(now)
        this.#buckets.set(key, bucket)
      } else {
        // Unknown keys share one overflow bucket after the cardinality cap.
        // This bounds memory without letting attackers bypass throttling by
        // continually presenting new source addresses.
        this.#overflowBucket ??= this.#freshBucket(now)
        bucket = this.#overflowBucket
      }
    }

    bucket.count += 1
    const allowed = bucket.count <= this.#limit
    return {
      allowed,
      retryAfterSeconds: allowed
        ? 0
        : Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    }
  }

  snapshot() {
    const now = this.#now()
    this.#pruneExpired(now)
    return {
      buckets: this.#buckets.size,
      overflow_active: this.#overflowBucket !== null,
    }
  }
}

/**
 * @param {Map<string, {status?: string, recorded_at?: number}>} entries
 * @param {{
 *   maxEntries: number,
 *   ttlMs: number,
 *   reserve?: number,
 *   now?: number,
 * }} options
 */
export function compactCommandCache(
  entries,
  { maxEntries, ttlMs, reserve = 0, now = Date.now() },
) {
  if (!(entries instanceof Map)) throw new TypeError('entries must be a Map')
  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new TypeError('maxEntries must be a positive integer')
  }
  if (!Number.isInteger(ttlMs) || ttlMs < 1) {
    throw new TypeError('ttlMs must be a positive integer')
  }
  if (!Number.isInteger(reserve) || reserve < 0 || reserve > maxEntries) {
    throw new TypeError('reserve must be between zero and maxEntries')
  }
  if (!Number.isFinite(now)) throw new TypeError('now must be finite')

  const cutoff = now - ttlMs
  let expiredSent = 0
  for (const [commandId, entry] of entries) {
    // Ambiguous outcomes are fail-closed tombstones. Never age them out: a
    // retry after an uncertain provider result could otherwise duplicate a
    // message. Operators must resolve or deliberately clear such entries.
    if (
      entry?.status === 'sent' &&
      (!Number.isFinite(entry.recorded_at) || entry.recorded_at < cutoff)
    ) {
      entries.delete(commandId)
      expiredSent += 1
    }
  }

  const targetSize = maxEntries - reserve
  const needed = Math.max(0, entries.size - targetSize)
  const sentCandidates = [...entries.entries()]
    .filter(([, entry]) => entry?.status === 'sent')
    .sort((left, right) => left[1].recorded_at - right[1].recorded_at)
  const evictionCandidates =
    sentCandidates.length >= needed ? sentCandidates.slice(0, needed) : []
  for (const [commandId] of evictionCandidates) entries.delete(commandId)

  const protectedEntries = [...entries.values()].filter(
    (entry) => entry?.status !== 'sent',
  ).length
  return {
    available: entries.size <= targetSize,
    size: entries.size,
    expiredSent,
    evictedSent: evictionCandidates.length,
    evictedEntries: evictionCandidates,
    protectedEntries,
  }
}

export class SerializedOperationQueue {
  #tail = Promise.resolve()
  #pending = 0
  #initialized = false
  #healthy = false
  #lastSuccessAt = null
  #lastError = null
  #now

  constructor({ now = Date.now } = {}) {
    this.#now = now
  }

  markInitialized() {
    this.#initialized = true
    this.#healthy = true
  }

  markUnavailable() {
    this.#initialized = false
    this.#healthy = false
  }

  enqueue(operation) {
    if (typeof operation !== 'function') throw new TypeError('operation must be a function')
    this.#pending += 1
    const run = this.#tail
      .then(operation)
    const observed = run.then(
      (value) => {
        this.#initialized = true
        this.#healthy = true
        this.#lastSuccessAt = timestamp(this.#now)
        return value
      },
      (error) => {
        this.#initialized = true
        this.#healthy = false
        this.#lastError = sanitizedError('persist_failed', this.#now)
        throw error
      },
    ).finally(() => {
      this.#pending -= 1
    })
    this.#tail = observed.catch(() => undefined)
    return observed
  }

  idle() {
    return this.#tail
  }

  snapshot() {
    return {
      ready: this.#initialized && this.#healthy,
      pending: this.#pending,
      last_success_at: this.#lastSuccessAt,
      last_error: this.#lastError,
    }
  }
}

export class WebhookOutbox {
  #outboxDir
  #deadLetterDir
  #maxEntries
  #validateEnvelope
  #deliver
  #log
  #now
  #entries = new Set()
  #reservations = new Set()
  #capacityWaiters = new Set()
  #initialized = false
  #persistenceHealthy = true
  #deliveryBlocked = false
  #drainPromise = null
  #drainRequested = false
  #lastSuccessAt = null
  #lastError = null
  #saturationLogged = false

  constructor({
    outboxDir,
    deadLetterDir,
    maxEntries,
    validateEnvelope,
    deliver,
    log = () => undefined,
    now = Date.now,
  }) {
    if (!path.isAbsolute(outboxDir) || !path.isAbsolute(deadLetterDir)) {
      throw new TypeError('outbox directories must be absolute')
    }
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new TypeError('maxEntries must be a positive integer')
    }
    if (typeof validateEnvelope !== 'function' || typeof deliver !== 'function') {
      throw new TypeError('validateEnvelope and deliver are required')
    }
    this.#outboxDir = outboxDir
    this.#deadLetterDir = deadLetterDir
    this.#maxEntries = maxEntries
    this.#validateEnvelope = validateEnvelope
    this.#deliver = deliver
    this.#log = log
    this.#now = now
  }

  async initialize() {
    await mkdir(this.#outboxDir, { recursive: true, mode: 0o700 })
    await mkdir(this.#deadLetterDir, { recursive: true, mode: 0o700 })
    await chmod(this.#outboxDir, 0o700)
    await chmod(this.#deadLetterDir, 0o700)
    const files = await readdir(this.#outboxDir)
    for (const file of files) {
      if (/^[a-f0-9]{64}\.json$/.test(file)) {
        this.#entries.add(file.slice(0, -5))
      } else if (TEMP_FILE_PATTERN.test(file)) {
        await rm(path.join(this.#outboxDir, file), { force: true })
      }
    }
    this.#initialized = true
  }

  #target(eventId) {
    if (!EVENT_ID_PATTERN.test(eventId)) throw new Error('invalid event id')
    return path.join(this.#outboxDir, `${eventId}.json`)
  }

  #depthWithReservations() {
    return this.#entries.size + this.#reservations.size
  }

  #hasCapacity() {
    return this.#depthWithReservations() < this.#maxEntries
  }

  #wakeCapacityWaiters() {
    if (!this.#hasCapacity()) return
    this.#saturationLogged = false
    const waiters = [...this.#capacityWaiters]
    this.#capacityWaiters.clear()
    for (const resolve of waiters) resolve()
  }

  async #reserve(eventId) {
    while (true) {
      if (this.#entries.has(eventId) || this.#reservations.has(eventId)) return false
      if (this.#hasCapacity()) {
        this.#reservations.add(eventId)
        return true
      }
      if (!this.#saturationLogged) {
        this.#saturationLogged = true
        this.#log('warn', 'portal_outbox_saturated', {
          outbox_depth: this.#entries.size,
        })
      }
      this.triggerDrain()
      await new Promise((resolve) => this.#capacityWaiters.add(resolve))
    }
  }

  async persist(envelope) {
    const eventId = envelope?.event_id
    if (!EVENT_ID_PATTERN.test(eventId)) throw new Error('invalid event id')
    const reserved = await this.#reserve(eventId)
    if (!reserved) return { persisted: false }
    try {
      await atomicWriteOwnerOnly(this.#target(eventId), JSON.stringify(envelope))
      this.#entries.add(eventId)
      this.#persistenceHealthy = true
      return { persisted: true }
    } catch (error) {
      this.#persistenceHealthy = false
      this.#lastError = sanitizedError('persist_failed', this.#now)
      this.#log('error', 'portal_event_persist_failed', {
        outbox_depth: this.#entries.size,
      })
      throw error
    } finally {
      this.#reservations.delete(eventId)
      this.#wakeCapacityWaiters()
    }
  }

  async #quarantine(eventId, reason) {
    const target = this.#target(eventId)
    const safeReason = reason === 'permanent_rejection' ? reason : 'invalid_envelope'
    const destination = path.join(
      this.#deadLetterDir,
      `${eventId}.${this.#now()}.${safeReason}.json`,
    )
    await rename(target, destination)
    await chmod(destination, 0o600)
    await Promise.all([
      syncDirectory(this.#outboxDir),
      syncDirectory(this.#deadLetterDir),
    ])
    this.#entries.delete(eventId)
    this.#wakeCapacityWaiters()
  }

  #recordDeliveryError(kind, status, { blocking }) {
    this.#lastError = sanitizedError(kind, this.#now, status)
    this.#deliveryBlocked = blocking
  }

  async #drainPass() {
    const eventIds = [...this.#entries].sort()
    for (const eventId of eventIds) {
      const target = this.#target(eventId)
      let envelope
      try {
        envelope = JSON.parse(await readFile(target, 'utf8'))
        if (!this.#validateEnvelope(envelope, eventId)) {
          throw new Error('invalid outbox envelope')
        }
      } catch {
        try {
          await this.#quarantine(eventId, 'invalid_envelope')
          this.#recordDeliveryError('invalid_envelope', undefined, { blocking: false })
          this.#log('error', 'portal_outbox_entry_quarantined', {
            reason: 'invalid_envelope',
            outbox_depth: this.#entries.size,
          })
          continue
        } catch {
          this.#recordDeliveryError('dead_letter_failed', undefined, { blocking: true })
          this.#log('error', 'portal_dead_letter_failed', {
            outbox_depth: this.#entries.size,
          })
          return 'blocked'
        }
      }

      let outcome
      try {
        outcome = await this.#deliver(envelope)
      } catch {
        outcome = { kind: 'retryable_failure' }
      }

      if (outcome?.kind === 'delivered') {
        try {
          await rm(target)
          await syncDirectory(this.#outboxDir)
          this.#entries.delete(eventId)
          this.#lastSuccessAt = timestamp(this.#now)
          this.#deliveryBlocked = false
          this.#wakeCapacityWaiters()
          continue
        } catch {
          this.#recordDeliveryError('ack_remove_failed', undefined, { blocking: true })
          this.#log('error', 'portal_outbox_ack_failed', {
            outbox_depth: this.#entries.size,
          })
          return 'blocked'
        }
      }

      if (outcome?.kind === 'permanent_failure') {
        try {
          await this.#quarantine(eventId, 'permanent_rejection')
          this.#recordDeliveryError('permanent_rejection', outcome.status, {
            blocking: false,
          })
          this.#log('error', 'portal_event_quarantined', {
            status: outcome.status,
            outbox_depth: this.#entries.size,
          })
          continue
        } catch {
          this.#recordDeliveryError('dead_letter_failed', outcome.status, { blocking: true })
          this.#log('error', 'portal_dead_letter_failed', {
            status: outcome.status,
            outbox_depth: this.#entries.size,
          })
          return 'blocked'
        }
      }

      this.#recordDeliveryError('delivery_failed', outcome?.status, { blocking: true })
      this.#log('error', 'portal_event_delivery_exhausted', {
        ...(Number.isInteger(outcome?.status) ? { status: outcome.status } : {}),
        outbox_depth: this.#entries.size,
      })
      return 'blocked'
    }
    return 'complete'
  }

  async #runDrain() {
    while (this.#drainRequested) {
      this.#drainRequested = false
      const result = await this.#drainPass()
      if (result === 'blocked') {
        this.#drainRequested = false
        break
      }
    }
  }

  triggerDrain() {
    this.#drainRequested = true
    if (this.#drainPromise) return this.#drainPromise
    const run = this.#runDrain().catch(() => {
      this.#recordDeliveryError('drain_failed', undefined, { blocking: true })
      this.#log('error', 'portal_outbox_drain_failed', {
        outbox_depth: this.#entries.size,
      })
    })
    this.#drainPromise = run.finally(() => {
      this.#drainPromise = null
      // A persist can complete in the narrow microtask window after the drain
      // loop observed no request but before this finalizer ran.
      if (this.#drainRequested) this.triggerDrain()
    })
    return this.#drainPromise
  }

  idle() {
    return this.#drainPromise ?? Promise.resolve()
  }

  snapshot() {
    const saturated = this.#depthWithReservations() >= this.#maxEntries
    return {
      ready: this.#initialized && this.#persistenceHealthy && !saturated && !this.#deliveryBlocked,
      initialized: this.#initialized,
      saturated,
      outbox_depth: this.#entries.size,
      drain_in_flight: this.#drainPromise !== null,
      last_webhook_success_at: this.#lastSuccessAt,
      last_webhook_error: this.#lastError,
    }
  }
}

export async function settleWithin(operations, timeoutMs) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new TypeError('timeoutMs must be a positive integer')
  }
  let timer
  const settled = Promise.allSettled(operations).then(() => true)
  const timedOut = new Promise((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs)
  })
  try {
    return await Promise.race([settled, timedOut])
  } finally {
    clearTimeout(timer)
  }
}
