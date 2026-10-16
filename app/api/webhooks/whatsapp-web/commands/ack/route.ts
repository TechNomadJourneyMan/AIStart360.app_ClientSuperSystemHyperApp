export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  ackBridgeCommand,
  createSupabaseBridgeControlStore,
} from "@/lib/omnichannel/whatsapp-bridge-control";
import { verifyWhatsAppBridgeControlRequest } from "@/lib/omnichannel/whatsapp-web-portal-route";

/** Bridge reports the outcome of a claimed command under its lease token. */
const PATH = "/api/webhooks/whatsapp-web/commands/ack";
const uuid = z.string().uuid();
const schema = z
  .object({
    version: z.literal(1),
    session_id: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
    command_id: uuid,
    lease_token: uuid,
    outcome: z.enum(["succeeded", "failed"]),
    error_code: z.string().regex(/^[a-z0-9][a-z0-9._:-]{0,79}$/).optional(),
  })
  .strict();

function response(body: Record<string, unknown>, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const verified = await verifyWhatsAppBridgeControlRequest(req, PATH, 1_024);
  if (!verified.ok) return response({ ok: false }, verified.status);
  const parsed = schema.safeParse(verified.payload);
  if (!parsed.success) return response({ ok: false }, 400);
  if (parsed.data.session_id !== verified.sessionId) {
    return response({ ok: false }, 403);
  }

  try {
    const result = await ackBridgeCommand(createSupabaseBridgeControlStore(), {
      sessionId: parsed.data.session_id,
      commandId: parsed.data.command_id,
      leaseToken: parsed.data.lease_token,
      outcome: parsed.data.outcome,
      errorCode: parsed.data.error_code ?? null,
    });
    return response({ ok: true, accepted: result.accepted });
  } catch {
    return response({ ok: false }, 503);
  }
}
