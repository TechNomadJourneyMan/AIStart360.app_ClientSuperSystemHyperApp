import { z } from 'zod'
import { generateObject } from 'ai'
import { anthropic, CLAUDE_MODELS } from '@/lib/ai/anthropic'
import { parseDocument, type ParsedDocument } from '@/lib/documents/parse'

export type DiagnosticTab =
  | 'finance'
  | 'sales'
  | 'operations'
  | 'marketing'
  | 'strategy'
  | 'anketa'

export const TAB_LABELS: Record<DiagnosticTab, string> = {
  finance: 'Финансы',
  sales: 'Продажи',
  operations: 'Операции',
  marketing: 'Маркетинг',
  strategy: 'Стратегия',
  anketa: 'Анкета',
}

export const DOC_TYPE_PRIMARY_TAB: Record<string, DiagnosticTab> = {
  pl_report: 'finance',
  balance_sheet: 'finance',
  marketing_report: 'marketing',
  ops_report: 'operations',
  crm_export: 'sales',
  audit: 'strategy',
  other: 'anketa',
}

const extractedFieldSchema = z.object({
  key: z
    .string()
    .describe('snake_case machine-readable key, e.g. revenue_2024, avg_check, ltv'),
  label: z
    .string()
    .describe('Краткое название параметра на русском, например "Выручка 2024"'),
  value: z
    .string()
    .describe('Значение как строка — число с единицами, текст или диапазон'),
  tab: z
    .enum(['finance', 'sales', 'operations', 'marketing', 'strategy', 'anketa'])
    .describe('Вкладка диагностики, в которую идёт этот параметр'),
  parameter: z
    .string()
    .describe('Название параметра на вкладке (например "Годовая выручка", "Средний чек")'),
  confidence: z.number().min(0).max(1).describe('Уверенность извлечения 0-1'),
  source_excerpt: z
    .string()
    .max(300)
    .describe('Короткая дословная цитата из документа (до 300 символов)'),
})

const extractionSchema = z.object({
  summary: z.string().describe('Один абзац-резюме документа на русском (до 600 символов)'),
  fields: z.array(extractedFieldSchema).max(40),
})

export type ExtractedField = z.infer<typeof extractedFieldSchema>
export type ExtractionResult = z.infer<typeof extractionSchema>

export interface ParsedDataPayload {
  summary: string
  fields: ExtractedField[]
  raw_text_preview: string
  extracted_at: string
  model_used?: string
}

const TAB_GUIDE = `
Вкладки и какие параметры на них:
- finance (Финансы): выручка, прибыль/убыток, маржа, расходы, P&L строки, баланс, активы, пассивы, OPEX, CAPEX, ARR/MRR, оборотный капитал, кредиты, дебиторка, кредиторка
- sales (Продажи): конверсия воронки, средний чек, LTV, churn, количество сделок/клиентов, CAC, лиды, NPS, выручка по сегментам
- operations (Операции): производительность, цикл выполнения, SLA, штат, процессы, время отгрузки, брак, утилизация мощностей
- marketing (Маркетинг): CAC по каналам, источники трафика, ROI кампаний, бренд, охват, доля рынка, бюджет на маркетинг
- strategy (Стратегия): миссия, цели, конкуренты, рынок, продукт, рост, портфель, инвестиции, M&A
- anketa (Анкета): общие данные компании, отрасль, география, штат, год основания — фактологические сведения
`.trim()

function buildPrompt(docType: string, primaryTab: DiagnosticTab, text: string) {
  const trimmed = text.slice(0, 25000)
  return `Ты — бизнес-аналитик. Извлеки из документа компании структурированные параметры.

Тип документа: ${docType}
Приоритетная вкладка диагностики: ${primaryTab}

${TAB_GUIDE}

Правила:
- Извлекай только реальные факты из документа. Не выдумывай.
- Каждый параметр привяжи к одной вкладке (tab) и укажи название параметра (parameter).
- confidence: 1.0 — значение явно указано в документе; 0.7-0.9 — выведено из контекста; <0.5 не возвращай.
- source_excerpt: короткая (до 300 символов) дословная цитата.
- Максимум 40 параметров. Лучше меньше — но точнее.
- Если документ не содержит бизнес-данных (например, маркетинговая брошюра без цифр), верни fields: [] и summary с описанием содержимого.

Документ (первые ${trimmed.length} символов из ${text.length}):
\`\`\`
${trimmed}
\`\`\``
}

export async function extractFromDocument(opts: {
  buffer: Buffer
  fileName: string
  mimeType?: string | null
  docType: string
}): Promise<{ extraction: ExtractionResult; rawTextPreview: string; modelUsed?: string }> {
  const ext = opts.fileName.toLowerCase().split('.').pop()
  const primaryTab = DOC_TYPE_PRIMARY_TAB[opts.docType] ?? 'anketa'

  let parsed: ParsedDocument
  try {
    if (ext === 'csv') {
      const text = opts.buffer.toString('utf-8')
      parsed = {
        text: text.trim(),
        metadata: {
          type: 'txt',
          wordCount: text.split(/\s+/).length,
          fileName: opts.fileName,
        },
      }
    } else if (ext === 'pptx') {
      return {
        extraction: {
          summary:
            'Файл PPTX загружен. Автоматический разбор презентаций пока не реализован — отметьте файл вручную или конвертируйте в PDF/DOCX.',
          fields: [],
        },
        rawTextPreview: '',
      }
    } else {
      parsed = await parseDocument(opts.buffer, opts.fileName, opts.mimeType ?? undefined)
    }
  } catch (err) {
    return {
      extraction: {
        summary: `Файл загружен, но автоматический парсинг недоступен: ${err instanceof Error ? err.message : 'unknown error'}`,
        fields: [],
      },
      rawTextPreview: '',
    }
  }

  const rawTextPreview = parsed.text.slice(0, 2000)

  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      extraction: {
        summary: `Документ загружен (${parsed.text.length} символов). LLM-анализ недоступен — не задан ANTHROPIC_API_KEY.`,
        fields: [],
      },
      rawTextPreview,
    }
  }

  if (parsed.text.length < 30) {
    return {
      extraction: {
        summary: 'Документ слишком короткий или пуст — извлекать нечего.',
        fields: [],
      },
      rawTextPreview,
    }
  }

  try {
    const result = await generateObject({
      model: anthropic(CLAUDE_MODELS.sonnet),
      schema: extractionSchema,
      prompt: buildPrompt(opts.docType, primaryTab, parsed.text),
    })
    return {
      extraction: result.object,
      rawTextPreview,
      modelUsed: CLAUDE_MODELS.sonnet,
    }
  } catch (err) {
    return {
      extraction: {
        summary: `Парсинг текста выполнен, но LLM-извлечение упало: ${err instanceof Error ? err.message : 'unknown error'}`,
        fields: [],
      },
      rawTextPreview,
    }
  }
}
