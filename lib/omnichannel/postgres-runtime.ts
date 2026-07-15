import { attachDatabasePool } from "@vercel/functions";
import { Pool, type PoolClient } from "pg";

export type OmnichannelPostgresPool = Pick<Pool, "connect" | "query">;

const enabledValues = new Set(["1", "true", "yes", "on"]);

function enabled(value: string | undefined): boolean {
  return enabledValues.has(value?.trim().toLowerCase() ?? "");
}

function productionPostgresRequested(env: NodeJS.ProcessEnv): boolean {
  return (
    env.OMNICHANNEL_PERSISTENCE?.trim().toLowerCase() === "postgres" ||
    enabled(env.OMNICHANNEL_DIRECT_POSTGRES_ENABLED)
  );
}

/**
 * Select the direct Postgres adapter.
 *
 * Development keeps its zero-configuration fallback. Production is strictly
 * opt-in and requires a dedicated URL so the application's broad DATABASE_URL
 * is never copied into this path by accident.
 */
export function shouldUseOmnichannelPostgres(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (productionPostgresRequested(env)) {
    return Boolean(env.OMNICHANNEL_DATABASE_URL?.trim());
  }
  return (
    env.NODE_ENV === "development" &&
    !env.SUPABASE_SERVICE_ROLE_KEY?.trim() &&
    Boolean(env.DATABASE_URL?.trim())
  );
}

export function omnichannelPostgresConfigurationError(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (!productionPostgresRequested(env) || env.NODE_ENV === "development") {
    return null;
  }
  if (!env.OMNICHANNEL_DATABASE_URL?.trim()) {
    return "omnichannel_database_url_missing";
  }
  return null;
}

export function omnichannelPostgresConnectionString(
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (!shouldUseOmnichannelPostgres(env)) {
    const reason = omnichannelPostgresConfigurationError(env);
    throw new Error(reason ?? "direct omnichannel Postgres access is disabled");
  }
  const value =
    env.NODE_ENV === "development"
      ? env.OMNICHANNEL_DATABASE_URL?.trim() || env.DATABASE_URL?.trim()
      : env.OMNICHANNEL_DATABASE_URL?.trim();
  if (!value) throw new Error("omnichannel database URL is missing");
  return value;
}

const globalRuntime = globalThis as typeof globalThis & {
  __aistart360OmnichannelPostgresPool?: Pool;
  __aistart360OmnichannelPostgresPoolAttached?: boolean;
};

/** One bounded pool shared by webhook, repository and admin adapters. */
export function omnichannelPostgresPool(): Pool {
  const connectionString = omnichannelPostgresConnectionString();
  const existing = globalRuntime.__aistart360OmnichannelPostgresPool;
  if (existing) return existing;

  const pool = new Pool({
    connectionString,
    max: process.env.VERCEL === "1" ? 2 : 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: "aistart360-omnichannel",
  });
  globalRuntime.__aistart360OmnichannelPostgresPool = pool;

  if (
    process.env.VERCEL === "1" &&
    !globalRuntime.__aistart360OmnichannelPostgresPoolAttached
  ) {
    attachDatabasePool(pool);
    globalRuntime.__aistart360OmnichannelPostgresPoolAttached = true;
  }
  return pool;
}

export async function withOmnichannelPostgresTransaction<T>(
  operation: string,
  run: (client: PoolClient) => Promise<T>,
  pool: Pick<Pool, "connect"> = omnichannelPostgresPool(),
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original database error.
    }
    const message =
      error instanceof Error ? error.message.slice(0, 300) : "database error";
    throw new Error(`${operation}: ${message}`);
  } finally {
    client.release();
  }
}
