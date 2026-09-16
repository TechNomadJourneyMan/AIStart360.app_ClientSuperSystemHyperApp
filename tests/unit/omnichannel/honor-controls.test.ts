import { describe, it, expect } from "vitest";
import {
  effectiveReplyMode,
  messageActor,
  honorConfig,
  HONOR_SCENARIOS,
} from "@/lib/omnichannel/honor-policy";
import { honorMetrics } from "@/lib/omnichannel/honor-metrics";
const from = "2026-09-16T10:00:00Z",
  to = "2026-09-16T12:00:00Z";
const conversation = {
  id: "c",
  channel: "whatsapp",
  account_external_id: "waweb:test",
  status: "open",
  auto_reply_override: null,
};
const row = (id: string, direction: string, time: string, overrides = {}) => ({
  id,
  conversation_id: "c",
  channel: "whatsapp",
  direction,
  status: direction === "in" ? "received" : "sent",
  occurred_at: `2026-09-16T${time}Z`,
  ai_generated: false,
  metadata: {},
  ...overrides,
});
describe("Honor mode authority", () => {
  for (const mode of ["off", "assistant", "draft"] as const)
    it(`cannot promote ${mode} with a conversation override`, () =>
      expect(
        effectiveReplyMode({
          configured: mode,
          override: true,
          forceDraft: false,
        }),
      ).toBe(mode));
  it("historical auto becomes a draft", () =>
    expect(
      effectiveReplyMode({
        configured: "auto",
        override: null,
        forceDraft: true,
      }),
    ).toBe("draft"));
  it("off and manual takeover also block history processing", () => {
    expect(
      effectiveReplyMode({
        configured: "off",
        override: true,
        forceDraft: true,
      }),
    ).toBe("off");
    expect(
      effectiveReplyMode({
        configured: "auto",
        override: false,
        forceDraft: true,
      }),
    ).toBe("off");
  });
  it("requires exact tenant binding and all scenarios", () => {
    expect(honorConfig({ enabled: true })).toBeNull();
    expect(
      honorConfig({
        enabled: true,
        account_id: "waweb:test",
        user_id: "11111111-1111-4111-8111-111111111111",
        company_id: "22222222-2222-4222-8222-222222222222",
        scenarios: HONOR_SCENARIOS,
      }),
    ).not.toBeNull();
  });
});
describe("honest attribution and response metrics", () => {
  it("does not label legacy unknown outbound as a manager", () =>
    expect(messageActor({ direction: "out", ai_generated: false })).toEqual({
      type: "unknown",
      id: null,
    }));
  it("AI attribution wins over a transport echo", () =>
    expect(
      messageActor({
        direction: "out",
        ai_generated: true,
        metadata: { isEcho: true },
      }).type,
    ).toBe("ai"));
  it("counts unanswered bursts, not every inbound as a missed response", () => {
    const result = honorMetrics(
      [
        row("1", "in", "10:00:00"),
        row("2", "in", "10:00:15"),
        row("3", "out", "10:01:00", {
          metadata: { source: "giga_admin_manual", actorId: "m1" },
        }),
        row("4", "in", "10:30:00"),
      ],
      [conversation],
      [],
      { from, to, now: Date.parse(to) },
    );
    expect(result.rows[0]).toMatchObject({
      actor: "manager",
      managerId: "m1",
      messages: 1,
      averageResponseSeconds: 60,
      firstResponseSeconds: 60,
      clicks: null,
      confirmedRevenue: null,
    });
    expect(result.missed).toBe(1);
  });
  it("does not report missing payment proof as zero confirmed revenue", () => {
    const result = honorMetrics([row("a", "in", "10:00:00"), row("b", "out", "10:01:00", {ai_generated:true})], [conversation], [{source_event_id:"unknown-paid",message_id:"b",event_type:"paid",confirmed_revenue:null}], {from,to});
    expect(result.rows[0].confirmedRevenue).toBeNull();
    expect(result.coverage.partial).toBe(true);
  });

  it("ignores failed sends and unrelated conversations, deduplicates signed events", () => {
    const messages = [
      row("1", "in", "10:00:00"),
      row("2", "out", "10:00:30", { status: "failed" }),
      row("3", "out", "10:01:00", { ai_generated: true }),
      row("x", "out", "10:01:00", {
        conversation_id: "other",
        ai_generated: true,
      }),
    ];
    const e = {
      source_event_id: "ev",
      message_id: "3",
      event_type: "paid",
      confirmed_revenue: 12300,
    };
    const result = honorMetrics(messages, [conversation], [e, e], { from, to });
    expect(result.rows[0]).toMatchObject({
      messages: 1,
      averageResponseSeconds: 60,
      confirmedRevenue: 12300,
    });
  });
});
