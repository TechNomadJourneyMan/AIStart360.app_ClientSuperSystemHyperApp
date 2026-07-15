import type { NextRequest } from "next/server";
import {
  verifySignedBridgeRequest,
  WHATSAPP_WEB_PORTAL_AUDIENCE,
} from "./whatsapp-web-signature";
import { shouldUseOmnichannelPostgres } from "./postgres-runtime";

const MAX_REPLAY_ENTRIES = 4_096;
const REPLAY_TTL_SECONDS = 120;

const globalReplayState = globalThis as typeof globalThis & {
  __aistart360WhatsAppPortalNonces?: Map<string, number>;
};

export type VerifiedWhatsAppPortalRequest =
  | { ok: true; rawBody: Buffer; payload: unknown; sessionId: string }
  | { ok: false; status: number };

function enabled(value: string | undefined): boolean {
  return /^(?:1|true|yes|on)$/i.test(value?.trim() ?? "");
}

function hmacSecret(value: string | undefined): string | undefined {
  const secret = value?.trim();
  return secret && Buffer.byteLength(secret, "utf8") >= 32 ? secret : undefined;
}

function acceptNonce(path: string, nonce: string, timestamp: number): boolean {
  const nonces =
    globalReplayState.__aistart360WhatsAppPortalNonces ?? new Map<string, number>();
  globalReplayState.__aistart360WhatsAppPortalNonces = nonces;
  const cutoff = Math.trunc(Date.now() / 1_000) - REPLAY_TTL_SECONDS;
  for (const [candidate, seenAt] of nonces) {
    if (seenAt < cutoff) nonces.delete(candidate);
  }
  const key = `${path}:${nonce}`;
  if (nonces.has(key)) return false;
  nonces.set(key, timestamp);
  while (nonces.size > MAX_REPLAY_ENTRIES) {
    const oldest = nonces.keys().next().value as string | undefined;
    if (!oldest) break;
    nonces.delete(oldest);
  }
  return true;
}

/**
 * Shared fail-closed verifier for bridge-to-portal pull endpoints. It verifies
 * the exact raw body before JSON parsing and never returns credential details.
 */
export async function verifyWhatsAppPortalPullRequest(
  req: NextRequest,
  path: string,
  maxBodyBytes = 4_096,
): Promise<VerifiedWhatsAppPortalRequest> {
  if (!enabled(process.env.WHATSAPP_WEB_BRIDGE_ENABLED)) {
    return { ok: false, status: 503 };
  }
  // Consumer endpoints stay available in direct mode so a bridge can be
  // switched to pull first and drain residual work during rollback. Only
  // producers are gated by WHATSAPP_WEB_DELIVERY_MODE.
  if (!shouldUseOmnichannelPostgres()) {
    return { ok: false, status: 503 };
  }
  const secret = hmacSecret(process.env.WHATSAPP_WEB_BRIDGE_WEBHOOK_SECRET);
  if (!secret) return { ok: false, status: 503 };
  if (
    !req.headers.get("content-type")?.toLowerCase().startsWith("application/json")
  ) {
    return { ok: false, status: 415 };
  }
  const declaredLength = Number(req.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
    return { ok: false, status: 413 };
  }

  let rawBody: Buffer;
  try {
    rawBody = Buffer.from(await req.arrayBuffer());
  } catch {
    return { ok: false, status: 400 };
  }
  if (rawBody.byteLength > maxBodyBytes) return { ok: false, status: 413 };

  const verified = verifySignedBridgeRequest({
    method: "POST",
    path,
    body: rawBody,
    headers: req.headers,
    expectedAudience: WHATSAPP_WEB_PORTAL_AUDIENCE,
    secrets: {
      primary: secret,
      previous: hmacSecret(
        process.env.WHATSAPP_WEB_BRIDGE_WEBHOOK_SECRET_PREVIOUS,
      ),
    },
    maxSkewSeconds: 60,
  });
  if (!verified.ok) return { ok: false, status: 401 };
  if (!acceptNonce(path, verified.nonce, verified.timestamp)) {
    return { ok: false, status: 409 };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody.toString("utf8")) as unknown;
  } catch {
    return { ok: false, status: 400 };
  }
  const sessionId = process.env.WHATSAPP_WEB_BRIDGE_SESSION_ID?.trim() || "primary";
  return { ok: true, rawBody, payload, sessionId };
}
