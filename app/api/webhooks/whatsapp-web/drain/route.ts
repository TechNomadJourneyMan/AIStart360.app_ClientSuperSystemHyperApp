export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A single AI job can legitimately consume two bounded model attempts plus
// the configured human-like reply delay. Keep the function budget above the
// queue lease/LLM budget and process one job per signed kick so Vercel does not
// terminate a batch halfway through multiple sequential jobs.
export const maxDuration = 300;

import { waitUntil } from "@vercel/functions";
import { NextResponse, type NextRequest } from "next/server";
import { drainOmnichannelProcessingJobs } from "@/lib/omnichannel/process-job-queue";
import { shouldUseOmnichannelPostgres } from "@/lib/omnichannel/postgres-runtime";
import {
  verifySignedBridgeRequest,
  WHATSAPP_WEB_PORTAL_AUDIENCE,
} from "@/lib/omnichannel/whatsapp-web-signature";

const DRAIN_PATH = "/api/webhooks/whatsapp-web/drain";
const MAX_BODY_BYTES = 1_024;
const MAX_REPLAY_ENTRIES = 2_048;
const REPLAY_TTL_SECONDS = 120;

const globalReplayState = globalThis as typeof globalThis & {
  __aistart360WhatsAppDrainNonces?: Map<string, number>;
};

interface DrainPayload {
  version: 1;
  session_id: string;
}

function enabled(value: string | undefined): boolean {
  return /^(?:1|true|yes|on)$/i.test(value?.trim() ?? "");
}

function hmacSecret(value: string | undefined): string | undefined {
  const secret = value?.trim();
  return secret && Buffer.byteLength(secret, "utf8") >= 32 ? secret : undefined;
}

function response(status: number): NextResponse {
  return NextResponse.json(
    { ok: status >= 200 && status < 300 },
    { status, headers: { "cache-control": "no-store" } },
  );
}

function parsePayload(value: unknown): DrainPayload | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== 2 || keys[0] !== "session_id" || keys[1] !== "version") {
    return null;
  }
  if (record.version !== 1) return null;
  if (
    typeof record.session_id !== "string" ||
    !/^[A-Za-z0-9._:-]{1,128}$/.test(record.session_id)
  ) {
    return null;
  }
  return { version: 1, session_id: record.session_id };
}

/** Best-effort warm-instance replay guard; queue leases make cross-instance replay harmless. */
function acceptNonce(nonce: string, timestamp: number): boolean {
  const nonces =
    globalReplayState.__aistart360WhatsAppDrainNonces ??
    new Map<string, number>();
  globalReplayState.__aistart360WhatsAppDrainNonces = nonces;
  const cutoff = Math.trunc(Date.now() / 1_000) - REPLAY_TTL_SECONDS;
  for (const [candidate, seenAt] of nonces) {
    if (seenAt < cutoff) nonces.delete(candidate);
  }
  if (nonces.has(nonce)) return false;
  nonces.set(nonce, timestamp);
  while (nonces.size > MAX_REPLAY_ENTRIES) {
    const oldest = nonces.keys().next().value as string | undefined;
    if (!oldest) break;
    nonces.delete(oldest);
  }
  return true;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!enabled(process.env.WHATSAPP_WEB_BRIDGE_ENABLED)) return response(503);
  if (
    process.env.OMNICHANNEL_PROCESSING_BACKEND?.trim().toLowerCase() !==
    "database"
  ) {
    return response(503);
  }
  if (!shouldUseOmnichannelPostgres()) return response(503);

  const secret = hmacSecret(process.env.WHATSAPP_WEB_BRIDGE_WEBHOOK_SECRET);
  if (!secret) return response(503);
  if (
    !req.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  ) {
    return response(415);
  }
  const declaredLength = Number(req.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return response(413);
  }

  let rawBody: Buffer;
  try {
    rawBody = Buffer.from(await req.arrayBuffer());
  } catch {
    return response(400);
  }
  if (rawBody.byteLength > MAX_BODY_BYTES) return response(413);

  const verified = verifySignedBridgeRequest({
    method: "POST",
    path: DRAIN_PATH,
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
  if (!verified.ok) return response(401);

  let payload: DrainPayload | null = null;
  try {
    payload = parsePayload(JSON.parse(rawBody.toString("utf8")) as unknown);
  } catch {
    // Rejected below without exposing parser details.
  }
  if (!payload) return response(400);
  const configuredSession =
    process.env.WHATSAPP_WEB_BRIDGE_SESSION_ID?.trim() || "primary";
  if (payload.session_id !== configuredSession) return response(403);
  if (!acceptNonce(verified.nonce, verified.timestamp)) return response(409);

  const work = drainOmnichannelProcessingJobs({ limit: 1 }).catch(() => {
    // The next signed kick retries due jobs. No exception/customer prose is
    // logged or returned from this endpoint.
  });
  try {
    waitUntil(work);
  } catch {
    // The promise has already started in a non-Vercel Node runtime.
  }
  return response(202);
}
