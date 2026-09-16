export const dynamic = "force-dynamic";
export const maxDuration = 60;
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getGigaActor } from "@/lib/admin/giga-actor";
import { createServiceClient } from "@/lib/supabase-service";
import { logAudit } from "@/lib/audit";
import { isRateLimitedKey } from "@/lib/rate-limit";
import {
  honorConfig,
  honorConfigSchema,
  HONOR_SCENARIOS,
} from "@/lib/omnichannel/honor-policy";
import { honorMetrics } from "@/lib/omnichannel/honor-metrics";
import {
  selectHonorProducts,
  buildHonorReply,
} from "@/lib/omnichannel/honor-catalog";
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
const filters = z
  .object({
    from: z.string().datetime(),
    to: z.string().datetime(),
    channel: z.enum(["whatsapp", "instagram"]).optional(),
    account: z.string().max(120).optional(),
    manager: z.string().max(120).optional(),
  })
  .refine(
    (x) =>
      Date.parse(x.to) > Date.parse(x.from) &&
      Date.parse(x.to) - Date.parse(x.from) <= 93 * 86400000,
  );
export async function GET(req: NextRequest) {
  const actor = await getGigaActor(req);
  if (!actor) return json({ error: "Forbidden" }, 403);
  const parsed = filters.safeParse({
    from:
      req.nextUrl.searchParams.get("from") ??
      new Date(Date.now() - 30 * 86400000).toISOString(),
    to: req.nextUrl.searchParams.get("to") ?? new Date().toISOString(),
    ...Object.fromEntries(
      ["channel", "account", "manager"].flatMap((k) =>
        req.nextUrl.searchParams.get(k)
          ? [[k, req.nextUrl.searchParams.get(k)]]
          : [],
      ),
    ),
  });
  if (!parsed.success)
    return json({ error: "Выберите период до 93 дней" }, 400);
  try {
    const sb = createServiceClient();
    const f = parsed.data;
    const settings = await sb
      .from("omnichannel_settings")
      .select("channel,mode,enabled,automation_config");
    const products = await sb
      .from("ecommerce_products")
      .select("user_id,company_id")
      .eq("source", "myhonor.shop")
      .limit(501);
    const conversationRows = [];
    let partial = false;
    for (let offset = 0; offset < 20000; offset += 1000) {
      let cq = sb
        .from("omnichannel_conversations")
        .select("id,channel,account_external_id,status,auto_reply_override")
        .order("id")
        .range(offset, offset + 999);
      if (f.channel) cq = cq.eq("channel", f.channel);
      if (f.account) cq = cq.eq("account_external_id", f.account);
      const page = await cq;
      if (page.error) throw new Error("storage");
      conversationRows.push(...page.data);
      if (page.data.length < 1000) break;
      if (offset === 19000) partial = true;
    }
    const conversations = { data: conversationRows };
    if (settings.error || products.error) throw new Error("storage");
    const messages = [];
    // Page through the selected observation period; do not silently rely on PostgREST's row cap.
    for (let offset = 0; offset < 20000; offset += 1000) {
      let q = sb
        .from("omnichannel_messages")
        .select(
          "id,conversation_id,channel,direction,status,occurred_at,ai_generated,metadata",
        )
        .gte("occurred_at", f.from)
        .lt("occurred_at", f.to)
        .order("occurred_at")
        .order("id")
        .range(offset, offset + 999);
      if (f.channel) q = q.eq("channel", f.channel);
      const r = await q;
      if (r.error) throw new Error("storage");
      messages.push(...r.data);
      if (r.data.length < 1000) break;
      if (offset === 19000) partial = true;
    }
    const e = await sb
      .from("honor_commerce_metrics")
      .select("message_id,event_type,confirmed_revenue,source_event_id")
      .gte("occurred_at", f.from)
      .lt("occurred_at", f.to)
      .limit(1001);
    if (e.error) throw new Error("storage");
    if (e.data.length >= 1000) partial = true;
    const bindings = [
      ...new Map(
        products.data.map((p) => [p.user_id + ":" + p.company_id, p]),
      ).values(),
    ];
    return json({
      settings: settings.data.map((s) => ({
        ...s,
        automation_config: undefined,
        honor: honorConfig(s.automation_config?.honor_ai),
      })),
      binding:
        bindings.length === 1 && products.data.length < 501
          ? bindings[0]
          : null,
      defaults: HONOR_SCENARIOS,
      accounts: [
        ...new Set(conversations.data.map((c) => c.account_external_id)),
      ],
      metrics: honorMetrics(messages, conversations.data, e.data, {
        ...f,
        partial,
      }),
      readiness: {
        cloudConfigured:
          !!process.env.WHATSAPP_TOKEN &&
          !!process.env.WHATSAPP_PHONE_NUMBER_ID &&
          !!process.env.META_APP_SECRET,
        commerceConfigured: !!process.env.HONOR_COMMERCE_WEBHOOK_SECRET,
        autoVerified: settings.data.some(
          (s) =>
            s.automation_config?.honor_verified_account ===
              s.automation_config?.honor_ai?.account_id &&
            !!s.automation_config?.honor_verified_account,
        ),
        note: "Автоответ HONOR требует проверки нового входящего и ручного перехвата на подключённом аккаунте.",
      },
    });
  } catch {
    return json(
      {
        error:
          "Не удалось проверить данные HONOR. Проверьте миграцию и подключение базы.",
      },
      503,
    );
  }
}
const action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("stop") }).strict(),
  z
    .object({ action: z.literal("verify"), message_id: z.string().uuid() })
    .strict(),
  z
    .object({
      action: z.literal("configure"),
      channel: z.enum(["whatsapp", "instagram"]),
      config: honorConfigSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("sandbox"),
      channel: z.enum(["whatsapp", "instagram"]),
      text: z.string().trim().min(1).max(1200),
    })
    .strict(),
]);
export async function POST(req: NextRequest) {
  const actor = await getGigaActor(req);
  if (!actor) return json({ error: "Forbidden" }, 403);
  if (req.headers.get("origin") !== new URL(req.url).origin)
    return json({ error: "Invalid origin" }, 403);
  const p = action.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: "Некорректные параметры" }, 400);
  if (
    p.data.action !== "stop" &&
    (await isRateLimitedKey(actor.id, "honor-control", { max: 10 }))
  )
    return json({ error: "Повторите через минуту" }, 429);
  try {
    const sb = createServiceClient();
    const a = p.data;
    if (a.action === "sandbox") {
      const s = await sb
        .from("omnichannel_settings")
        .select("automation_config")
        .eq("channel", a.channel)
        .single();
      const config = honorConfig(s.data?.automation_config?.honor_ai);
      if (!config)
        return json({ error: "Сначала сохраните привязку HONOR" }, 409);
      const selection = await selectHonorProducts(a.text, config);
      return json({
        sandbox: true,
        sent: false,
        answer: (
          await buildHonorReply(a.text, config, a.channel, [], selection)
        ).answer,
        selection,
      });
    }
    if (a.action === "verify") {
      if (actor.kind !== "session")
        return json(
          {
            error: "Проверку подтверждает менеджер под личной учётной записью",
          },
          403,
        );
      const r = await sb.rpc("honor_verify_live_canary", {
        p_message_id: a.message_id,
        p_actor_id: actor.id,
      });
      if (r.error)
        return json(
          {
            error:
              "Нужен свежий тестовый входящий с проверенным подбором и последующим ответом этого менеджера",
          },
          409,
        );
      return json({ ok: true, verified: true });
    }
    const result = await sb.rpc("honor_ai_control", {
      p_action: a.action,
      p_channel: a.action === "configure" ? a.channel : "whatsapp",
      p_config: a.action === "configure" ? a.config : null,
    });
    if (result.error)
      return json(
        {
          error:
            "Изменение не сохранено: проверьте привязку каталога и миграцию",
        },
        409,
      );
    await logAudit({
      entityType: "system",
      entityId: "honor-ai",
      action: "honor." + a.action,
      performedBy: actor.id,
      diff: { after: { action: a.action }, actorKind: actor.kind },
    });
    return json({ ok: true, stopped: a.action === "stop" });
  } catch {
    return json({ error: "Не удалось выполнить действие" }, 503);
  }
}
