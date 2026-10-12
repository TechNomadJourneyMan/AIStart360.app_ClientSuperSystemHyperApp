// ============================================================
// PATCH /api/v1/point-a/config[?companyId=] — the block constructor of the
// company (public.pa_company_config, spec §2.2):
//   { clientView: { hidden?, order?, added? } }        owner / admin (manage)
//   { expertOverrides: { [block]: { weight?, enabled? } }, templateKey? }
//                                                      staff / partner experts only
// Never weights from the client. The version is bumped; BLOCK_CONFIG_CHANGED
// recalculates Point A.
// ============================================================
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase-service'
import { resolveTenantWith, tenantErrorMessage } from '@/lib/tenancy'
import { apiError } from '@/lib/api-error'
import { BLOCK_KEYS } from '@/lib/point-a/v4/config'
import { getMetricById } from '@/lib/metrics/registry'
import { emitPlatformEventSafely } from '@/lib/events/platform'

export const dynamic = 'force-dynamic'

const Block = z.enum(BLOCK_KEYS)
const Body = z.object({
  clientView: z.object({
    hidden: z.array(Block).max(7).optional(),
    order: z.array(Block).max(7).optional(),
    added: z.array(Block).max(7).optional(),
    keyMetrics: z.array(z.string().min(3).max(120)).max(8).optional(),
  }).optional(),
  expertOverrides: z.record(Block, z.object({ weight: z.number().min(0).max(10).optional(), enabled: z.boolean().optional() })).optional(),
  templateKey: z.string().regex(/^[a-z0-9_-]{2,40}$/).nullable().optional(),
}).refine((b) => b.clientView || b.expertOverrides || b.templateKey !== undefined, 'empty')

export async function PATCH(req: Request): Promise<NextResponse> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return apiError(tenantErrorMessage('unauthenticated'), 401)
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return apiError('Неверный запрос', 400)
  if (parsed.data.clientView?.keyMetrics?.some((id) => !getMetricById(id))) return apiError('Неизвестная метрика', 400)
  const expertChange = !!parsed.data.expertOverrides || parsed.data.templateKey !== undefined
  // The client's view needs manage access (owner / admin). Weights and the
  // template are an expert's: platform staff or the company's partner expert
  // — who do not have manage access (can_manage_company), only read + role.
  const tenant = await resolveTenantWith(supabase, user.id, { companyId: new URL(req.url).searchParams.get('companyId'), access: expertChange ? 'read' : 'manage' })
  if (!tenant.ok) return apiError(tenantErrorMessage(tenant.error), tenant.status)
  const { companyId, role } = tenant.tenant
  const expert = role === 'staff' || role === 'partner_expert' || role === 'partner_admin'
  if (expertChange && !expert) return apiError('Веса и шаблон блоков меняет эксперт', 403)
  if (parsed.data.clientView && !tenant.tenant.canManage) return apiError('Нет доступа к настройке вида', 403)

  const service = createServiceClient()
  const cur = await service.from('pa_company_config').select('template_key, expert_overrides, client_view, version').eq('company_id', companyId).maybeSingle()
  if (cur.error) {
    console.error('[api/v1/point-a/config] read failed', cur.error.code ?? '')
    return apiError('Не удалось сохранить настройку блоков', 500)
  }
  const prev = (cur.data ?? {}) as { template_key?: string | null; expert_overrides?: Record<string, unknown>; client_view?: Record<string, unknown>; version?: number }
  const row = {
    company_id: companyId,
    template_key: parsed.data.templateKey !== undefined ? parsed.data.templateKey : prev.template_key ?? null,
    expert_overrides: parsed.data.expertOverrides ? { ...(prev.expert_overrides ?? {}), ...parsed.data.expertOverrides } : prev.expert_overrides ?? {},
    client_view: parsed.data.clientView ? { ...(prev.client_view ?? {}), ...parsed.data.clientView } : prev.client_view ?? {},
    version: (prev.version ?? 0) + 1,
    updated_by: user.id,
  }
  const up = await service.from('pa_company_config').upsert(row, { onConflict: 'company_id' })
  if (up.error) {
    console.error('[api/v1/point-a/config] write failed', up.error.code ?? '')
    return apiError(up.error.code === '23503' ? 'Неизвестный шаблон' : 'Не удалось сохранить настройку блоков', up.error.code === '23503' ? 400 : 500)
  }
  // Only what the score depends on recalculates Point A (hidden / order /
  // key metrics change the view only).
  const scoreChange = expertChange || parsed.data.clientView?.added !== undefined
  if (scoreChange) emitPlatformEventSafely({
    name: 'BLOCK_CONFIG_CHANGED', companyId, subjectType: 'company', subjectId: companyId, actor: `user:${user.id}`,
    payload: { by: expert ? 'expert' : 'client', version: row.version }, dedupeKey: `block_config:${companyId}:${row.version}`,
  })
  return NextResponse.json({ ok: true, data: { version: row.version, clientView: row.client_view, expertOverrides: row.expert_overrides, templateKey: row.template_key } })
}
