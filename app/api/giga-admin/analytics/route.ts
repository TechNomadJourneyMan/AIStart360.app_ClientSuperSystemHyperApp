export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { clampDays, loadActivitySeries, loadConversion, loadRetentionCohorts } from '@/lib/analytics/load'

/**
 * GET /api/giga-admin/analytics?parts=series,cohorts,conversion&days=30&weeks=8
 *
 *   series     — DAU / WAU / MAU / stickiness по дням (daily_activity)
 *   cohorts    — недельные когорты регистрации × удержание D1/D7/D30, W1..W8
 *   conversion — активация (настройки activation_*) и Free→Pro за период
 *
 * Только агрегаты, без персональных данных. Каждая часть независима: если
 * миграция 090 ещё не применена, часть возвращается как null + unavailable.
 */
const PARTS = new Set(['series', 'cohorts', 'conversion'])

export async function GET(req: NextRequest) {
  const guard = await requireGiga(req, 'analytics.view')
  if (guard.response) return guard.response
  const sp = req.nextUrl.searchParams
  const parts = (sp.get('parts') ?? 'series,cohorts,conversion').split(',').filter((p) => PARTS.has(p))
  if (!parts.length) return NextResponse.json({ ok: false, error: 'Неизвестный отчёт' }, { status: 400 })
  const days = clampDays(sp.get('days'))
  const weeks = Math.min(26, Math.max(1, Number(sp.get('weeks')) || 8))

  const unavailable: string[] = []
  const safe = async <T,>(name: string, run: () => Promise<T>): Promise<T | null> => {
    try {
      return await run()
    } catch (e) {
      console.error(`[giga-admin/analytics] ${name} failed:`, e instanceof Error ? e.message : e)
      unavailable.push(name)
      return null
    }
  }

  const [series, cohorts, conversion] = await Promise.all([
    parts.includes('series') ? safe('series', () => loadActivitySeries(days)) : Promise.resolve(undefined),
    parts.includes('cohorts') ? safe('cohorts', () => loadRetentionCohorts(weeks)) : Promise.resolve(undefined),
    parts.includes('conversion') ? safe('conversion', () => loadConversion(days)) : Promise.resolve(undefined),
  ])

  return NextResponse.json({
    ok: true,
    days,
    weeks,
    ...(series !== undefined ? { series } : {}),
    ...(cohorts !== undefined ? { cohorts } : {}),
    ...(conversion !== undefined ? { activation: conversion?.activation ?? null, freeToPro: conversion?.freeToPro ?? null } : {}),
    unavailable,
  })
}
