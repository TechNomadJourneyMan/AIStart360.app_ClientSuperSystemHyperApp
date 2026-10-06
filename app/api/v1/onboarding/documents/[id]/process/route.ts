export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
// The queued run may start in the background of this request (waitUntil).
export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { enqueueAgentTask } from '@/lib/agents/queue'
import { getSessionRole, getSessionUser, isStaffRole } from '@/lib/api-identity'
import {
  attachOwnerCompany,
  getDocument,
  isUuid,
  liveTaskForDocument,
  resetForReprocess,
  taskStatus,
  type DocumentRow,
} from '@/lib/documents/repository'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { createServerClient } from '@/lib/supabase-server'
import { resolveTenant } from '@/lib/tenancy'

const LIVE = new Set(['queued', 'running', 'awaiting_approval'])

/**
 * POST /api/v1/onboarding/documents/[id]/process — (re)process a document.
 *
 * No longer parses inline: it puts the document back in the queue and enqueues
 * a `document_intelligence` agent task (manual trigger, idempotent per
 * document + processing attempt). If a task for the document is already
 * queued or running, that task is returned instead.
 *
 *   202 { ok: true, task_id, status, already_queued?: true, data?: document }
 *   401 / 404 / 409 { ok: false, code, error } / 429 / 503
 *
 * Authz: the uploader, platform staff, or a manager of the document's company.
 * Writes go through the server connection after authz (the 089 guard blocks
 * pipeline columns for PostgREST callers).
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const sb = createServerClient()
  const user = await getSessionUser(sb)
  if (!user) return NextResponse.json({ ok: false, code: 'UNAUTHENTICATED', error: 'unauthorized' }, { status: 401 })
  if (await isRateLimitedKey(user.id, 'documents-process', { max: 20, windowMs: 60_000 })) {
    return NextResponse.json({ ok: false, code: 'RATE_LIMITED', error: 'Слишком много запросов. Попробуйте позже.' }, { status: 429 })
  }

  const notFound = NextResponse.json({ ok: false, code: 'NOT_FOUND', error: 'Документ не найден' }, { status: 404 })
  if (!isUuid(params.id)) return notFound
  const doc = await getDocument(params.id)
  if (!doc || !(await mayProcess(sb, user.id, doc))) return notFound

  if (doc.parse_status === 'rejected' || doc.security_status === 'rejected') {
    return NextResponse.json({
      ok: false,
      code: 'REJECTED',
      error: doc.security_reason ?? 'Файл отклонён проверкой безопасности. Загрузите другой файл.',
    }, { status: 409 })
  }

  const companyId = doc.company_id ?? (await attachOwnerCompany(doc.id))
  if (!companyId) {
    return NextResponse.json({
      ok: false,
      code: 'NO_COMPANY',
      error: 'Документ не привязан к компании. Заполните данные компании и повторите.',
    }, { status: 409 })
  }

  const live = await liveTaskForDocument(doc.id)
  if (live) {
    return NextResponse.json({ ok: true, task_id: live.id, status: live.status, already_queued: true }, { status: 202 })
  }

  const reset = await resetForReprocess(doc.id)
  if (!reset) {
    return NextResponse.json({ ok: false, code: 'REJECTED', error: 'Документ нельзя обработать повторно.' }, { status: 409 })
  }

  const key = `doc_process:${doc.id}:${reset.attempts}`
  const enqueue = (idempotencyKey: string) => enqueueAgentTask({
    agentKey: 'document_intelligence',
    companyId,
    trigger: 'manual',
    triggerRef: 'documents.process',
    requestedBy: user.id,
    input: { document_id: doc.id },
    idempotencyKey,
  })
  try {
    let task = await enqueue(key)
    if (!task.created && !LIVE.has((await taskStatus(task.id)) ?? '')) {
      // Same attempt number, but that task already finished without taking
      // the document (e.g. it found it busy) — start a fresh one.
      task = await enqueue(`${key}:${Date.now()}`)
    }
    return NextResponse.json({ ok: true, task_id: task.id, status: 'queued', data: reset }, { status: 202 })
  } catch (err) {
    console.error('[documents/process] enqueue failed', doc.id, err instanceof Error ? err.message : err)
    return NextResponse.json({
      ok: false,
      code: 'AGENT_UNAVAILABLE',
      error: 'Обработка документов временно недоступна. Документ останется в очереди.',
    }, { status: 503 })
  }
}

async function mayProcess(sb: ReturnType<typeof createServerClient>, userId: string, doc: DocumentRow): Promise<boolean> {
  if (doc.user_id === userId) return true
  if (doc.company_id) {
    const tenant = await resolveTenant({ companyId: doc.company_id, access: 'read' }).catch(() => null)
    if (tenant?.ok && (tenant.tenant.role === 'staff' || tenant.tenant.canManage)) return true
  }
  return isStaffRole(await getSessionRole(sb, userId))
}
