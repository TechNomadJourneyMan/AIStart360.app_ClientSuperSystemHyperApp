import { beforeEach, describe, it, expect, vi } from "vitest";
const database = vi.hoisted(() => ({
  rows: [] as unknown[],
  error: null as unknown,
}));
vi.mock("@/lib/supabase-service", () => ({
  createServiceClient: () => ({
    from: () => {
      const q: any = {
        select: () => q,
        eq: () => q,
        limit: async () => ({ data: database.rows, error: database.error }),
      };
      return q;
    },
  }),
}));
vi.mock("@/lib/omnichannel/ai", () => ({
  generateOmnichannelReply: vi.fn(async () => null),
}));
import {
  budgetFromText,
  selectionScore,
  selectHonorProducts,
  buildHonorReply,
} from "@/lib/omnichannel/honor-catalog";
import { HONOR_SCENARIOS } from "@/lib/omnichannel/honor-policy";
const config = {
  enabled: true,
  account_id: "waweb:test",
  user_id: "11111111-1111-4111-8111-111111111111",
  company_id: "22222222-2222-4222-8222-222222222222",
  scenarios: HONOR_SCENARIOS,
};
const html = (stock = "InStock", price = 25000) =>
  `<script type="application/ld+json">${JSON.stringify({ "@type": "Product", url: "https://myhonor.shop/product/softshell", name: "Костюм Софтшелл", image: ["https://myhonor.shop/photo.jpg"], offers: { "@type": "Offer", price, priceCurrency: "KZT", availability: "https://schema.org/" + stock } })}</script>`;
beforeEach(() => {
  database.rows = [
    {
      name: "Костюм Софтшелл",
      description: "Демисезонный",
      url: "https://myhonor.shop/product/softshell",
    },
  ];
  database.error = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(html())),
  );
});
describe("Honor catalog verification", () => {
  it("ranks transitional clothing above winter insulation for 15 degrees", () =>
    expect(
      selectionScore("на 15 градусов", { name: "Костюм софтшелл" }),
    ).toBeGreaterThan(
      selectionScore("на 15 градусов", { name: "Зимний пуховый костюм" }),
    ));
  it("recognizes budget without interpreting temperature as money", () => {
    expect(budgetFromText("на 15 градусов")).toBeNull();
    expect(budgetFromText("бюджет до 40 тыс")).toBe(40000);
  });
  it("gets current price and image only from the live product page", async () => {
    const r = await selectHonorProducts("на 15 градусов", config);
    expect(r.cards[0]).toMatchObject({
      price: 25000,
      image: "https://myhonor.shop/photo.jpg",
    });
    expect(r.complete).toBe(false);
  });
  it("rejects out of stock products and stale catalog fallback", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(html("OutOfStock"))),
    );
    expect((await selectHonorProducts("на 15 градусов", config)).cards).toEqual(
      [],
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw Error("timeout");
      }),
    );
    expect((await selectHonorProducts("на 15 градусов", config)).cards).toEqual(
      [],
    );
  });
  it("never fetches a customer/poisoned external catalog URL", async () => {
    database.rows = [
      { name: "Костюм софтшелл", url: "https://evil.example/product/suit" },
    ];
    expect((await selectHonorProducts("на 15 градусов", config)).cards).toEqual(
      [],
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it("respects budget using verified current prices", async () =>
    expect(
      (await selectHonorProducts("на 15 градусов до 20000", config)).cards,
    ).toEqual([]));
  it("does not query or recommend products for opt-out", async () => {
    const r = await buildHonorReply("СТОП", config);
    expect(r.needs_human).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
});
