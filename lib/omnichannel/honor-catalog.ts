import { createServiceClient } from "@/lib/supabase-service";
import {
  parseMyHonorProductJsonLd,
  validateMyHonorProductUrl,
} from "@/lib/integrations/ecommerce/myhonor-public";
import {
  generateOmnichannelReply,
  type OmnichannelAiReply,
  type OmnichannelHistoryMessage,
} from "./ai";
import { detectDeterministicRisk } from "./guardrails";
import type { HonorConfig } from "./honor-policy";

export interface HonorCard {
  id: string;
  name: string;
  price: number;
  url: string;
  image: string | null;
  description: string;
  checkedAt: string;
}
export interface HonorSelection {
  cards: HonorCard[];
  complete: boolean;
  reason: string;
}
const MAX_BYTES = 1536 * 1024;

export function selectionScore(
  text: string,
  product: { name: string; description?: string | null },
): number {
  const haystack = `${product.name} ${product.description ?? ""}`.toLowerCase();
  let score = 0;
  for (const word of text
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter((w) => w.length > 3)) {
    if (haystack.includes(word.slice(0, 5))) score += 2;
  }
  const degrees = /(?:\+?\s*(\d{1,2})\s*(?:градус|°)|на\s+\+?(\d{1,2}))/iu.exec(
    text,
  );
  if (
    degrees &&
    Number(degrees[1] ?? degrees[2]) >= 10 &&
    Number(degrees[1] ?? degrees[2]) <= 20
  ) {
    if (/демисезон|softshell|софтшелл|флис|ветровк/iu.test(haystack))
      score += 6;
    if (/зимн|утепл[её]н|пухов/iu.test(haystack)) score -= 20;
  }
  if (/комплект|костюм/iu.test(product.name)) score += 2;
  return score;
}

export function budgetFromText(text: string): number | null {
  const m =
    /(?:бюджет\D{0,12}|до\s+)(\d+(?:[.,]\d+)?)\s*(тыс(?:яч)?|[кk]\b)?/iu.exec(
      text,
    );
  if (!m) return null;
  const n = Number(m[1].replace(",", ".")) * (m[2] ? 1000 : 1);
  return n >= 100 && n <= 10_000_000 ? n : null;
}

export async function verifyHonorProduct(
  url: string,
): Promise<HonorCard | null> {
  try {
    const safeUrl = validateMyHonorProductUrl(url);
    const response = await fetch(safeUrl, {
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok || !response.body) return null;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const html = Buffer.concat(chunks).toString("utf8");
    const { product } = parseMyHonorProductJsonLd(
      html,
      safeUrl,
      new Date().toISOString(),
    );
    const offer = product?.offers[0];
    if (
      !product ||
      !offer ||
      !/\/InStock$/i.test(offer.availability ?? "") ||
      offer.price <= 0
    )
      return null;
    return {
      id: product.externalId,
      name: product.name,
      price: offer.price,
      url: product.url,
      image: product.images[0] ?? null,
      description: product.description ?? "",
      checkedAt: product.syncedAt,
    };
  } catch {
    return null;
  }
}

export async function selectHonorProducts(
  text: string,
  config: HonorConfig,
): Promise<HonorSelection> {
  const sb = createServiceClient();
  const result = await sb
    .from("ecommerce_products")
    .select("name,description,url")
    .eq("source", "myhonor.shop")
    .eq("user_id", config.user_id)
    .eq("company_id", config.company_id)
    .eq("catalog_active", true)
    .limit(501);
  if (result.error || !result.data || result.data.length > 500)
    return { cards: [], complete: false, reason: "catalog_unavailable" };
  const candidates = result.data
    .map((p) => ({ ...p, score: selectionScore(text, p) }))
    .filter((p) => p.score > 0 && p.url)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
  const verified: (HonorCard | null)[] = [];
  for (let i = 0; i < candidates.length; i += 3)
    verified.push(
      ...(await Promise.all(
        candidates.slice(i, i + 3).map((p) => verifyHonorProduct(p.url!)),
      )),
    );
  const budget = budgetFromText(text);
  const eligible = verified.filter(
    (p): p is HonorCard => !!p && (!budget || p.price <= budget),
  );
  const suits = eligible.filter((p) => /костюм|комплект/iu.test(p.name));
  const cards = (suits.length >= 2 ? suits : eligible).slice(0, 3);
  return {
    cards,
    complete: cards.length >= 2,
    reason: cards.length
      ? "live_public_catalog_size_unverified"
      : "no_verified_matches",
  };
}

export function renderHonorSelection(selection: HonorSelection): string {
  if (!selection.cards.length)
    return "Сейчас не могу подтвердить подходящие товары и остатки. Передам подбор менеджеру. Подскажите размер и для какой активности выбираете?";
  const items = selection.cards.map(
    (p, i) =>
      `${i + 1}. ${p.name} — ${p.price.toLocaleString("ru-RU")} ₸\n${p.url}`,
  );
  return `Варианты из текущего каталога HONOR:\n\n${items.join("\n\n")}\n\nНаличие модели проверено на сайте. Размер и комфорт по погоде уточним перед заказом. Какой у вас размер и для какой активности выбираете?`;
}

export async function buildHonorReply(
  text: string,
  config: HonorConfig,
  channel: "whatsapp" | "instagram" = "whatsapp",
  history: OmnichannelHistoryMessage[] = [],
  verifiedSelection?: HonorSelection,
): Promise<OmnichannelAiReply> {
  const risk = detectDeterministicRisk(text);
  const selection =
    risk.risk === "low"
      ? (verifiedSelection ?? (await selectHonorProducts(text, config)))
      : { cards: [], complete: false, reason: "human_review_required" };
  const scenarioKey = /достав|привез/iu.test(text)
    ? "delivery"
    : /скид|акци/iu.test(text)
      ? "promotion"
      : /магазин|пример/iu.test(text)
        ? "visit"
        : /нет.*размер/iu.test(text)
          ? "missing_size"
          : /допол|ещ[её]/iu.test(text)
            ? "upsell"
            : history.length
              ? "returning"
              : "new_dialog";
  const facts = selection.cards
    .map(
      (p) =>
        `${p.name} — ${p.price} KZT. ${p.description.slice(0, 500)} Карточка: ${p.url}. Модель отмечена InStock на сайте; размер неизвестен.`,
    )
    .join("\n");
  if (facts && risk.risk === "low") {
    const proposal = await generateOmnichannelReply({
      channel,
      currentMessage: text,
      history,
      businessContext:
        facts +
        "\nРазмерный остаток, акции, условия доставки, адрес и график магазина не подтверждены. Температурный комфорт не гарантирован.",
      scenarioGuidance: config.scenarios[scenarioKey],
    });
    if (
      proposal &&
      proposal.risk === "low" &&
      !proposal.needs_human &&
      (proposal.answer.match(/\?/g) ?? []).length <= 2 &&
      selection.cards.filter((p) => proposal.answer.includes(p.url)).length >=
        Math.min(2, selection.cards.length)
    )
      return proposal;
  }
  return {
    answer: renderHonorSelection(selection),
    intent: "pricing",
    sentiment: "neutral",
    language: "ru",
    confidence: selection.complete ? 0.95 : 0.5,
    risk: selection.complete ? "low" : "medium",
    needs_human: !selection.cards.length,
    reason: selection.reason,
    lead_score: 50,
    conversation_summary:
      "Подбор по проверенному публичному каталогу; остаток размера требует подтверждения.",
    grounding: "business_context",
    business_facts_used: selection.cards.map(
      (p) => `${p.name}: ${p.price} KZT`,
    ),
  };
}
