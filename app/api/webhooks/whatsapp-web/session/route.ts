export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  BRIDGE_PUSHED_STATES,
  createSupabaseBridgeControlStore,
  recordBridgeStatus,
} from "@/lib/omnichannel/whatsapp-bridge-control";
import { verifyWhatsAppBridgeControlRequest } from "@/lib/omnichannel/whatsapp-web-portal-route";

/**
 * Bridge → portal session status push (WHATSAPP_WEB_BRIDGE_CONTROL=pull).
 * Signed with the portal webhook secret. The raw pairing QR is accepted only
 * while state = 'qr', stored until it expires and never echoed or logged.
 */
const PATH = "/api/webhooks/whatsapp-web/session";
const isoString = z.string().min(10).max(40);
const schema = z
  .object({
    version: z.literal(1),
    session_id: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
    state: z.enum(BRIDGE_PUSHED_STATES),
    connected: z.boolean(),
    updated_at: isoString.nullable(),
    qr: z.string().min(1).max(8_192).nullable(),
    qr_expires_at: isoString.nullable(),
    error_code: z.string().regex(/^[A-Za-z0-9._:-]{1,80}$/).nullable(),
    bridge_version: z.string().regex(/^[A-Za-z0-9._+-]{1,32}$/).nullable().optional(),
  })
  .strict()
  .refine((value) => value.state === "qr" || value.qr === null, {
    message: "qr is only allowed while pairing",
  });

function response(body: Record<string, unknown>, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const verified = await verifyWhatsAppBridgeControlRequest(req, PATH, 16_384);
  if (!verified.ok) return response({ ok: false }, verified.status);
  const parsed = schema.safeParse(verified.payload);
  if (!parsed.success) return response({ ok: false }, 400);
  if (parsed.data.session_id !== verified.sessionId) {
    return response({ ok: false }, 403);
  }

  try {
    await recordBridgeStatus(createSupabaseBridgeControlStore(), {
      sessionId: parsed.data.session_id,
      state: parsed.data.state,
      connected: parsed.data.connected,
      qr: parsed.data.qr,
      qrExpiresAt: parsed.data.qr_expires_at,
      errorCode: parsed.data.error_code,
      updatedAt: parsed.data.updated_at,
      bridgeVersion: parsed.data.bridge_version ?? null,
    });
    return response({ ok: true });
  } catch {
    return response({ ok: false }, 503);
  }
}
