import { z } from "zod";
import { chatWithOpenRouter, extractJson, hasOpenRouterKey, OPENROUTER_MODELS } from "@/lib/ai/openrouter";
import { parseDocument } from "@/lib/documents/parse";

type ParsedFieldValue = string | number | boolean | string[] | number[];

export interface ParsedDataField {
  key: string;
  label: string;
  value: ParsedFieldValue;
  target_tab: string;
  target_parameter: string;
  source?: string;
  confidence?: number;
}

export interface DocumentExtraction {
  summary: string;
  fields: ParsedDataField[];
}

export interface ParsedDataPayload {
  summary: string;
  fields: ParsedDataField[];
  raw_text_preview: string;
  extracted_at: string;
  model_used: string;
}

interface ExtractFromDocumentInput {
  buffer: Buffer;
  fileName: string;
  mimeType: string | null;
  docType: string;
}

const fieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  value: z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.string()),
    z.array(z.number()),
  ]),
  target_tab: z.string().min(1),
  target_parameter: z.string().min(1),
  source: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

const extractionSchema = z.object({
  summary: z.string().min(1),
  fields: z.array(fieldSchema).max(60),
});

const TARGET_HINTS: Array<{ pattern: RegExp; tab: string; parameter: string }> = [
  { pattern: /revenue|выруч|доход/i, tab: "Финансы", parameter: "Выручка" },
  { pattern: /net_profit|profit|прибыл/i, tab: "Финансы", parameter: "Чистая прибыль" },
  { pattern: /margin|марж/i, tab: "Финансы", parameter: "Маржинальность" },
  { pattern: /expense|cost|расход|себесто/i, tab: "Финансы", parameter: "Расходы" },
  { pattern: /breakeven|безуб/i, tab: "Финансы", parameter: "Точка безубыточности" },
  { pattern: /cac/i, tab: "Работа с базой", parameter: "CAC" },
  { pattern: /ltv/i, tab: "Работа с базой", parameter: "LTV" },
  { pattern: /avg_check|средн.*чек/i, tab: "Ключевые метрики", parameter: "Средний чек" },
  { pattern: /client|клиент/i, tab: "Работа с базой", parameter: "Клиенты" },
  { pattern: /deal|lead|сдел|лид/i, tab: "Работа с базой", parameter: "Воронка продаж" },
  { pattern: /marketing|реклам|канал/i, tab: "Маркетинг", parameter: "Маркетинговые показатели" },
  { pattern: /staff|employee|штат|сотруд/i, tab: "Орг. структура", parameter: "Команда / штат" },
];

const HEURISTIC_PATTERNS: Array<{
  key: string;
  label: string;
  pattern: RegExp;
  targetTab: string;
  targetParameter: string;
}> = [
  {
    key: "revenue",
    label: "Выручка",
    pattern: /(?:выручк[аи]?|revenue|доход)[^\d]{0,80}([\d\s.,]+)\s*(млн|тыс|₸|тг|тенге|kzt)?/i,
    targetTab: "Финансы",
    targetParameter: "Выручка",
  },
  {
    key: "net_profit",
    label: "Чистая прибыль",
    pattern: /(?:чистая прибыль|net profit|прибыль)[^\d-]{0,80}(-?[\d\s.,]+)\s*(млн|тыс|₸|тг|тенге|kzt)?/i,
    targetTab: "Финансы",
    targetParameter: "Чистая прибыль",
  },
  {
    key: "gross_margin",
    label: "Маржинальность",
    pattern: /(?:маржинальность|маржа|gross margin|margin)[^\d]{0,80}([\d\s.,]+)\s*%?/i,
    targetTab: "Финансы",
    targetParameter: "Маржинальность",
  },
  {
    key: "cac",
    label: "CAC",
    pattern: /(?:cac|стоимость привлечения клиента)[^\d]{0,80}([\d\s.,]+)\s*(₸|тг|тенге|kzt)?/i,
    targetTab: "Работа с базой",
    targetParameter: "CAC",
  },
  {
    key: "ltv",
    label: "LTV",
    pattern: /(?:ltv|lifetime value|ценность клиента)[^\d]{0,80}([\d\s.,]+)\s*(₸|тг|тенге|kzt)?/i,
    targetTab: "Работа с базой",
    targetParameter: "LTV",
  },
  {
    key: "avg_check",
    label: "Средний чек",
    pattern: /(?:средний чек|avg\.?\s*check|average check)[^\d]{0,80}([\d\s.,]+)\s*(₸|тг|тенге|kzt)?/i,
    targetTab: "Ключевые метрики",
    targetParameter: "Средний чек",
  },
];

function compactText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function normalizeNumber(raw: string, unit?: string): string | number {
  const normalized = raw.replace(/\s/g, "").replace(",", ".");
  const number = Number(normalized);
  if (!Number.isFinite(number)) return raw.trim();
  if (!unit) return number;

  const lowerUnit = unit.toLowerCase();
  if (lowerUnit === "млн") return number * 1_000_000;
  if (lowerUnit === "тыс") return number * 1_000;
  return number;
}

function inferTarget(key: string, fallbackTab: string, fallbackParameter: string) {
  const hint = TARGET_HINTS.find(item => item.pattern.test(key));
  return {
    target_tab: hint?.tab ?? fallbackTab,
    target_parameter: hint?.parameter ?? fallbackParameter,
  };
}

function heuristicExtract(text: string): DocumentExtraction {
  const fields: ParsedDataField[] = [];

  for (const item of HEURISTIC_PATTERNS) {
    const match = text.match(item.pattern);
    if (!match) continue;

    const source = compactText(match[0]);
    fields.push({
      key: item.key,
      label: item.label,
      value: normalizeNumber(match[1], match[2]),
      target_tab: item.targetTab,
      target_parameter: item.targetParameter,
      source,
      confidence: 0.55,
    });
  }

  return {
    summary: fields.length > 0
      ? `Автоматически найдено ${fields.length} бизнес-показателей. Проверьте значения перед использованием в диагностике.`
      : "Документ распознан, но структурированные бизнес-показатели не найдены автоматически.",
    fields,
  };
}

function normalizeExtraction(extraction: DocumentExtraction): DocumentExtraction {
  return {
    summary: extraction.summary,
    fields: extraction.fields.map((field, index) => {
      const target = inferTarget(field.key, field.target_tab, field.target_parameter);
      return {
        key: field.key || `field_${index + 1}`,
        label: field.label || field.key || `Поле ${index + 1}`,
        value: field.value,
        target_tab: target.target_tab,
        target_parameter: target.target_parameter,
        source: field.source,
        confidence: field.confidence,
      };
    }),
  };
}

async function extractWithAi(text: string, docType: string): Promise<DocumentExtraction | null> {
  if (!hasOpenRouterKey()) return null;

  const systemPrompt = `You extract structured business metrics from client documents for AIStart360 diagnostics.
Return only facts present in the document. Do not invent values.
Each field must state where it should be used in the client questionnaire/diagnostic tabs.
Use Russian labels for target_tab and target_parameter.
Typical tabs: Финансы, Работа с базой, Маркетинг, Орг. структура, Цели, Ключевые метрики, Диагностика.
Respond with a valid JSON object matching this schema exactly:
{"summary":"<string>","fields":[{"key":"<snake_case>","label":"<string>","value":"<string|number>","target_tab":"<string>","target_parameter":"<string>","source":"<string>","confidence":<0-1>}]}`;

  const userPrompt = `Document type selected by user: ${docType}

Extract important business data from this document:
- financial metrics: revenue, profit, margins, expenses, debt, breakeven
- sales/client metrics: leads, deals, conversions, CAC, LTV, average check, repeat clients
- marketing metrics: channels, budget, campaign performance
- operations/team metrics: staff, departments, processes, reporting

For each field include:
- key: stable snake_case key
- label: human-readable source field name
- value: extracted value
- target_tab: where this data should be shown/used
- target_parameter: exact parameter name inside that tab
- source: short quote or nearby text from the document
- confidence: 0..1

Document text:
${text.slice(0, 30000)}`;

  try {
    const raw = await chatWithOpenRouter({
      model: OPENROUTER_MODELS.sonnet,
      system: systemPrompt,
      user: userPrompt,
      maxTokens: 4000,
      temperature: 0.2,
      jsonMode: true,
    });

    if (!raw) return null;

    const parsed = extractJson<unknown>(raw);
    if (!parsed) return null;

    const result = extractionSchema.safeParse(parsed);
    if (!result.success) {
      console.warn("[documents/extract] schema validation failed", result.error.issues.slice(0, 3));
      return null;
    }

    return normalizeExtraction(result.data);
  } catch (error) {
    console.warn("[documents/extract] AI extraction failed, using heuristic fallback", error);
    return null;
  }
}

export async function extractFromDocument(input: ExtractFromDocumentInput): Promise<{
  extraction: DocumentExtraction;
  rawTextPreview: string;
  modelUsed: string;
}> {
  const parsed = await parseDocument(input.buffer, input.fileName, input.mimeType ?? undefined);
  const text = parsed.text.trim();
  const rawTextPreview = text.slice(0, 2500);

  if (!text) {
    return {
      extraction: {
        summary: "Файл распознан, но текст для анализа не найден.",
        fields: [],
      },
      rawTextPreview,
      modelUsed: "document-parser",
    };
  }

  const aiExtraction = await extractWithAi(text, input.docType);
  if (aiExtraction) {
    return {
      extraction: aiExtraction,
      rawTextPreview,
      modelUsed: OPENROUTER_MODELS.sonnet,
    };
  }

  return {
    extraction: heuristicExtract(text),
    rawTextPreview,
    modelUsed: "heuristic-parser",
  };
}
