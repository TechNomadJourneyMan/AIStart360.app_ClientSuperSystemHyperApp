export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { claimOutboundDeliveryViaPostgres } from "@/lib/omnichannel/outbound-deliveries";
import { verifyWhatsAppPortalPullRequest } from "@/lib/omnichannel/whatsapp-web-portal-route";

const PATH = "/api/webhooks/whatsapp-web/outbound/claim";
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
  const verified = await verifyWhatsAppPortalPullRequest(req, PATH, 1_024);
  if (!verified.ok) return response({ ok: false }, verified.status);
  const parsed = schema.safeParse(verified.payload);
  if (!parsed.success) return response({ ok: false }, 400);
  if (parsed.data.session_id !== verified.sessionId) {
    return response({ ok: false }, 403);
  }

  try {
    const delivery = await claimOutboundDeliveryViaPostgres({
      sessionId: parsed.data.session_id,
      leaseSeconds: 180,
    });
    return response({
      ok: true,
      delivery: delivery
        ? {
            delivery_id: delivery.id,
            lease_token: delivery.leaseToken,
            lease_until: delivery.leaseUntil,
            recipient: delivery.recipient,
            typing_delay_ms: delivery.typingDelayMs,
          }
        : null,
    });
  } catch {
    return response({ ok: false }, 503);
  }
}
