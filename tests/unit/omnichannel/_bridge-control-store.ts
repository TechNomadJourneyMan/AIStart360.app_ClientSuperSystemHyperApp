import type {
  BridgeCommandRow,
  BridgeControlStore,
  BridgeStatusRow,
} from '@/lib/omnichannel/whatsapp-bridge-control'

/**
 * In-memory store with the same guarantees the database gives: single-row
 * status by session, a partial unique index (one pending/claimed command per
 * session), a unique idempotency key and compare-and-set updates.
 */
export function memoryStore() {
  const statuses = new Map<string, BridgeStatusRow>()
  const commands: BridgeCommandRow[] = []
  let seq = 0
  const calls = { upsertStatus: 0 }
  const inFlight = (row: BridgeCommandRow) => row.status === 'pending' || row.status === 'claimed'
  const store: BridgeControlStore = {
    async upsertStatus(row) {
      calls.upsertStatus += 1
      statuses.set(row.session_id, { ...row })
    },
    async readStatus(sessionId) {
      const row = statuses.get(sessionId)
      return row ? { ...row } : null
    },
    async clearExpiredQr(sessionId, expiredAt) {
      const row = statuses.get(sessionId)
      if (row?.qr && row.qr_expires_at && row.qr_expires_at <= expiredAt) {
        statuses.set(sessionId, { ...row, qr: null, qr_expires_at: null })
      }
    },
    async expireCommands(sessionId, now) {
      for (const row of commands) {
        if (row.session_id === sessionId && inFlight(row) && row.expires_at <= now) {
          row.status = 'expired'
          row.completed_at = now
          row.lease_until = null
        }
      }
    },
    async pruneCommands(before) {
      for (let i = commands.length - 1; i >= 0; i -= 1) {
        if (!inFlight(commands[i]) && commands[i].created_at < before) commands.splice(i, 1)
      }
    },
    async findInFlight(sessionId) {
      const rows = commands
        .filter((row) => row.session_id === sessionId && inFlight(row))
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
      return rows[0] ? { ...rows[0] } : null
    },
    async insertCommand(row) {
      if (commands.some((c) => c.idempotency_key === row.idempotency_key)) return 'conflict'
      if (commands.some((c) => c.session_id === row.session_id && inFlight(c))) return 'conflict'
      seq += 1
      const created: BridgeCommandRow = {
        ...row,
        id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
        status: 'pending',
        lease_token: null,
        lease_until: null,
        attempts: 0,
        result_code: null,
        claimed_at: null,
        completed_at: null,
      }
      commands.push(created)
      return { ...created }
    },
    async updateCommand(id, expected, patch) {
      const row = commands.find((c) => c.id === id)
      if (!row || row.status !== expected.status || row.lease_token !== expected.leaseToken) return null
      const next = { ...row, ...patch }
      if (inFlight(next) && commands.some((c) => c !== row && c.session_id === row.session_id && inFlight(c))) {
        throw new Error('unique violation')
      }
      Object.assign(row, patch)
      return { ...row }
    },
  }
  return { store, statuses, commands, calls }
}

