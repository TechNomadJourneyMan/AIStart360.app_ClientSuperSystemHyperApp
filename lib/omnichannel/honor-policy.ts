import { z } from "zod";
import type { OmnichannelMode } from "./types";

export const HONOR_SCENARIOS = {
  new_dialog:
    "Предложи 2–3 проверенных варианта сразу. Задай не более двух необходимых вопросов: размер и активность либо бюджет. Заверши одним следующим шагом.",
  returning:
    "Учитывай историю покупателя, но не выдавай старые цены и остатки за текущие. Старые диалоги обрабатывай только как черновики.",
  promotion:
    "Упоминай акцию только при наличии проверенных условий и срока. Если подтверждения нет, не обещай скидку.",
  upsell:
    "Предложи один совместимый дополнительный товар из текущего каталога. Не превышай названный бюджет комплекта.",
  missing_size:
    "Не обещай отсутствующий размер. Предложи проверенную альтернативу или передай проверку менеджеру.",
  delivery:
    "Используй только подтверждённые условия доставки. Если адрес или стоимость неизвестны, уточни город одним вопросом.",
  visit:
    "Приглашай в магазин только с подтверждёнными адресом и графиком. Предложи один следующий шаг: согласовать примерку.",
} as const;

const scenario = z.string().trim().min(10).max(1200);
export const honorConfigSchema = z
  .object({
    enabled: z.boolean(),
    account_id: z.string().trim().min(1).max(120),
    company_id: z.string().uuid(),
    user_id: z.string().uuid(),
    scenarios: z.object({
      new_dialog: scenario,
      returning: scenario,
      promotion: scenario,
      upsell: scenario,
      missing_size: scenario,
      delivery: scenario,
      visit: scenario,
    }),
  })
  .strict();
export type HonorConfig = z.infer<typeof honorConfigSchema>;
export function honorConfig(value: unknown): HonorConfig | null {
  const parsed = honorConfigSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Conversation overrides may restrict a channel, never promote its mode. */
export function effectiveReplyMode(input: {
  configured: OmnichannelMode;
  override: boolean | null;
  forceDraft: boolean;
}): OmnichannelMode {
  if (input.configured === "off") return "off";
  if (input.override === false) return "off";
  if (input.forceDraft)
    return input.configured === "assistant" ? "assistant" : "draft";
  return input.configured;
}

export function messageActor(row: {
  direction: string;
  ai_generated?: boolean;
  metadata?: Record<string, unknown> | null;
}) {
  if (row.direction === "in") return { type: "customer", id: null };
  if (row.ai_generated) return { type: "ai", id: null };
  const meta = row.metadata ?? {};
  if (meta.source === "giga_admin_manual")
    return {
      type: "manager",
      id:
        typeof meta.actorId === "string" &&
        meta.actorKind !== "break_glass" &&
        !meta.actorId.startsWith("giga:")
          ? meta.actorId
          : null,
    };
  if (meta.isEcho === true || meta.humanOutbound === true)
    return { type: "manager", id: null };
  if (meta.source === "system") return { type: "system", id: null };
  return { type: "unknown", id: null };
}
