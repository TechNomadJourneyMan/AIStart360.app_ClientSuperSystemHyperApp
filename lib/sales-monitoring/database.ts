import { Pool, type PoolClient, type QueryResultRow } from 'pg'
import { DomainError } from './errors'

declare global {
  // eslint-disable-next-line no-var
  var salesMonitoringPool: Pool | undefined
}

function createPool() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is required')
  return new Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 20_000,
    connectionTimeoutMillis: 10_000,
  })
}

export function getPool(): Pool {
  if (!globalThis.salesMonitoringPool) {
    globalThis.salesMonitoringPool = createPool()
  }
  return globalThis.salesMonitoringPool
}

export async function query<T extends QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  const result = await getPool().query<T>(text, values)
  return result.rows
}

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    await client.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function executeIdempotent<T extends object>(
  input: {
    organizationId: string
    actorId: string
    operation: string
    key: string
  },
  fn: (client: PoolClient) => Promise<{ status: number; body: T }>,
): Promise<{ status: number; body: T; replayed: boolean }> {
  return withTransaction(async (client) => {
    const claim = await client.query<{ id: string }>(
      `INSERT INTO idempotency_records
         (organization_id, actor_id, operation, idempotency_key)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [input.organizationId, input.actorId, input.operation, input.key],
    )

    if (claim.rowCount === 0) {
      const existing = await client.query<{
        status: string
        response_status: number | null
        response_body: T | null
      }>(
        `SELECT status, response_status, response_body
         FROM idempotency_records
         WHERE organization_id = $1 AND actor_id = $2
           AND operation = $3 AND idempotency_key = $4
         FOR UPDATE`,
        [input.organizationId, input.actorId, input.operation, input.key],
      )
      const record = existing.rows[0]
      if (record?.status === 'completed' && record.response_body && record.response_status) {
        return { status: record.response_status, body: record.response_body, replayed: true }
      }
      throw new DomainError(
        'REQUEST_IN_PROGRESS',
        'Запрос с таким ключом идемпотентности уже выполняется',
        409,
      )
    }

    const result = await fn(client)
    await client.query(
      `UPDATE idempotency_records
       SET status = 'completed', response_status = $5, response_body = $6::jsonb, completed_at = now()
       WHERE organization_id = $1 AND actor_id = $2
         AND operation = $3 AND idempotency_key = $4`,
      [
        input.organizationId,
        input.actorId,
        input.operation,
        input.key,
        result.status,
        JSON.stringify(result.body),
      ],
    )
    return { ...result, replayed: false }
  })
}

export function requireIdempotencyKey(request: Request): string {
  const key = request.headers.get('idempotency-key')?.trim()
  if (!key || key.length < 8 || key.length > 200) {
    throw new DomainError(
      'IDEMPOTENCY_KEY_REQUIRED',
      'Для критической операции требуется заголовок Idempotency-Key',
      400,
    )
  }
  return key
}
