export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

import { NextResponse, type NextRequest } from "next/server";
import { webhookRefusal } from "@/lib/runtime/webhook-log";
import { z } from "zod";
import { reportOutboundDeliveryViaPostgres } from "@/lib/omnichannel/outbound-deliveries";
import {
  logBridgeFailure,
  verifyWhatsAppPortalPullRequest,
} from "@/lib/omnichannel/whatsapp-web-portal-route";

const PATH = "/api/webhooks/whatsapp-web/outbound/result";
const base = {
  version: z.literal(1),
  session_id: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
  delivery_id: z.string().uuid(),
  lease_token: z.string().uuid(),
};
const schema = z.discriminatedUnion("outcome", [
  z
    .object({
      ...base,
      outcome: z.literal("sent"),
      provider_message_id: z
        .string()
        .min(1)
        .max(256)
        .regex(/^[A-Za-z0-9._:/+=-]+$/),
    })
    .strict(),
  z
    .object({
      ...base,
      outcome: z.enum(["retryable_failure", "delivery_unknown"]),
      error_code: z.string().regex(/^[a-z0-9][a-z0-9._:-]{0,119}$/),
    })
    .strict(),
]);

function response(body: Record<string, unknown>, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // R-060: one structured line per refusal (route, status, reason, request id) — never the body, a
  // header value, a QR or a message text. A store failure keeps its own one line (logBridgeFailure).
  const refuse = webhookRefusal("webhooks/whatsapp-web/outbound/result", req);
  const refused = (status: number) => response({ ok: false }, status);
  const verified = await verifyWhatsAppPortalPullRequest(req, PATH, 2_048);
  if (!verified.ok) return refuse(verified.status, verified.reason, refused);
  const parsed = schema.safeParse(verified.payload);
  if (!parsed.success) return refuse(400, "invalid_payload", refused);
  if (parsed.data.session_id !== verified.sessionId) {
    return refuse(403, "session_mismatch", refused);
  }

  try {
    const common = {
      deliveryId: parsed.data.delivery_id,
      leaseToken: parsed.data.lease_token,
      sessionId: parsed.data.session_id,
    };
    const result = parsed.data.outcome === "sent"
      ? await reportOutboundDeliveryViaPostgres({
          ...common,
          outcome: "sent",
          providerMessageId: parsed.data.provider_message_id,
        })
      : await reportOutboundDeliveryViaPostgres({
          ...common,
          outcome: parsed.data.outcome,
          errorCode: parsed.data.error_code,
        });
    const body = {
      ok: result.accepted,
      accepted: result.accepted,
      status: result.status,
      external_message_id: result.externalMessageId,
    };
    // A result the lease no longer allows (another worker took the delivery) is refused with 409.
    if (!result.accepted) return refuse(409, "result_not_accepted", (status) => response(body, status));
    return response(body);
  } catch (error) {
    logBridgeFailure("outbound/result", error);
    return response({ ok: false }, 503);
  }
}
