#!/usr/bin/env node

/**
 * LaunchAgent entrypoint for the already-paired WhatsApp Web bridge.
 * Secrets are read from the logged-in user's macOS Keychain and are never
 * stored in the plist, repository, argv, or logs.
 */

const { spawn, spawnSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const { resolve } = require("node:path");

const BRIDGE_SECRET_SERVICE = "AIStart360 WhatsApp Bridge API Secret";
const PORTAL_SECRET_SERVICE = "AIStart360 WhatsApp Portal Secret";
const SESSION_ID = "primary";
const DEFAULT_PORTAL_ORIGIN = "https://aistart360.vercel.app";
const AUTH_DIR = resolve(
  "services/whatsapp-web-bridge/.data/auth-history-sync-20260714",
);
const STATE_DIR = resolve(
  "services/whatsapp-web-bridge/.data/state-history-sync-20260714",
);

function fail(message) {
  console.error(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "error",
      service: "whatsapp-web-bridge-launcher",
      event: "launcher_failed",
      reason: message,
    }),
  );
  process.exit(1);
}

function portalOrigin() {
  const raw =
    process.env.AISTART360_PORTAL_ORIGIN?.trim() || DEFAULT_PORTAL_ORIGIN;
  let url;
  try {
    url = new URL(raw);
  } catch {
    fail("portal origin is invalid");
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    fail("portal origin must not contain credentials, path, query, or fragment");
  }
  const loopback = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  const localFallbackAllowed =
    loopback &&
    process.env.AISTART360_ALLOW_INSECURE_LOCALHOST === "true" &&
    url.protocol === "http:";
  if (url.protocol !== "https:" && !localFallbackAllowed) {
    fail("portal origin must use HTTPS unless the explicit loopback fallback is enabled");
  }
  return url.origin;
}

function keychainSecret(service) {
  const result = spawnSync(
    "/usr/bin/security",
    [
      "find-generic-password",
      "-w",
      "-a",
      process.env.USER || "admin",
      "-s",
      service,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  const value = result.status === 0 ? result.stdout.trim() : "";
  if (Buffer.byteLength(value, "utf8") < 32) {
    fail("required Keychain secret is unavailable");
  }
  return value;
}

if (!existsSync(resolve(AUTH_DIR, "creds.json"))) {
  fail("paired WhatsApp auth state is unavailable");
}
if (!existsSync(STATE_DIR)) fail("bridge state directory is unavailable");

const bridgeSecret = keychainSecret(BRIDGE_SECRET_SERVICE);
const portalSecret = keychainSecret(PORTAL_SECRET_SERVICE);
if (bridgeSecret === portalSecret) fail("bridge and portal secrets must differ");
const PORTAL_ORIGIN = portalOrigin();

const child = spawn(
  process.execPath,
  ["services/whatsapp-web-bridge/server.mjs"],
  {
    cwd: process.cwd(),
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: "production",
      LOG_FORMAT: "json",
      BRIDGE_HOST: "127.0.0.1",
      BRIDGE_PORT: "3100",
      BRIDGE_SESSION_ID: SESSION_ID,
      BRIDGE_API_SECRET: bridgeSecret,
      BRIDGE_API_KEY_ID: "primary",
      BRIDGE_AUTOSTART: "true",
      BRIDGE_AUTH_DIR: AUTH_DIR,
      BRIDGE_STATE_DIR: STATE_DIR,
      SYNC_FULL_HISTORY: "false",
      HISTORY_FULL_SYNC_MAINTENANCE: "false",
      FORCE_HISTORY_RESYNC: "false",
      PORTAL_WEBHOOK_URL: `${PORTAL_ORIGIN}/api/webhooks/whatsapp-web`,
      ALLOW_INSECURE_LOCALHOST:
        process.env.AISTART360_ALLOW_INSECURE_LOCALHOST === "true"
          ? "true"
          : "false",
      PORTAL_WEBHOOK_SECRET: portalSecret,
      PORTAL_WEBHOOK_KEY_ID: "primary",
      PORTAL_JOB_DRAIN_URL: "/api/webhooks/whatsapp-web/drain",
      PORTAL_JOB_DRAIN_INTERVAL_MS: "10000",
      PORTAL_JOB_DRAIN_TIMEOUT_MS: "5000",
      WHATSAPP_WEB_DELIVERY_MODE: "pull",
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
    },
  },
);

for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) {
  process.on(signal, () => {
    if (!child.killed) child.kill(signal);
  });
}

child.once("error", () => fail("bridge child could not be started"));
child.once("exit", (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
