/**
 * Test files run in parallel workers against one test DB. Files that write
 * the same agent_configs row (e.g. the 'report' agent: report-agent and
 * report-review tests) take this session-level advisory lock for their whole
 * run, so one file's cleanup never resets the other's settings mid-test.
 */
import pg from 'pg'

export async function lockAgentConfig(agentKey: string): Promise<() => Promise<void>> {
  if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is not set')
  const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL })
  await client.connect()
  await client.query('SELECT pg_advisory_lock(hashtext($1))', [`test:agent_configs:${agentKey}`])
  return async () => {
    try {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [`test:agent_configs:${agentKey}`])
    } finally {
      await client.end()
    }
  }
}
