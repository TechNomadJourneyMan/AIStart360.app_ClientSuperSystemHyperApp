export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { authorizeOutboundDeliveryViaPostgres } from "@/lib/omnichannel/outbound-deliveries";
import { verifyWhatsAppPortalPullRequest } from "@/lib/omnichannel/whatsapp-web-portal-route";

const PATH = "/api/webhooks/whatsapp-web/outbound/authorize";
const schema = z
  .object({
    version: z.literal(1),
    session_id: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
    delivery_id: z.string().uuid(),
    lease_token: z.string().uuid(),
  })
  .strict();

function response(body: Record<string, unknown>, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const verified = await verifyWhatsAppPortalPullRequest(req, PATH, 2_048);
  if (!verified.ok) return response({ ok: false }, verified.status);
  const parsed = schema.safeParse(verified.payload);
  if (!parsed.success) return response({ ok: false }, 400);
  if (parsed.data.session_id !== verified.sessionId) {
    return response({ ok: false }, 403);
  }

  try {
    const delivery = await authorizeOutboundDeliveryViaPostgres({
      deliveryId: parsed.data.delivery_id,
      leaseToken: parsed.data.lease_token,
      sessionId: parsed.data.session_id,
      authorizedLeaseSeconds: 180,
    });
    if (!delivery.authorized) {
      return response({ ok: true, authorized: false, reason: delivery.reason });
    }
    if (!delivery.recipient || !delivery.text || !delivery.idempotencyKey) {
      return response({ ok: false }, 503);
    }
    return response({
      ok: true,
      authorized: true,
      delivery: {
        recipient: delivery.recipient,
        text: delivery.text,
        reply_to_external_id: delivery.replyToExternalId,
        idempotency_key: delivery.idempotencyKey,
      },
    });
  } catch {
    return response({ ok: false }, 503);
  }
}
