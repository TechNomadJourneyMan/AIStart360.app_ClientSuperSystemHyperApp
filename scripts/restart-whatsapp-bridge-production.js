#!/usr/bin/env node

/**
 * Controlled cutover of an already paired local WhatsApp bridge to the
 * production Vercel webhook and durable queue trigger. Auth/state directories
 * are reused; no QR or logout is performed.
 *
 * Usage:
 *   node scripts/restart-whatsapp-bridge-production.js \
 *     --apply --pid <active-pid> --delivery-mode direct|pull
 */

const { execFileSync, spawn } = require("node:child_process");
const {
  existsSync,
  openSync,
  chmodSync,
  closeSync,
  writeFileSync,
} = require("node:fs");
const { resolve } = require("node:path");

const AUTH_DIR =
  "./services/whatsapp-web-bridge/.data/auth-history-sync-20260714";
const STATE_DIR =
  "./services/whatsapp-web-bridge/.data/state-history-sync-20260714";
const LOG_PATH = "/tmp/aistart360-whatsapp-bridge.log";
const PORTAL_ORIGIN = "https://aistart360.vercel.app";

function fail(message) {
  throw new Error(message);
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function processEnvironment(pid) {
  const output = execFileSync("ps", ["eww", "-p", pid, "-o", "command="], {
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
  });
  return (name) => output.match(new RegExp(`(?:^|\\s)${name}=([^\\s]+)`))?.[1];
}

function alive(pid) {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

async function delay(milliseconds) {
  await new Promise((resolvePromise) =>
    setTimeout(resolvePromise, milliseconds),
  );
}

async function waitForExit(pid) {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (!alive(pid)) return;
    await delay(100);
  }
  fail("old bridge did not stop within its grace period");
}

async function waitForReady(child) {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    if (!alive(child.pid)) fail("new bridge exited before becoming ready");
    try {
      const response = await fetch("http://127.0.0.1:3100/ready", {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) {
        const value = await response.json();
        if (
          value?.ready === true &&
          value?.checks?.connected === true &&
          value?.checks?.outbox === true &&
          value?.checks?.auth_persist === true
        ) {
          return;
        }
      }
    } catch {
      // The socket/session can take a few seconds to reconnect.
    }
    await delay(500);
  }
  fail("new bridge did not become ready within 45 seconds");
}

async function main() {
  if (!process.argv.includes("--apply")) fail("refusing without --apply");
  const oldPid = argument("--pid");
  if (!oldPid || !/^\d+$/.test(oldPid) || !alive(oldPid)) {
    fail("--pid must identify the active bridge");
  }
  if (!existsSync(resolve(AUTH_DIR, "creds.json"))) {
    fail("paired auth state is missing; refusing to request a new QR");
  }
  if (!existsSync(resolve(STATE_DIR)))
    fail("bridge state directory is missing");

  const readOld = processEnvironment(oldPid);
  const apiSecret = readOld("BRIDGE_API_SECRET");
  const webhookSecret = readOld("PORTAL_WEBHOOK_SECRET");
  const sessionId = readOld("BRIDGE_SESSION_ID") || "primary";
  const deliveryMode =
    argument("--delivery-mode") ||
    readOld("WHATSAPP_WEB_DELIVERY_MODE") ||
    "direct";
  if (!new Set(["direct", "pull"]).has(deliveryMode)) {
    fail("--delivery-mode must be direct or pull");
  }
  if (
    !apiSecret ||
    !webhookSecret ||
    Buffer.byteLength(apiSecret, "utf8") < 32 ||
    Buffer.byteLength(webhookSecret, "utf8") < 32
  ) {
    fail("active bridge secrets are unavailable");
  }

  const current = await fetch("http://127.0.0.1:3100/ready", {
    signal: AbortSignal.timeout(2_000),
  });
  if (!current.ok) fail("active bridge is not ready for controlled cutover");

  process.kill(Number(oldPid), "SIGTERM");
  await waitForExit(oldPid);

  const environment = {
    ...process.env,
    NODE_ENV: "production",
    BRIDGE_HOST: "127.0.0.1",
    BRIDGE_PORT: "3100",
    BRIDGE_SESSION_ID: sessionId,
    BRIDGE_API_SECRET: apiSecret,
    BRIDGE_API_KEY_ID: readOld("BRIDGE_API_KEY_ID") || "primary",
    BRIDGE_AUTOSTART: "true",
    BRIDGE_AUTH_DIR: AUTH_DIR,
    BRIDGE_STATE_DIR: STATE_DIR,
    SYNC_FULL_HISTORY: "false",
    HISTORY_FULL_SYNC_MAINTENANCE: "false",
    FORCE_HISTORY_RESYNC: "false",
    PORTAL_WEBHOOK_URL: `${PORTAL_ORIGIN}/api/webhooks/whatsapp-web`,
    PORTAL_WEBHOOK_SECRET: webhookSecret,
    PORTAL_WEBHOOK_KEY_ID: readOld("PORTAL_WEBHOOK_KEY_ID") || "primary",
    PORTAL_JOB_DRAIN_URL: "/api/webhooks/whatsapp-web/drain",
    PORTAL_JOB_DRAIN_INTERVAL_MS: "10000",
    PORTAL_JOB_DRAIN_TIMEOUT_MS: "5000",
    WHATSAPP_WEB_DELIVERY_MODE: deliveryMode,
    PORTAL_OUTBOUND_READY_INTERVAL_MS: "1000",
    PORTAL_OUTBOUND_IDLE_INTERVAL_MS: "10000",
    PORTAL_OUTBOUND_OFFLINE_INTERVAL_MS: "10000",
    PORTAL_OUTBOUND_TIMEOUT_MS: "5000",
    CATCH_UP_MESSAGE_MAX_AGE_SECONDS: "1209600",
    CATCH_UP_MAX_MESSAGES_TOTAL: "200",
    CATCH_UP_MAX_MESSAGES_PER_CHAT: "20",
    HISTORY_BUFFER_MAX_CHUNKS: "64",
    HISTORY_BUFFER_MAX_CHATS: "5000",
    HISTORY_BUFFER_MAX_MESSAGES: "20000",
  };
  for (const name of [
    "BRIDGE_API_SECRET_PREVIOUS",
    "PORTAL_WEBHOOK_SECRET_PREVIOUS",
  ]) {
    const value = readOld(name);
    if (value) environment[name] = value;
  }

  const descriptor = openSync(LOG_PATH, "a", 0o600);
  chmodSync(LOG_PATH, 0o600);
  const child = spawn(
    process.execPath,
    ["services/whatsapp-web-bridge/server.mjs"],
    {
      cwd: process.cwd(),
      env: environment,
      detached: true,
      stdio: ["ignore", descriptor, descriptor],
    },
  );
  child.unref();
  closeSync(descriptor);
  if (!child.pid) fail("new bridge process did not start");
  writeFileSync(resolve(STATE_DIR, "bridge.pid"), `${child.pid}\n`, {
    mode: 0o600,
  });

  await waitForReady(child);
  const publicHealth = await fetch(
    "https://neighborhood-answer-beaver-rainbow.trycloudflare.com/health",
    { signal: AbortSignal.timeout(10_000) },
  );
  if (!publicHealth.ok)
    fail("public bridge tunnel is not healthy after cutover");
  const health = await publicHealth.json();
  if (health?.ok !== true || health?.connected !== true) {
    fail("public bridge tunnel is not connected after cutover");
  }
  console.log(`✓ Bridge cut over to production without QR (pid ${child.pid})`);
  console.log(`✓ Outbound delivery mode: ${deliveryMode}`);
  console.log("✓ WhatsApp connected, auth persisted, outbox healthy");
}

main().catch((error) => {
  console.error(
    `✗ ${error instanceof Error ? error.message : "restart failed"}`,
  );
  process.exit(1);
});
