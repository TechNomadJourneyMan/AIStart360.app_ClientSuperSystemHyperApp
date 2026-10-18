export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireGiga } from '@/lib/admin/giga-actor'
import { guardClientAccess } from '@/lib/admin/client-scope'
import { recordAdminAction } from '@/lib/admin/audit'
import { createServiceClient } from '@/lib/supabase-service'
import { loadPointBInputs } from '@/lib/point-b/inputs'
import { computePointB } from '@/lib/point-b/compute'
import { profanityResponse } from '@/lib/moderation/http'

/**
 * GET  /api/giga-admin/users/:id/point-b — Точка Б клиента (тот же расчёт, что
 *      видит клиент) + последняя экспертная корректировка.
 * POST /api/giga-admin/users/:id/point-b { expert_notes, roadmap? } —
 *      сохранить корректировку (право clients.review, только для клиентов).
 *
 * Расчёт не сохраняется: хранением Точки Б владеет кабинет клиента. Порядок
 * публикации корректировки (черновик → одобрение) — зона пакета 1b; пока
 * поведение прежнее, как в старом портале эксперта: корректировка сразу видна
 * клиенту.
 */

const bodySchema = z.object({
  expert_notes: z.string().trim().min(1, 'Введите текст корректировки').max(8000, 'Слишком длинный текст'),
  roadmap: z.unknown().optional(),
})

async function currentDiagnostic(sb: ReturnType<typeof createServiceClient>, userId: string) {
  const { data } = await sb.from('diagnostics').select('*').eq('user_id', userId).eq('is_current', true).order('calculated_at', { ascending: false }).limit(1)
  return ((data ?? [])[0] ?? null) as Record<string, unknown> | null
}

async function latestVersion(sb: ReturnType<typeof createServiceClient>, diagnosticId: string) {
  const { data } = await sb
    .from('point_b_versions')
    .select('id, expert_notes, author_name, is_approved, created_at')
    .eq('diagnostic_id', diagnosticId)
    .order('created_at', { ascending: false })
    .limit(1)
  return (data ?? [])[0] ?? null
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireGiga(req, ['users.view', 'users.sensitive'])
  if (guard.response) return guard.response
  const scopeDenied = await guardClientAccess(guard.actor, params.id)
  if (scopeDenied) return scopeDenied

  const sb = createServiceClient()
  let inputs
  try {
    inputs = await loadPointBInputs(sb, params.id)
  } catch (err) {
    console.error('[giga/point-b] inputs not loaded', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false, error: 'Не удалось загрузить данные Точки Б' }, { status: 500 })
  }
  // The same inputs and computation as the client's own page (lib/point-b).
  const pointB = computePointB(inputs)
  if (!pointB || !inputs.diagnostic) return NextResponse.json({ ok: true, data: { pointB: null, reason: 'no_diagnostic', version: null } })

  return NextResponse.json({ ok: true, data: { pointB, reason: null, version: await latestVersion(sb, String(inputs.diagnostic.id)) } })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireGiga(req, ['users.view', 'users.sensitive', 'clients.review'])
  if (guard.response) return guard.response
  const scopeDenied = await guardClientAccess(guard.actor, params.id, { clientOnly: true })
  if (scopeDenied) return scopeDenied

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? 'Неверный запрос' }, { status: 400 })
  const profane = profanityResponse({ expert_notes: parsed.data.expert_notes })
  if (profane) return profane

  const sb = createServiceClient()
  const diag = await currentDiagnostic(sb, params.id)
  if (!diag) return NextResponse.json({ ok: false, error: 'У клиента ещё нет Точки А — корректировать нечего' }, { status: 400 })

  // Клиент видит подпись: имя эксперта, а не его рабочий email.
  const { data: me } = await sb.from('profiles').select('full_name').eq('id', guard.actor.id).maybeSingle()
  const authorName = (me as { full_name?: string | null } | null)?.full_name?.trim() || 'Эксперт AIStart360'

  const { data, error } = await sb
    .from('point_b_versions')
    .insert({
      diagnostic_id: String(diag.id),
      authored_by: guard.actor.id,
      author_name: authorName,
      expert_notes: parsed.data.expert_notes,
      roadmap: parsed.data.roadmap ?? null,
      is_approved: true,
    })
    .select('id, expert_notes, author_name, is_approved, created_at')
    .maybeSingle()
  if (error) return NextResponse.json({ ok: false, error: 'Не удалось сохранить корректировку' }, { status: 500 })

  await recordAdminAction(guard.actor, {
    action: 'expert.point_b_version_created',
    entityType: 'user', entityId: params.id, targetUserId: params.id,
    metadata: { versionId: (data as { id?: string } | null)?.id ?? null, preview: parsed.data.expert_notes.slice(0, 120) },
  }, req)

  return NextResponse.json({ ok: true, data })
}
