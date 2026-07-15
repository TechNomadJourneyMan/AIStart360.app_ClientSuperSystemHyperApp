#!/usr/bin/env node

/**
 * Loopback-only fallback for the AIStart360 portal while the public Vercel
 * deployment is unavailable. The database URL is inherited from Vercel's
 * owner-only env file and the bridge HMAC secret is read from macOS Keychain;
 * neither is stored in the LaunchAgent, argv, repository, or logs.
 */

const { spawn, spawnSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const { resolve } = require("node:path");

const PORTAL_SECRET_SERVICE = "AIStart360 WhatsApp Portal Secret";
const NEXT_ENTRY = resolve("node_modules/next/dist/bin/next");
const NEXT_BUILD = resolve(".next/BUILD_ID");

function fail(message) {
  console.error(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "error",
      service: "aistart360-portal-local-launcher",
      event: "launcher_failed",
      reason: message,
    }),
  );
  process.exit(1);
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

if (!existsSync(NEXT_ENTRY) || !existsSync(NEXT_BUILD)) {
  fail("production Next.js build is unavailable");
}

const databaseUrl =
  process.env.OMNICHANNEL_DATABASE_URL?.trim() ||
  process.env.DIRECT_URL?.trim();
if (!databaseUrl) fail("omnichannel database URL is unavailable");
if (!process.env.OPENROUTER_API_KEY?.trim()) {
  fail("OpenRouter API key is unavailable");
}
const portalSecret = keychainSecret(PORTAL_SECRET_SERVICE);

const child = spawn(
  process.execPath,
  [NEXT_ENTRY, "start", "--hostname", "127.0.0.1", "--port", "3200"],
  {
    cwd: process.cwd(),
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: "production",
      OMNICHANNEL_PROCESSING_BACKEND: "database",
      OMNICHANNEL_PERSISTENCE: "postgres",
      OMNICHANNEL_DIRECT_POSTGRES_ENABLED: "true",
      OMNICHANNEL_DATABASE_URL: databaseUrl,
      WHATSAPP_WEB_BRIDGE_ENABLED: "true",
      WHATSAPP_WEB_BRIDGE_SESSION_ID: "primary",
      WHATSAPP_WEB_BRIDGE_WEBHOOK_SECRET: portalSecret,
      WHATSAPP_WEB_DELIVERY_MODE: "pull",
    },
  },
);

for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) {
  process.on(signal, () => {
    if (!child.killed) child.kill(signal);
  });
}

child.once("error", () => fail("portal child could not be started"));
child.once("exit", (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
