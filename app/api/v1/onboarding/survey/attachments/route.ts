export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { isQuestionKey, listQuestionDocuments, unlinkDocumentFromQuestion } from '@/lib/documents/question-link'

/**
 * Files attached to one questionnaire question (answer editor, PO item 4.1).
 *
 * GET    ?key=<question_key>        → { ok, data: ClientDocument[], available }
 * DELETE { id, key }                → detach the file from the question
 *                                     (the document stays in «Мои документы»)
 *
 * Always the session user's own documents (no user_id from the client).
 * Uploading goes through the normal pipeline: POST /api/v1/documents with
 * `question_key` (lib/documents/client-upload.ts).
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(req: NextRequest) {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Требуется вход в систему' }, { status: 401 })
  const key = req.nextUrl.searchParams.get('key')
  if (!isQuestionKey(key)) return NextResponse.json({ ok: false, error: 'Некорректный вопрос' }, { status: 400 })

  const res = await listQuestionDocuments(sb, { userId: user.id, questionKey: key })
  if (!res.ok) return NextResponse.json({ ok: false, error: 'Не удалось загрузить прикреплённые файлы' }, { status: 500 })
  return NextResponse.json({ ok: true, data: res.documents, available: res.available })
}

export async function DELETE(req: NextRequest) {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Требуется вход в систему' }, { status: 401 })
  const body = (await req.json().catch(() => null)) as { id?: unknown; key?: unknown } | null
  if (typeof body?.id !== 'string' || !UUID_RE.test(body.id) || !isQuestionKey(body.key)) {
    return NextResponse.json({ ok: false, error: 'Некорректный запрос' }, { status: 400 })
  }
  // The update is scoped to the session user's row; the service role only
  // avoids the client-write guard of documents (089/096).
  let writer: Parameters<typeof unlinkDocumentFromQuestion>[0]
  try {
    writer = createServiceClient()
  } catch {
    writer = sb
  }
  const result = await unlinkDocumentFromQuestion(writer, { documentId: body.id, userId: user.id, questionKey: body.key })
  if (result === 'error') return NextResponse.json({ ok: false, error: 'Не удалось открепить файл' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
