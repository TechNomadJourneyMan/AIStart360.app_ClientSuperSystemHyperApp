export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

import { NextResponse, type NextRequest } from "next/server";
import { webhookRefusal } from "@/lib/runtime/webhook-log";
import { z } from "zod";
import {
  claimBridgeCommand,
  createSupabaseBridgeControlStore,
} from "@/lib/omnichannel/whatsapp-bridge-control";
import {
  logBridgeFailure,
  verifyWhatsAppBridgeControlRequest,
} from "@/lib/omnichannel/whatsapp-web-portal-route";

/** Bridge claims the in-flight session command (connect / logout), if any. */
const PATH = "/api/webhooks/whatsapp-web/commands/claim";
const schema = z
  .object({
    version: z.literal(1),
    session_id: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
  })
  .strict();

function response(body: Record<string, unknown>, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // R-060: one structured line per refusal (route, status, reason, request id) — never the body, a
  // header value, a QR or a message text. A store failure keeps its own one line (logBridgeFailure).
  const refuse = webhookRefusal("webhooks/whatsapp-web/commands/claim", req);
  const refused = (status: number) => response({ ok: false }, status);
  const verified = await verifyWhatsAppBridgeControlRequest(req, PATH, 1_024);
  if (!verified.ok) return refuse(verified.status, verified.reason, refused);
  const parsed = schema.safeParse(verified.payload);
  if (!parsed.success) return refuse(400, "invalid_payload", refused);
  if (parsed.data.session_id !== verified.sessionId) {
    return refuse(403, "session_mismatch", refused);
  }

  try {
    const command = await claimBridgeCommand(createSupabaseBridgeControlStore(), {
      sessionId: parsed.data.session_id,
    });
    return response({
      ok: true,
      command: command
        ? {
            command_id: command.id,
            action: command.action,
            lease_token: command.leaseToken,
            expires_at: command.expiresAt,
          }
        : null,
    });
  } catch (error) {
    logBridgeFailure("commands/claim", error);
    return response({ ok: false }, 503);
  }
}
