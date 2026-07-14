/**
 * POST /api/journey/analyze — multipart file ingest for the Journey chat.
 *
 * FormData fields:
 *   file    — the document (pdf / docx / xlsx / csv / txt, ≤10MB)
 *   payload — JSON string { history, state } (same shape as /api/journey/chat)
 *
 * Flow: parse file → text excerpt → run one AI turn with the excerpt
 * appended as a user message → envelope back (reply + widgets + point_a
 * facts extracted from the document + optional point_b/milestones).
 *
 * Lab-phase: file bytes are NOT persisted — only the extracted facts
 * live on in the journey state. Storage upload comes with DB persistence.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { parseDocument } from '@/lib/documents/parse'
import { runJourneyTurn } from '@/lib/journey/ai'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

const MAX_FILE_BYTES = 10 * 1024 * 1024   // 10MB — comfortably under local dev limits
const EXCERPT_CHARS = 7000                 // enough signal without blowing tokens

const payloadSchema = z.object({
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    text: z.string().min(1).max(8000),
  })).max(60).optional().default([]),
  state: z.object({
    companyName: z.string().max(200).optional().default(''),
    industry: z.string().max(200).optional().default(''),
    pointA: z.array(z.any()).max(16).optional().default([]),
    pointB: z.array(z.any()).max(16).optional().default([]),
    milestones: z.array(z.any()).max(20).optional().default([]),
    widgets: z.array(z.any()).max(40).optional().default([]),
  }),
})

export async function POST(req: NextRequest) {
  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_form' }, { status: 400 })
  }

  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: 'file_missing' }, { status: 400 })
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { ok: false, error: 'file_too_large', limitMb: MAX_FILE_BYTES / 1024 / 1024 },
      { status: 413 },
    )
  }

  const rawPayload = form.get('payload')
  let payload: z.infer<typeof payloadSchema>
  try {
    const parsedJson = JSON.parse(typeof rawPayload === 'string' ? rawPayload : '{}')
    const res = payloadSchema.safeParse(parsedJson)
    if (!res.success) {
      return NextResponse.json({ ok: false, error: 'invalid_payload' }, { status: 400 })
    }
    payload = res.data
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_payload_json' }, { status: 400 })
  }

  // ── Parse the document to text ──
  let text = ''
  let docType = 'unknown'
  try {
    const buf = Buffer.from(await file.arrayBuffer())
    const parsed = await parseDocument(buf, file.name, file.type || undefined)
    text = parsed.text
    docType = parsed.metadata.type
  } catch (err) {
    console.error('[journey/analyze] parse failed:', err)
    return NextResponse.json({ ok: false, error: 'parse_failed' }, { status: 422 })
  }

  if (!text.trim()) {
    return NextResponse.json({ ok: false, error: 'empty_document' }, { status: 422 })
  }

  const excerpt = text.slice(0, EXCERPT_CHARS)
  const fileTurn = {
    role: 'user' as const,
    text:
      `Загрузил файл «${file.name}» (${docType}). Извлеки из него все важные бизнес-факты: ` +
      `выручка, маржа, чеки, клиенты, каналы, расходы, что угодно полезное. Обнови Точку А ` +
      `фактами с указанием источника, создай insight_card с цитатами и — если видишь риски ` +
      `или быстрые рычаги — risk_alert / quick_win.\n\n--- НАЧАЛО ФРАГМЕНТА ---\n${excerpt}\n--- КОНЕЦ ФРАГМЕНТА ---`,
  }

  const result = await runJourneyTurn({
    history: [...payload.history.slice(-20), fileTurn],
    state: payload.state as Parameters<typeof runJourneyTurn>[0]['state'],
  })

  if ('error' in result) {
    const status = result.error === 'no_api_key' ? 503 : 502
    return NextResponse.json({ ok: false, error: result.error }, { status })
  }

  return NextResponse.json({
    ok: true,
    data: result,
    file: { name: file.name, type: docType, chars: text.length, sizeBytes: file.size },
  })
}
