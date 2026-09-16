import { messageActor } from "./honor-policy";
export interface MetricMessage {
  id: string;
  conversation_id: string;
  channel: string;
  direction: string;
  status: string;
  occurred_at: string;
  ai_generated: boolean;
  metadata: Record<string, unknown> | null;
}
export interface MetricConversation {
  id: string;
  channel: string;
  account_external_id: string;
  status: string;
  auto_reply_override: boolean | null;
}
export interface CommerceEvidence {
  message_id: string;
  event_type: string;
  confirmed_revenue: number | null;
  source_event_id: string;
}
export function honorMetrics(
  messages: MetricMessage[],
  conversations: MetricConversation[],
  events: CommerceEvidence[],
  input: {
    from: string;
    to: string;
    manager?: string;
    now?: number;
    partial?: boolean;
  },
) {
  const from = Date.parse(input.from),
    to = Date.parse(input.to),
    now = input.now ?? Date.now();
  const buckets = new Map<
    string,
    {
      actor: string;
      managerId: string | null;
      messages: number;
      conversations: Set<string>;
      responses: number[];
      firstResponses: number[];
      clicks: number;
      carts: number;
      orders: number;
      orderConversations: Set<string>;
      confirmedRevenue: number;
    }
  >();
  const bucket = (actor: string, id: string | null) => {
    const key = actor + ":" + (id ?? "unattributed");
    let b = buckets.get(key);
    if (!b) {
      b = {
        actor,
        managerId: id,
        messages: 0,
        conversations: new Set(),
        responses: [],
        firstResponses: [],
        clicks: 0,
        carts: 0,
        orders: 0,
        orderConversations: new Set(),
        confirmedRevenue: 0,
      };
      buckets.set(key, b);
    }
    return b;
  };
  const touched = new Set(
    messages
      .filter(
        (m) =>
          Date.parse(m.occurred_at) >= from &&
          Date.parse(m.occurred_at) < to &&
          (!input.manager || messageActor(m).id === input.manager),
      )
      .map((m) => m.conversation_id),
  );
  conversations = conversations.filter((c) => touched.has(c.id));
  const active = new Set(conversations.map((c) => c.id));
  const sorted = messages
    .filter((m) => active.has(m.conversation_id))
    .sort(
      (a, b) =>
        Date.parse(a.occurred_at) - Date.parse(b.occurred_at) ||
        a.id.localeCompare(b.id),
    );
  const pending = new Map<string, number>();
  const seenResponse = new Set<string>();
  const messageBuckets = new Map<string, ReturnType<typeof bucket>>();
  let unknown = 0;
  let inbound = 0;
  for (const m of sorted) {
    const at = Date.parse(m.occurred_at);
    if (!Number.isFinite(at) || at >= to) continue;
    if (m.direction === "in") {
      if (!pending.has(m.conversation_id)) pending.set(m.conversation_id, at);
      if (at >= from) inbound++;
      continue;
    }
    if (!["sent", "delivered", "read"].includes(m.status)) continue;
    const a = messageActor(m);
    if (at >= from) {
      const b = bucket(a.type, a.id);
      b.messages++;
      b.conversations.add(m.conversation_id);
      messageBuckets.set(m.id, b);
      if (a.type === "unknown" || (a.type === "manager" && !a.id)) unknown++;
    }
    if (!["ai", "manager", "unknown"].includes(a.type)) continue;
    const start = pending.get(m.conversation_id);
    if (start !== undefined && at >= start) {
      if (at >= from) {
        const b = bucket(a.type, a.id);
        b.responses.push((at - start) / 1000);
        if (!seenResponse.has(m.conversation_id))
          b.firstResponses.push((at - start) / 1000);
      }
      pending.delete(m.conversation_id);
      seenResponse.add(m.conversation_id);
    }
  }
  const eventIds = new Set<string>();
  for (const e of events) {
    if (eventIds.has(e.source_event_id)) continue;
    eventIds.add(e.source_event_id);
    const b = messageBuckets.get(e.message_id);
    if (!b) continue;
    if (e.event_type === "click") b.clicks++;
    if (e.event_type === "cart") b.carts++;
    if (e.event_type === "order") {
      b.orders++;
      const m = messages.find((m) => m.id === e.message_id);
      if (m) b.orderConversations.add(m.conversation_id);
    }
    if (e.event_type === "paid" && e.confirmed_revenue !== null)
      b.confirmedRevenue += Number(e.confirmed_revenue);
  }
  const avg = (xs: number[]) =>
    xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
  return {
    inbound,
    conversations: conversations.length,
    missed: [...pending].filter(
      ([, at]) => at >= from && at < to && at < Math.min(now, to) - 15 * 60_000,
    ).length,
    handoffs: conversations.filter(
      (c) => c.status === "needs_human" || c.auto_reply_override === false,
    ).length,
    rows: [...buckets.values()]
      .filter((b) => !input.manager || b.managerId === input.manager)
      .map((b) => ({
        ...b,
        conversations: b.conversations.size,
        averageResponseSeconds: avg(b.responses),
        firstResponseSeconds: avg(b.firstResponses),
        responseCount: b.responses.length,
        responses: undefined,
        firstResponses: undefined,
        orderConversations: undefined,
        clicks: events.some((e) => e.event_type === "click") ? b.clicks : null,
        carts: events.some((e) => e.event_type === "cart") ? b.carts : null,
        orders: events.some((e) => e.event_type === "order") ? b.orders : null,
        conversion:
          events.some((e) => e.event_type === "order") && b.conversations.size
            ? b.orderConversations.size / b.conversations.size
            : null,
        confirmedRevenue: events.some((e) => e.event_type === "paid" && e.confirmed_revenue !== null)
          ? b.confirmedRevenue
          : null,
      })),
    coverage: {
      partial: input.partial === true || unknown > 0 || events.some((e) => e.event_type === "paid" && e.confirmed_revenue === null),
      unattributedOutbound: unknown,
      commerceConnected: events.length > 0,
      notes: [
        "История WhatsApp неполная; время первого ответа — первый наблюдаемый ответ в выборке.",
        "Передачи — текущее состояние диалогов, не количество исторических переводов.",
        "Пропуск — входящая серия без наблюдаемого ответа дольше 15 минут.",
        "Клики, корзины и выручка доступны только при подтверждённых связанных событиях.",
      ],
    },
  };
}
