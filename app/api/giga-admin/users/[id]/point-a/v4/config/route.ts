export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { recordAdminAction } from '@/lib/admin/audit'
import { badRequest, guardPointAExpert, zodMessage } from '@/lib/admin/point-a-expert'
import { BLOCK_KEYS } from '@/lib/point-a/v4/config'
import { emitPlatformEventSafely } from '@/lib/events/platform'

/**
 * PATCH /api/giga-admin/users/:id/point-a/v4/config
 *   { templateKey?: string | null, expertOverrides?: { [block]: { weight?, enabled? } | null } }
 *
 * The expert's block configuration of the company (pa_company_config, spec
 * §2.2): the template (null = by industry) and per-block weight (0..10,
 * relative — normalised over the enabled blocks) / on-off. `{ block: null }`
 * removes the expert's override of that block (back to the template). The
 * version is bumped and BLOCK_CONFIG_CHANGED recalculates the client's score.
 */

const Block = z.enum(BLOCK_KEYS)
const Override = z.object({
  weight: z.number({ invalid_type_error: 'Вес — число' }).min(0, 'Вес от 0 до 10').max(10, 'Вес от 0 до 10').optional(),
  enabled: z.boolean().optional(),
}).strict()
const Body = z.object({
  templateKey: z.string().regex(/^[a-z0-9_-]{2,40}$/, 'Неверный ключ шаблона').nullable().optional(),
  expertOverrides: z.record(Block, Override.nullable()).optional(),
}).refine((b) => b.expertOverrides !== undefined || b.templateKey !== undefined, 'Нечего сохранять')

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guardPointAExpert(req, params.id, 'write')
  if (g.response) return g.response
  const { actor, sb, companyId } = g

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return badRequest(zodMessage(parsed.error.issues))

  const cur = await sb.from('pa_company_config').select('template_key, expert_overrides, client_view, version').eq('company_id', companyId).maybeSingle()
  if (cur.error) {
    console.error('[giga-admin/point-a/config] read failed', cur.error.code ?? '')
    return badRequest('Не удалось сохранить настройку блоков', 500)
  }
  const prev = (cur.data ?? {}) as { template_key?: string | null; expert_overrides?: Record<string, unknown> | null; client_view?: Record<string, unknown> | null; version?: number }

  const overrides: Record<string, unknown> = { ...(prev.expert_overrides ?? {}) }
  for (const [k, v] of Object.entries(parsed.data.expertOverrides ?? {})) {
    if (v === null || v === undefined || (v.weight === undefined && v.enabled === undefined)) delete overrides[k]
    else overrides[k] = { ...v }
  }
  const row = {
    company_id: companyId,
    template_key: parsed.data.templateKey !== undefined ? parsed.data.templateKey : prev.template_key ?? null,
    expert_overrides: overrides,
    client_view: prev.client_view ?? {},
    version: (prev.version ?? 0) + 1,
    updated_by: actor.id,
    updated_at: new Date().toISOString(),
  }
  const up = await sb.from('pa_company_config').upsert(row, { onConflict: 'company_id' })
  if (up.error) {
    console.error('[giga-admin/point-a/config] write failed', up.error.code ?? '')
    return up.error.code === '23503' ? badRequest('Неизвестный шаблон') : badRequest('Не удалось сохранить настройку блоков', 500)
  }

  await recordAdminAction(actor, {
    action: 'point_a.block_config_changed',
    entityType: 'company', entityId: companyId, targetUserId: params.id,
    oldValue: { templateKey: prev.template_key ?? null, expertOverrides: prev.expert_overrides ?? {} },
    newValue: { templateKey: row.template_key, expertOverrides: row.expert_overrides },
    metadata: { version: row.version },
  }, req)

  emitPlatformEventSafely({
    name: 'BLOCK_CONFIG_CHANGED', companyId, subjectType: 'company', subjectId: companyId, actor: `giga:${actor.id}`,
    payload: { by: 'expert', version: row.version }, dedupeKey: `block_config:${companyId}:${row.version}`,
  })

  return NextResponse.json({ ok: true, data: { version: row.version, templateKey: row.template_key, overrides: row.expert_overrides } })
}
