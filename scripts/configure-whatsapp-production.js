#!/usr/bin/env node

/**
 * Copies the active bridge identity/secrets to the linked Vercel production
 * project without printing or writing them to disk. Non-secret production
 * switches and the current HTTPS bridge tunnel origin are set at the same time.
 *
 * Usage: node scripts/configure-whatsapp-production.js --apply --pid <pid>
 */

const { execFileSync, spawnSync } = require("node:child_process");

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
  const value = (name) => {
    const match = output.match(new RegExp(`(?:^|\\s)${name}=([^\\s]+)`));
    return match?.[1];
  };
  return {
    sessionId: value("BRIDGE_SESSION_ID"),
    apiSecret: value("BRIDGE_API_SECRET"),
    apiKeyId: value("BRIDGE_API_KEY_ID") || "primary",
    webhookSecret: value("PORTAL_WEBHOOK_SECRET"),
  };
}

async function bridgeOrigin() {
  const response = await fetch("http://127.0.0.1:20242/quicktunnel", {
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) fail("Cloudflare tunnel metrics are unavailable");
  const data = await response.json();
  if (
    !data ||
    typeof data.hostname !== "string" ||
    !/^[a-z0-9-]+\.trycloudflare\.com$/.test(data.hostname)
  ) {
    fail("Cloudflare tunnel hostname is invalid");
  }
  const origin = `https://${data.hostname}`;
  const health = await fetch(`${origin}/health`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!health.ok) fail("public bridge health check failed");
  const status = await health.json();
  if (status?.ok !== true || status?.connected !== true) {
    fail("public bridge is not connected");
  }
  return origin;
}

function setVariable(name, value, sensitive) {
  if (!value) fail(`${name} is missing`);
  const result = spawnSync(
    "vercel",
    [
      "env",
      "add",
      name,
      "production",
      "--force",
      sensitive ? "--sensitive" : "--no-sensitive",
      "--yes",
    ],
    { input: `${value}\n`, encoding: "utf8" },
  );
  if (result.status !== 0) fail(`Vercel rejected ${name}`);
  console.log(`✓ ${name}`);
}

async function main() {
  if (!process.argv.includes("--apply")) {
    fail("refusing to configure production without --apply");
  }
  const pid = argument("--pid");
  if (!pid || !/^\d+$/.test(pid)) fail("--pid must identify the live bridge");

  const bridge = processEnvironment(pid);
  if (!bridge.sessionId || !bridge.apiSecret || !bridge.webhookSecret) {
    fail("live bridge environment is incomplete");
  }
  if (
    Buffer.byteLength(bridge.apiSecret, "utf8") < 32 ||
    Buffer.byteLength(bridge.webhookSecret, "utf8") < 32
  ) {
    fail("live bridge secrets do not meet the 32-byte minimum");
  }
  if (bridge.apiSecret === bridge.webhookSecret) {
    fail("bridge control and webhook secrets must be different");
  }

  const origin = await bridgeOrigin();
  for (const [name, value, sensitive] of [
    ["WHATSAPP_WEB_BRIDGE_ENABLED", "true", false],
    ["WHATSAPP_WEB_BRIDGE_URL", origin, false],
    ["WHATSAPP_WEB_BRIDGE_SESSION_ID", bridge.sessionId, false],
    ["WHATSAPP_WEB_BRIDGE_API_SECRET", bridge.apiSecret, true],
    ["WHATSAPP_WEB_BRIDGE_API_KEY_ID", bridge.apiKeyId, false],
    ["WHATSAPP_WEB_BRIDGE_WEBHOOK_SECRET", bridge.webhookSecret, true],
    ["WHATSAPP_WEB_BRIDGE_TIMEOUT_MS", "10000", false],
    ["OMNICHANNEL_PROCESSING_BACKEND", "database", false],
    ["OMNICHANNEL_PERSISTENCE", "postgres", false],
  ]) {
    setVariable(name, value, sensitive);
  }
  console.log(
    "✓ WhatsApp production variables configured without exposing secrets",
  );
}

main().catch((error) => {
  console.error(
    `✗ ${error instanceof Error ? error.message : "configuration failed"}`,
  );
  process.exit(1);
});
