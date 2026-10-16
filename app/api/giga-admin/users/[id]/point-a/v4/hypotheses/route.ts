export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { recordAdminAction } from '@/lib/admin/audit'
import { badRequest, guardPointAExpert, staffDisplayName, zodMessage } from '@/lib/admin/point-a-expert'
import { BLOCK_KEYS, isBlockKey } from '@/lib/point-a/v4/config'
import { requestPointARecalc } from '@/lib/point-a/recalc-queue'
import { buildPointASnapshot } from '@/lib/point-a/snapshot'
import type { V4Block } from '@/lib/point-a/v4/engine'
import { profanityResponse } from '@/lib/moderation/http'

/**
 * The expert's decision on the AI hypothesis of a block without data
 * (spec 2026-10-12 §7, point_a_hypothesis_reviews — migration 117):
 *
 * POST   { block, decision: 'confirmed' | 'rejected', rationale? }
 *        confirmed → the block is scored by the hypothesis (INFERRED, marked
 *        «подтверждено экспертом»); rejected → the hypothesis is dropped.
 *        The decision is tied to the block's inputs (inputs_hash): new data
 *        makes it void. Point A is recalculated.
 * DELETE ?block=  — withdraw the decision (Point A is recalculated).
 */

const Body = z.object({
  block: z.enum(BLOCK_KEYS, { errorMap: () => ({ message: 'Неизвестный блок' }) }),
  decision: z.enum(['confirmed', 'rejected'], { errorMap: () => ({ message: 'Неверное решение' }) }),
  rationale: z.string().trim().max(1000, 'Комментарий длиннее 1000 символов').optional(),
})

/**
 * The decision shows at once: Point A is rebuilt now (the expert waits a few
 * seconds); when it is busy or fails, the queue takes it (and that is said).
 */
async function applyNow(companyId: string): Promise<{ recalculated: boolean; queued: boolean }> {
  const r = await buildPointASnapshot(companyId, { trigger: 'expert', reasons: ['expert_hypothesis'], lock: true })
    .catch((err: unknown) => {
      console.error('[giga-admin/point-a/hypotheses] rebuild failed', err instanceof Error ? err.message : err)
      return null
    })
  if (r && (r.status === 'written' || r.status === 'unchanged')) return { recalculated: true, queued: false }
  return { recalculated: false, queued: await requestPointARecalc(companyId, 'expert_hypothesis') }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guardPointAExpert(req, params.id, 'write')
  if (g.response) return g.response
  const { actor, sb, companyId } = g

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return badRequest(zodMessage(parsed.error.issues))
  const profane = profanityResponse({ rationale: parsed.data.rationale })
  if (profane) return profane
  const { block: key, decision } = parsed.data

  const latest = await sb.from('point_a_snapshots').select('id, blocks').eq('company_id', companyId).order('created_at', { ascending: false }).limit(1)
  if (latest.error) return badRequest('Не удалось прочитать Точку А', 500)
  const snap = ((latest.data ?? []) as Array<{ id: string; blocks: V4Block[] | null }>)[0]
  if (!snap) return badRequest('Точка А ещё не рассчитана', 409)
  const block = (Array.isArray(snap.blocks) ? snap.blocks : []).find((b) => b.key === key)
  if (!block) return badRequest('Блока нет в текущей Точке А', 409)
  if (block.status !== 'insufficient_data') return badRequest('Блок посчитан по данным — гипотеза ему не нужна', 409)
  if (decision === 'confirmed' && !block.hypothesis) return badRequest('У блока нет гипотезы ИИ — подтверждать нечего', 409)
  if (!block.inputsHash) return badRequest('Пересчитайте Точку А и повторите', 409)

  const name = await staffDisplayName(sb, actor)
  const row = {
    company_id: companyId,
    block_key: key,
    inputs_hash: block.inputsHash,
    decision,
    score: decision === 'confirmed' ? Math.round(block.hypothesis!.score) : null,
    rationale: parsed.data.rationale || block.hypothesis?.rationale || null,
    decided_by: actor.id,
    decided_by_name: name,
    decided_at: new Date().toISOString(),
  }
  const { error } = await sb.from('point_a_hypothesis_reviews').upsert(row, { onConflict: 'company_id,block_key' })
  if (error) {
    console.error('[giga-admin/point-a/hypotheses] upsert failed', error.code ?? '')
    return badRequest('Не удалось сохранить решение', 500)
  }

  await recordAdminAction(actor, {
    action: decision === 'confirmed' ? 'point_a.hypothesis_confirmed' : 'point_a.hypothesis_rejected',
    entityType: 'company', entityId: companyId, targetUserId: params.id,
    oldValue: block.expertReview ?? null,
    newValue: { block: key, decision, score: row.score, inputsHash: row.inputs_hash },
    metadata: { snapshotId: snap.id },
  }, req)

  const applied = await applyNow(companyId)
  return NextResponse.json({ ok: true, data: { block: key, decision, score: row.score, ...applied } })
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guardPointAExpert(req, params.id, 'write')
  if (g.response) return g.response
  const { actor, sb, companyId } = g

  const key = req.nextUrl.searchParams.get('block')
  if (!isBlockKey(key)) return badRequest('Неизвестный блок')

  const { data, error } = await sb
    .from('point_a_hypothesis_reviews')
    .delete()
    .eq('company_id', companyId)
    .eq('block_key', key)
    .select('decision, score, inputs_hash')
  if (error) {
    console.error('[giga-admin/point-a/hypotheses] delete failed', error.code ?? '')
    return badRequest('Не удалось отменить решение', 500)
  }
  const old = ((data ?? []) as Array<Record<string, unknown>>)[0]
  if (!old) return badRequest('Решения по этому блоку нет', 404)

  await recordAdminAction(actor, {
    action: 'point_a.hypothesis_decision_withdrawn',
    entityType: 'company', entityId: companyId, targetUserId: params.id,
    oldValue: { block: key, ...old },
  }, req)

  const applied = await applyNow(companyId)
  return NextResponse.json({ ok: true, data: { block: key, ...applied } })
}
