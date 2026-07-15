#!/usr/bin/env node

/**
 * One-shot production provisioning for the dedicated omnichannel PostgreSQL
 * login. The generated password is never printed or written to disk; after
 * privilege checks the resulting DSN is streamed directly to Vercel.
 *
 * Usage:
 *   node --env-file=.env.production.local \
 *     scripts/provision-omnichannel-runtime.js --apply
 */

const { randomBytes } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { Client } = require("pg");

const LOGIN_ROLE = "aistart360_omnichannel_app";
const CAPABILITY_ROLE = "aistart360_omnichannel_runtime";

function fail(message) {
  throw new Error(message);
}

function runtimeConnectionString(password) {
  const source = process.env.DATABASE_URL;
  if (!source) fail("DATABASE_URL is required for the runtime pooler host");
  const url = new URL(source);
  const match = /^postgres\.([A-Za-z0-9_-]+)$/.exec(
    decodeURIComponent(url.username),
  );
  if (!match) fail("DATABASE_URL has an unexpected Supavisor username");
  if (url.port !== "6543") {
    fail("DATABASE_URL must use Supavisor transaction port 6543");
  }
  url.username = `${LOGIN_ROLE}.${match[1]}`;
  url.password = password;
  url.searchParams.delete("pgbouncer");
  // Supavisor requires TLS but serves a chain that is not rooted in Node's
  // bundled CA set. libpq-compatible `require` still encrypts transport while
  // avoiding pg v8's temporary verify-full alias and its self-signed failure.
  url.searchParams.set("uselibpqcompat", "true");
  url.searchParams.set("sslmode", "require");
  return url.toString();
}

async function expectDenied(client, sql, label) {
  await client.query("BEGIN");
  try {
    await client.query(sql);
    await client.query("ROLLBACK");
    fail(`${label} unexpectedly succeeded`);
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the authorization result.
    }
    if (
      error instanceof Error &&
      error.message.endsWith("unexpectedly succeeded")
    ) {
      throw error;
    }
    if (!error || !["42501", "42P01"].includes(error.code)) {
      fail(`${label} failed for an unexpected reason`);
    }
  }
}

async function provisionLogin(admin, password, rotate) {
  await admin.query("BEGIN");
  try {
    const capability = await admin.query(
      `SELECT rolcanlogin, rolinherit, rolsuper, rolcreatedb, rolcreaterole,
              rolreplication, rolbypassrls
         FROM pg_catalog.pg_roles
        WHERE rolname = $1`,
      [CAPABILITY_ROLE],
    );
    const role = capability.rows[0];
    if (
      !role ||
      role.rolcanlogin ||
      role.rolinherit ||
      role.rolsuper ||
      role.rolcreatedb ||
      role.rolcreaterole ||
      role.rolreplication ||
      role.rolbypassrls
    ) {
      fail("capability role is missing or unsafe");
    }

    const existing = await admin.query(
      "SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = $1",
      [LOGIN_ROLE],
    );
    if (existing.rowCount && !rotate) {
      fail("runtime login already exists; rerun with --rotate");
    }

    const formatted = await admin.query(
      existing.rowCount
        ? `SELECT format('ALTER ROLE ${LOGIN_ROLE} PASSWORD %L', $1::text) AS sql`
        : `SELECT format(
             'CREATE ROLE ${LOGIN_ROLE} LOGIN INHERIT NOSUPERUSER NOCREATEDB '
             'NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 10 PASSWORD %L',
             $1::text
           ) AS sql`,
      [password],
    );
    await admin.query(formatted.rows[0].sql);
    await admin.query(`GRANT ${CAPABILITY_ROLE} TO ${LOGIN_ROLE}`);
    await admin.query(
      `ALTER ROLE ${LOGIN_ROLE} SET search_path = pg_catalog, public`,
    );
    await admin.query(`ALTER ROLE ${LOGIN_ROLE} SET statement_timeout = '30s'`);
    await admin.query(`ALTER ROLE ${LOGIN_ROLE} SET lock_timeout = '3s'`);
    await admin.query(
      `ALTER ROLE ${LOGIN_ROLE} SET idle_in_transaction_session_timeout = '15s'`,
    );
    await admin.query("COMMIT");
  } catch (error) {
    try {
      await admin.query("ROLLBACK");
    } catch {
      // Preserve the provisioning failure.
    }
    throw error;
  }
}

async function verifyRuntime(connectionString) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const identity = await client.query(
      `SELECT current_user,
              r.rolsuper, r.rolcreatedb, r.rolcreaterole,
              r.rolreplication, r.rolbypassrls,
              pg_has_role(current_user, $1, 'MEMBER') AS capability_member
         FROM pg_catalog.pg_roles AS r
        WHERE r.rolname = current_user`,
      [CAPABILITY_ROLE],
    );
    const row = identity.rows[0];
    if (
      row?.current_user !== LOGIN_ROLE ||
      row.rolsuper ||
      row.rolcreatedb ||
      row.rolcreaterole ||
      row.rolreplication ||
      row.rolbypassrls ||
      !row.capability_member
    ) {
      fail("runtime login attribute verification failed");
    }

    await client.query(
      "SELECT channel FROM public.omnichannel_settings LIMIT 1",
    );
    await expectDenied(
      client,
      "SELECT id FROM public.profiles LIMIT 1",
      "unrelated table read",
    );
    await expectDenied(
      client,
      "CREATE TABLE public.omnichannel_runtime_escape_test(id integer)",
      "schema create",
    );
    await expectDenied(
      client,
      "TRUNCATE TABLE public.omnichannel_messages",
      "message truncate",
    );
    await expectDenied(
      client,
      "SELECT * FROM public.omnichannel_processing_jobs LIMIT 1",
      "queue table read",
    );

    await client.query("BEGIN");
    try {
      const message = await client.query(
        `SELECT id
           FROM public.omnichannel_messages
          WHERE direction = 'in'
          ORDER BY created_at DESC
          LIMIT 1`,
      );
      if (!message.rows[0])
        fail("no inbound message is available for queue RPC verification");
      const enqueued = await client.query(
        `SELECT *
           FROM public.enqueue_omnichannel_processing_job(
             $1::uuid, TRUE, NULL::timestamptz, 3
           )`,
        [message.rows[0].id],
      );
      const claimed = await client.query(
        "SELECT * FROM public.claim_omnichannel_processing_job(60)",
      );
      if (!enqueued.rows[0] || !claimed.rows[0]?.lease_token) {
        fail("queue RPC verification did not acquire a fenced lease");
      }
      const completed = await client.query(
        `SELECT completed
           FROM public.complete_omnichannel_processing_job($1::uuid, $2::uuid)`,
        [claimed.rows[0].job_id, claimed.rows[0].lease_token],
      );
      if (completed.rows[0]?.completed !== true) {
        fail("queue RPC verification did not complete the lease");
      }
      await client.query("ROLLBACK");
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the queue verification failure.
      }
      throw error;
    }
  } finally {
    await client.end();
  }
}

function setVercelSecret(value) {
  const result = spawnSync(
    "vercel",
    [
      "env",
      "add",
      "OMNICHANNEL_DATABASE_URL",
      "production",
      "--force",
      "--sensitive",
      "--yes",
    ],
    { input: `${value}\n`, encoding: "utf8" },
  );
  if (result.status !== 0) {
    fail("Vercel rejected OMNICHANNEL_DATABASE_URL");
  }
}

async function main() {
  if (!process.argv.includes("--apply")) {
    fail("refusing to provision without --apply");
  }
  const adminUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!adminUrl) fail("DIRECT_URL or DATABASE_URL is required");

  const password = randomBytes(48).toString("base64url");
  const connectionString = runtimeConnectionString(password);
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await provisionLogin(admin, password, process.argv.includes("--rotate"));
  } finally {
    await admin.end();
  }

  await verifyRuntime(connectionString);
  setVercelSecret(connectionString);
  console.log("✓ Dedicated omnichannel login provisioned and verified");
  console.log("✓ OMNICHANNEL_DATABASE_URL stored as a sensitive Vercel value");
}

main().catch((error) => {
  console.error(
    `✗ ${error instanceof Error ? error.message : "provisioning failed"}`,
  );
  process.exit(1);
});
