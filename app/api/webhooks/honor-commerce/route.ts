export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyMetaWebhookSignature } from "@/lib/omnichannel/meta-webhook";
import { createServiceClient } from "@/lib/supabase-service";
const schema = z
  .object({
    source_event_id: z.string().min(1).max(160),
    message_id: z.string().uuid(),
    event_type: z.enum(["click", "cart", "order", "paid"]),
    order_external_id: z.string().max(160).optional(),
    occurred_at: z.string().datetime(),
  })
  .strict();
export async function POST(req: NextRequest) {
  const secret = process.env.HONOR_COMMERCE_WEBHOOK_SECRET;
  if (!secret || secret.length < 32)
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  if (Number(req.headers.get("content-length") ?? 0) > 8192)
    return new NextResponse(null, { status: 413 });
  const raw = await req.text();
  if (Buffer.byteLength(raw) > 8192)
    return new NextResponse(null, { status: 413 });
  if (
    !verifyMetaWebhookSignature(
      raw,
      req.headers.get("x-hub-signature-256"),
      secret,
    )
  )
    return new NextResponse(null, { status: 401 });
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  const p = schema.safeParse(payload);
  if (!p.success) return new NextResponse(null, { status: 400 });
  if (Math.abs(Date.now() - Date.parse(p.data.occurred_at)) > 24 * 3600000)
    return NextResponse.json({ error: "stale_event" }, { status: 400 });
  try {
    const r = await createServiceClient().rpc(
      "honor_record_commerce_evidence",
      { p_event: p.data },
    );
    if (r.error)
      return NextResponse.json({ error: "evidence_rejected" }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch {
    return new NextResponse(null, { status: 503 });
  }
}
