export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/ai/intake
 *
 * Universal intake endpoint — accepts mixed payload:
 *   - files[]: any supported business doc (pdf/xlsx/csv/docx/txt)
 *   - text: free-form notes / data dump
 *   - companyId (optional)
 *
 * For each file:
 *   1. Sanitize name, upload to Supabase Storage (bucket 'client-documents')
 *   2. AI auto-classify doc_type via Haiku (filename + mime + content excerpt)
 *   3. Insert into documents table with classified doc_type
 *   4. Trigger orchestrator (parse → extract → consensus → bridge)
 *
 * For text:
 *   1. Sonnet routes free text to one of 5 blocks (finance/sales/marketing/
 *      operations/strategy) + extracts structured snippet
 *   2. Stored as ai_extractions row with entity_type='text_intake'
 *
 * Returns routing summary so UI shows: 'Loaded into Финансы · 3 файла +
 * 1 заметка'. Errors per item are non-fatal — endpoint reports per-item
 * success.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { createServerClient } from '@/lib/supabase-server'
import { CLAUDE_MODELS } from '@/lib/ai/anthropic'
import { extractWithCache } from '@/lib/ai/prompt-cache'
import { orchestrate } from '@/lib/ai/orchestrator'

type DocType =
  | 'pl_report' | 'balance_sheet' | 'marketing_report' | 'ops_report'
  | 'crm_export' | 'audit' | 'patient_base' | 'other'

const ALLOWED_DOC_TYPES = [
  'pl_report', 'balance_sheet', 'marketing_report', 'ops_report',
  'crm_export', 'audit', 'patient_base', 'other',
] as const

const FILE_CLASSIFY_SCHEMA = z.object({
  suggestedType: z.enum(ALLOWED_DOC_TYPES),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().max(200),
})

const TEXT_ROUTE_SCHEMA = z.object({
  block: z.enum(['finance', 'sales', 'marketing', 'operations', 'strategy']),
  category: z.string().max(80),
  structured: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  summary: z.string().max(300),
  confidence: z.number().min(0).max(1),
})

interface FileResult {
  fileName: string
  ok: boolean
  doc_type?: DocType
  confidence?: number
  document_id?: string
  ai_run_id?: string
  error?: string
}

interface TextResult {
  ok: boolean
  block?: string
  category?: string
  summary?: string
  confidence?: number
  extraction_id?: string
  error?: string
}

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

function sanitizeName(name: string): { stem: string; ext: string } {
  const ext = (name.split('.').pop() ?? 'bin').toLowerCase()
  const stem = name.replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .substring(0, 50) || 'file'
  return { stem, ext }
}

async function readExcerpt(file: File): Promise<string> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'csv' || ext === 'txt') {
    try {
      return await file.slice(0, 2048).text()
    } catch {
      return ''
    }
  }
  return ''
}

async function classifyFile(fileName: string, mimeType: string, excerpt: string): Promise<{ type: DocType; confidence: number; reasoning: string }> {
  try {
    const res = await extractWithCache({
      model: CLAUDE_MODELS.haiku,
      schema: FILE_CLASSIFY_SCHEMA,
      schemaName: 'doc_type_classification',
      system: `Ты классификатор бизнес-документов. По имени файла, MIME-типу и содержимому определи doc_type.

Типы:
- pl_report — P&L отчёт о прибылях/убытках (revenue, cogs, profit, ebitda, margin)
- balance_sheet — баланс (активы, пассивы, equity)
- marketing_report — маркетинг (CAC, ROAS, channels, leads)
- ops_report — операции (KPI процессов, no-show, processing time)
- crm_export — выгрузка из CRM (бизнес-клиенты, deals, stages)
- audit — аудит/чеклист с findings + recommendations
- patient_base — медицинская база пациентов (имена, телефоны, визиты, услуги)
- other — всё остальное

Верни строгий JSON.`,
      user: `Файл: "${fileName}"\nMIME: ${mimeType}\nСодержимое (2KB): ${excerpt || '(нет)'}`,
      maxTokens: 300,
    })
    return { type: res.data.suggestedType, confidence: res.data.confidence, reasoning: res.data.reasoning }
  } catch {
    return { type: 'other', confidence: 0, reasoning: 'classifier failed' }
  }
}

async function routeText(text: string): Promise<z.infer<typeof TEXT_ROUTE_SCHEMA> | null> {
  if (!text.trim()) return null
  try {
    const res = await extractWithCache({
      model: CLAUDE_MODELS.sonnet,
      schema: TEXT_ROUTE_SCHEMA,
      schemaName: 'text_intake_routing',
      system: `Ты обработчик свободного текста для бизнес-аналитики.

Юзер вбил произвольный текст про свой бизнес. Тебе нужно:
1. Определить главный блок: finance/sales/marketing/operations/strategy
2. Назвать категорию подробнее (например "ежемесячная выручка", "канал привлечения", "процесс продаж")
3. Извлечь ключевые цифры/факты в structured (плоский объект, ключ → значение)
4. Дать summary 1-2 предложениями на русском
5. Confidence 0-1

Пример: "У нас в августе выручка 4.5M, прибыль 0.8M, маржа 18%, CAC 7500₸"
→ block=finance, category=ежемесячная выручка
→ structured={"revenue_kzt": 4500000, "profit_kzt": 800000, "margin_pct": 18, "month": "август"}
→ summary="Выручка август 4.5M, прибыль 0.8M, маржа 18%. CAC 7500₸ скорее всего относится к маркетингу — стоит отдельной заметкой."

Верни строгий JSON.`,
      user: text.slice(0, 8000),
      maxTokens: 800,
    })
    return res.data
  } catch {
    return null
  }
}

async function uploadFile(svc: ReturnType<typeof serviceClient>, userId: string, file: File): Promise<string | null> {
  const { stem, ext } = sanitizeName(file.name)
  const path = `${userId}/${Date.now()}_${stem}.${ext}`
  const { error } = await svc.storage
    .from('client-documents')
    .upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false })
  if (error) {
    console.error('[intake] storage upload failed', error.message)
    return null
  }
  return path
}

export async function POST(req: NextRequest) {
  const sbAuth = createServerClient()
  const { data: { user } } = await sbAuth.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  let form: FormData
  try { form = await req.formData() } catch { return NextResponse.json({ error: 'invalid_form' }, { status: 400 }) }

  const files: File[] = []
  for (const [k, v] of form.entries()) {
    if (k.startsWith('file') && v instanceof File && v.size > 0) files.push(v)
  }
  const text = (form.get('text') ?? '').toString().trim()
  const companyId = (form.get('companyId') ?? '').toString() || null

  if (files.length === 0 && !text) {
    return NextResponse.json({ error: 'no_files_no_text' }, { status: 400 })
  }

  const svc = serviceClient()
  const fileResults: FileResult[] = []

  // ── Process each file in parallel ──
  await Promise.all(files.map(async (file): Promise<void> => {
    try {
      const [excerpt, storedPath] = await Promise.all([
        readExcerpt(file),
        uploadFile(svc, user.id, file),
      ])
      if (!storedPath) {
        fileResults.push({ fileName: file.name, ok: false, error: 'upload_failed' })
        return
      }

      const cls = await classifyFile(file.name, file.type, excerpt)

      // Insert documents row
      const { data: docRow, error: insErr } = await svc
        .from('documents')
        .insert({
          user_id: user.id,
          company_id: companyId,
          file_name: file.name,
          file_url: storedPath,
          file_size: file.size,
          mime_type: file.type || null,
          doc_type: cls.type,
          parse_status: 'queued',
        })
        .select('id')
        .single()

      if (insErr || !docRow) {
        fileResults.push({ fileName: file.name, ok: false, doc_type: cls.type, confidence: cls.confidence, error: 'db_insert_failed' })
        return
      }

      // Kick orchestrator (skip if no companyId — orchestrator requires it)
      let aiRunId: string | undefined
      if (companyId) {
        try {
          const res = await orchestrate({
            trigger: 'document_uploaded',
            userId: user.id,
            companyId,
            documentId: docRow.id,
            triggerEntity: `documents.${docRow.id}`,
          })
          aiRunId = res.runId
        } catch (e) {
          console.error('[intake] orchestrator dispatch failed', e)
        }
      }

      fileResults.push({
        fileName: file.name,
        ok: true,
        doc_type: cls.type,
        confidence: cls.confidence,
        document_id: docRow.id,
        ai_run_id: aiRunId,
      })
    } catch (e) {
      fileResults.push({ fileName: file.name, ok: false, error: e instanceof Error ? e.message : 'unknown' })
    }
  }))

  // ── Process text ──
  let textResult: TextResult | null = null
  if (text) {
    const routed = await routeText(text)
    if (routed) {
      // Save as ai_extractions row with entity_type='text_intake'
      try {
        const { data: extRow, error } = await svc
          .from('ai_extractions')
          .insert({
            user_id: user.id,
            company_id: companyId,
            document_id: null,
            entity_type: 'text_intake',
            data: {
              block: routed.block,
              category: routed.category,
              structured: routed.structured,
              summary: routed.summary,
              raw_text: text.slice(0, 4000),
            },
            confidence: routed.confidence,
          })
          .select('id')
          .single()

        if (!error && extRow) {
          textResult = {
            ok: true,
            block: routed.block,
            category: routed.category,
            summary: routed.summary,
            confidence: routed.confidence,
            extraction_id: extRow.id,
          }
        } else {
          textResult = { ok: false, error: error?.message ?? 'insert_failed' }
        }
      } catch (e) {
        textResult = { ok: false, error: e instanceof Error ? e.message : 'unknown' }
      }
    } else {
      textResult = { ok: false, error: 'routing_failed' }
    }
  }

  return NextResponse.json({
    ok: true,
    files: fileResults,
    text: textResult,
    summary: {
      files_total: files.length,
      files_ok: fileResults.filter((f) => f.ok).length,
      text_routed: textResult?.ok ?? false,
    },
  })
}
