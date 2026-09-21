export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { createServiceClient } from '@/lib/supabase-service'
import { GRI_SECTIONS } from '@/lib/gri-assessment/sections'

/**
 * GET /api/giga-admin/gri/benchmark — средний GRI по отраслям.
 *
 * Цифра «7.5» ничего не значит, пока не с чем сравнить. Здесь — среднее по
 * текущим результатам, сгруппированное по отрасли компании, плюс средние по
 * блокам: видно не только «выше/ниже», но и за счёт чего.
 *
 * Отрасли с одним-двумя клиентами не показываем как ориентир: среднее по
 * одному — это не бенчмарк, а тот же самый клиент.
 */

const MIN_SAMPLE = 3

interface Row { user_id: string; gri_index: number | null; section_avgs: Record<string, number> | null }

/** «IT / Технологии», «it/технологии» и «IT» — одна отрасль. */
function normIndustry(raw: string | null | undefined): string | null {
  if (!raw) return null
  const v = raw.trim().toLowerCase().replace(/\s+/g, ' ')
  return v.length >= 2 ? v : null
}

export async function GET(req: NextRequest) {
  const guard = await requireGiga(req, 'gri.view')
  if (guard.response) return guard.response

  const sb = createServiceClient()
  const [{ data: assessments, error }, { data: companies }] = await Promise.all([
    sb.from('gri_assessments').select('user_id, gri_index, section_avgs').eq('is_current', true).limit(5000),
    sb.from('companies').select('user_id, industry').limit(5000),
  ])
  if (error) return NextResponse.json({ ok: false, error: 'Не удалось посчитать бенчмарк' }, { status: 500 })

  const industryByUser = new Map<string, string | null>()
  const labelByKey = new Map<string, string>()
  for (const c of (companies ?? []) as Array<{ user_id: string; industry: string | null }>) {
    const key = normIndustry(c.industry)
    industryByUser.set(c.user_id, key)
    if (key && c.industry && !labelByKey.has(key)) labelByKey.set(key, c.industry.trim())
  }

  const groups = new Map<string, { sum: number; n: number; blocks: Map<string, { sum: number; n: number }> }>()
  const add = (key: string, r: Row) => {
    if (typeof r.gri_index !== 'number') return
    const g = groups.get(key) ?? { sum: 0, n: 0, blocks: new Map() }
    g.sum += r.gri_index
    g.n += 1
    for (const [block, value] of Object.entries(r.section_avgs ?? {})) {
      if (typeof value !== 'number') continue
      const b = g.blocks.get(block) ?? { sum: 0, n: 0 }
      b.sum += value
      b.n += 1
      g.blocks.set(block, b)
    }
    groups.set(key, g)
  }

  for (const r of (assessments ?? []) as Row[]) {
    add('__all__', r)
    const key = industryByUser.get(r.user_id)
    if (key) add(key, r)
  }

  const shape = (key: string, label: string) => {
    const g = groups.get(key)
    if (!g || !g.n) return null
    return {
      key,
      label,
      sample: g.n,
      avg: Number((g.sum / g.n).toFixed(2)),
      blocks: GRI_SECTIONS.map((s) => {
        const b = g.blocks.get(s.id)
        return { id: s.id, avg: b && b.n ? Number((b.sum / b.n).toFixed(2)) : null }
      }),
    }
  }

  const overall = shape('__all__', 'Вся платформа')
  const industries = [...groups.keys()]
    .filter((k) => k !== '__all__' && (groups.get(k)?.n ?? 0) >= MIN_SAMPLE)
    .map((k) => shape(k, labelByKey.get(k) ?? k))
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => b.sample - a.sample)

  return NextResponse.json({ ok: true, data: { overall, industries, minSample: MIN_SAMPLE } })
}
