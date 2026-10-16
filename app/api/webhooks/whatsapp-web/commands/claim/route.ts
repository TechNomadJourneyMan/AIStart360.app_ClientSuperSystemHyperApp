export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  claimBridgeCommand,
  createSupabaseBridgeControlStore,
} from "@/lib/omnichannel/whatsapp-bridge-control";
import { verifyWhatsAppBridgeControlRequest } from "@/lib/omnichannel/whatsapp-web-portal-route";

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
  const verified = await verifyWhatsAppBridgeControlRequest(req, PATH, 1_024);
  if (!verified.ok) return response({ ok: false }, verified.status);
  const parsed = schema.safeParse(verified.payload);
  if (!parsed.success) return response({ ok: false }, 400);
  if (parsed.data.session_id !== verified.sessionId) {
    return response({ ok: false }, 403);
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
  } catch {
    return response({ ok: false }, 503);
  }
}
