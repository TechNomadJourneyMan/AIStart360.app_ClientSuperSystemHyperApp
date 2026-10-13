export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { guardPointAExpert } from '@/lib/admin/point-a-expert'
import { loadPointAState } from '@/lib/point-a/v4/state'
import { CODE_TEMPLATES, isBlockKey } from '@/lib/point-a/v4/config'

/**
 * GET /api/giga-admin/users/:id/point-a/v4 — the expert's view of the
 * client's Point A (spec 2026-10-12 §7): the same state the client sees
 * (snapshot with blocks, checks, hypotheses, discrepancies, comments,
 * «проверено экспертом»), plus what the expert configures — the templates
 * to choose from, the explicit template of the company (null = by industry)
 * and the expert's block overrides.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guardPointAExpert(req, params.id, 'read')
  if (g.response) return g.response
  const { sb, companyId } = g

  try {
    const [state, tpl, cfg] = await Promise.all([
      loadPointAState(sb, sb, companyId),
      sb.from('pa_templates').select('key, title, blocks').order('title', { ascending: true }),
      sb.from('pa_company_config').select('template_key, expert_overrides').eq('company_id', companyId).maybeSingle(),
    ])
    const tplRows = (tpl.error ? [] : tpl.data ?? []) as Array<{ key: string; title: string; blocks: unknown }>
    // Raw weights of the template in use: the expert's override replaces them (lib/point-a/v4/config.ts effectiveBlocks).
    const current = tplRows.find((t) => t.key === state.config.template)?.blocks
      ?? CODE_TEMPLATES.find((t) => t.key === state.config.template)?.blocks
    const templateBlocks = (Array.isArray(current) ? (current as unknown as Array<Record<string, unknown>>) : [])
      .filter((b) => isBlockKey(b.key))
      .map((b) => ({ key: b.key as string, weight: Number(b.weight) || 0, enabled: b.enabled !== false }))
    const c = (cfg.error ? null : cfg.data) as { template_key?: string | null; expert_overrides?: Record<string, unknown> | null } | null
    return NextResponse.json({
      ok: true,
      data: {
        companyId,
        state,
        templates: tplRows.map((t) => ({ key: t.key, title: t.title })),
        templateBlocks,
        templateKey: c?.template_key ?? null,
        overrides: c?.expert_overrides ?? {},
      },
    })
  } catch (err) {
    console.error('[giga-admin/point-a/v4] state failed', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false, error: 'Не удалось загрузить Точку А' }, { status: 500 })
  }
}
