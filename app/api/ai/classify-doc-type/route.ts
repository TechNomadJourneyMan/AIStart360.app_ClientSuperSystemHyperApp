export const dynamic = 'force-dynamic'

/**
 * POST /api/ai/classify-doc-type
 *
 * Upload-time UI helper: takes filename + mime + a short content excerpt
 * and asks Haiku (cheapest model, ~$0.0001/call) to suggest a doc_type
 * matching the dropdown vocabulary on /client/onboarding/documents.
 *
 * Returns 200 with { ok: true, suggestedType, confidence, reasoning } on
 * success. Returns 200 with { ok: false } on any failure so the UI just
 * silently skips the suggestion.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { CLAUDE_MODELS } from '@/lib/ai/anthropic'
import { extractWithCache } from '@/lib/ai/prompt-cache'

const UI_DOC_TYPES = [
  'pl_report',
  'balance_sheet',
  'marketing_report',
  'ops_report',
  'crm_export',
  'audit',
  'patient_base',
  'other',
] as const

const SCHEMA = z.object({
  suggestedType: z.enum(UI_DOC_TYPES),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().max(280),
})

const SYSTEM_PROMPT = `Ты классификатор документов для платформы AIStart360.

По имени файла, MIME-типу и короткому фрагменту содержимого (первые 2KB)
определи тип документа. Выбери одно значение из перечисленных ниже.

Типы и признаки:
- pl_report — P&L / отчёт о прибылях и убытках. Признаки: revenue/выручка по периодам, COGS, gross/net profit, EBITDA, margin %.
- balance_sheet — бухгалтерский баланс. Признаки: активы/пассивы, current/long-term, equity, debt, assets = liabilities.
- marketing_report — рекламные кампании, performance-маркетинг. Признаки: каналы (Google/Meta/Yandex), CAC, ROAS, CTR, impressions, clicks, leads, CPL.
- ops_report — операционный отчёт. Признаки: KPI процессов, время обработки, defect rate, on-time delivery, employee utilization.
- crm_export — выгрузка из CRM (НЕ медицинская база). Признаки: контакты клиентов с продажами, deal stages, lost reasons, salesperson, lead source, status (lead/customer).
- audit — аудит / чек-лист / план рекомендаций. Признаки: findings, severity, owner, deadline, recommendation, action items.
- patient_base — медицинская база пациентов. Признаки: имя пациента, телефон, дата визита, услуга, врач, диагноз, страховка, медкарта. Часто названия с "Клиенты_", "Пациенты_", клиника, медцентр.
- other — всё остальное (бизнес-план, стратегия, маркетинговый материал, скрипты, шаблоны и т.п.).

Правила:
- confidence: 0.9+ если имя файла + содержимое явно говорят о типе; 0.5-0.8 если только один признак ясен; 0.3-0.5 если догадка.
- reasoning: одно короткое предложение по-русски ПОЧЕМУ.
- Если в файле колонки типа "фамилия, телефон, дата визита, врач" — это patient_base, не crm_export.
- Если файл .docx с прозой — почти всегда other.
- Если только filename без content — опирайся на имя.

Верни строгий JSON.`

export async function POST(req: NextRequest) {
  let body: { fileName?: string; mimeType?: string; textExcerpt?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid body' }, { status: 400 })
  }

  const fileName = (body.fileName ?? '').toString().slice(0, 300)
  const mimeType = (body.mimeType ?? '').toString().slice(0, 100)
  const textExcerpt = (body.textExcerpt ?? '').toString().slice(0, 3000)

  if (!fileName) {
    return NextResponse.json({ ok: false, error: 'fileName required' }, { status: 400 })
  }

  // Build user content combining filename, mime, and excerpt.
  const userContent = [
    `Файл: "${fileName}"`,
    `MIME: ${mimeType || '(не указан)'}`,
    `Содержимое (первые 2KB):`,
    textExcerpt || '(нет содержимого)',
  ].join('\n\n')

  try {
    const result = await extractWithCache({
      model: CLAUDE_MODELS.haiku,
      schema: SCHEMA,
      schemaName: 'doc_type_classification',
      system: SYSTEM_PROMPT,
      user: userContent,
      maxTokens: 400,
    })
    return NextResponse.json({
      ok: true,
      suggestedType: result.data.suggestedType,
      confidence: result.data.confidence,
      reasoning: result.data.reasoning,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[classify-doc-type] error', msg)
    return NextResponse.json({ ok: false, error: 'classification_failed' }, { status: 200 })
  }
}
