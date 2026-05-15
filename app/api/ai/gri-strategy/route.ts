export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * Strategy Agent — GRI top-5 limitations + 30/60/90 action plan.
 *
 * First multi-agent step: a dedicated Opus call that cross-references
 * diagnostics block scores, RFM segments, revenue losses, P&L extractions
 * and survey answers to synthesize an executive-level action plan.
 *
 * GET: returns cached plan from profiles.branding.gri_strategy
 *      (returns null if never generated).
 * POST: forces regeneration, writes back to profiles, returns fresh plan.
 *
 * Model: Opus 4.1 via OpenRouter — higher reasoning depth for cross-domain
 * synthesis. ~$0.10 per generation.
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerClient } from '@/lib/supabase-server'
import { CLAUDE_MODELS } from '@/lib/ai/anthropic'
import { extractWithCache } from '@/lib/ai/prompt-cache'

const STRATEGY_SCHEMA = z.object({
  overview: z.string().max(600).describe('1-2 sentence executive summary in Russian'),
  top_5_limitations: z
    .array(
      z.object({
        rank: z.number().int().min(1).max(5),
        title: z.string().max(120),
        block: z.enum(['finance', 'sales', 'marketing', 'operations', 'strategy', 'team', 'product']),
        estimated_loss_kzt_per_year: z.number(),
        severity: z.enum(['critical', 'high', 'medium', 'low']),
        why: z.string().max(400).describe('Why this limits growth, evidence from data'),
        unblocks: z.string().max(200).describe('What becomes possible after solving'),
      })
    )
    .length(5),
  action_plan: z.object({
    days_30: z
      .array(z.object({ task: z.string().max(180), owner: z.string().max(50), kpi: z.string().max(80) }))
      .min(3).max(6),
    days_60: z
      .array(z.object({ task: z.string().max(180), owner: z.string().max(50), kpi: z.string().max(80) }))
      .min(3).max(6),
    days_90: z
      .array(z.object({ task: z.string().max(180), owner: z.string().max(50), kpi: z.string().max(80) }))
      .min(3).max(6),
  }),
  expected_outcome: z.object({
    revenue_lift_kzt_monthly: z.number(),
    timeline_months: z.number().int().min(1).max(12),
    risk_level: z.enum(['low', 'medium', 'high']),
    confidence: z.number().min(0).max(1),
  }),
})

export type GriStrategy = z.infer<typeof STRATEGY_SCHEMA>

// Stable task id helper — composes period + index. Stable across re-fetches
// of the same strategy (until regeneration replaces it entirely).
// Not exported because Next.js App Router restricts route.ts exports
// to HTTP verbs + config constants.
function _taskId(period: 'days_30' | 'days_60' | 'days_90', index: number): string {
  return `${period}:${index}`
}
void _taskId

const SYSTEM_PROMPT = `Ты — главный стратегический советник для предпринимателя. У тебя есть доступ
к данным бизнеса (диагностика, метрики, AI-извлечения из загруженных
отчётов, RFM-сегментация клиентов, карта потерь).

Твоя задача: синтезировать **топ-5 ограничений роста** и составить **план
действий 30/60/90 дней**, опираясь СТРОГО на данные пользователя.

Правила:
- Без воды. Каждое ограничение должно иметь evidence из данных.
- estimated_loss_kzt_per_year — реалистичная оценка потерянной выручки/год
  из-за этого ограничения. Опирайся на revenue_losses, отсутствующие KPI,
  низкие конверсии.
- Action plan: конкретные задачи с владельцем и KPI. Не «улучшить процессы»,
  а «настроить WhatsApp-канал реактивации до 50 шаблонов в неделю».
- 30 дней — quick wins, низкая сложность, можно сделать одной командой.
- 60 дней — internal process changes, нужны изменения SOP / CRM.
- 90 дней — стратегические шаги, требующие найма / интеграции.
- revenue_lift_kzt_monthly — что юзер увидит в месяц после полного выполнения плана.
- timeline_months — за сколько месяцев план приведёт к ROI.
- risk_level — высокий если требуется существенный bias-changing / найм.
- confidence — насколько уверен в прогнозе (0.5 если данные неполные, 0.9+ если всё подробно).

Все суммы в KZT. Текст русский.

Верни строгий JSON.`

function getServiceCreds() {
  return {
    url: (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, ''),
    key: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  }
}

async function fetchBusinessContext(userId: string): Promise<string> {
  const { url, key } = getServiceCreds()
  const H = { apikey: key, Authorization: `Bearer ${key}` }
  const lines: string[] = []

  // 1. Profile + vertical
  try {
    const r = await fetch(`${url}/rest/v1/profiles?id=eq.${userId}&select=full_name,organization,position,vertical`, { headers: H, cache: 'no-store' })
    if (r.ok) {
      const rows = await r.json() as Array<{ full_name?: string; organization?: string; position?: string; vertical?: string }>
      const p = rows[0]
      if (p) lines.push(`# Профиль\nОрганизация: ${p.organization ?? '—'}\nВертикаль: ${p.vertical ?? 'generic'}\nКонтакт: ${p.full_name ?? '—'}, ${p.position ?? '—'}`)
    }
  } catch { /* noop */ }

  // 2. Latest diagnostics + block scores
  try {
    const r = await fetch(`${url}/rest/v1/diagnostics?user_id=eq.${userId}&order=calculated_at.desc&limit=1`, { headers: H, cache: 'no-store' })
    if (r.ok) {
      const rows = await r.json() as Array<Record<string, unknown>>
      const d = rows[0]
      if (d) {
        lines.push(`\n# Текущая диагностика`)
        lines.push(`Overall score: ${d.overall_score ?? '—'} / 100`)
        lines.push(`Health index: ${d.health_index ?? '—'} / 100`)
        lines.push(`Stage: ${d.stage ?? '—'}`)
        const blocks = (d.block_scores as Record<string, { score?: number; max?: number; status?: string; top_issues?: string[] }>) ?? {}
        for (const [bid, b] of Object.entries(blocks)) {
          lines.push(`- ${bid}: ${b.score ?? '—'}/${b.max ?? 100} (${b.status ?? '—'})${b.top_issues?.length ? ' · issues: ' + b.top_issues.slice(0, 3).join('; ') : ''}`)
        }
      }
    }
  } catch { /* noop */ }

  // 3. RFM totals (medical clinics)
  try {
    const r = await fetch(`${url}/rest/v1/patient_segments?client_id=eq.${userId}&select=segment,monetary_kzt,recency_days&limit=10000`, { headers: { ...H, 'Range-Unit': 'items', Range: '0-9999' }, cache: 'no-store' })
    if (r.ok) {
      const rows = await r.json() as Array<{ segment: string; monetary_kzt: number; recency_days: number }>
      if (rows.length > 0) {
        const total = rows.length
        const totalLtv = rows.reduce((s, r) => s + (r.monetary_kzt ?? 0), 0)
        const active90 = rows.filter((r) => r.recency_days <= 90).length
        const sleeping = rows.filter((r) => r.recency_days > 180 && r.recency_days < 99999).length
        const bySegment = new Map<string, number>()
        for (const r of rows) bySegment.set(r.segment, (bySegment.get(r.segment) ?? 0) + 1)
        lines.push(`\n# База клиентов (RFM)`)
        lines.push(`Всего: ${total}, активные 90д: ${active90}, спящие 180+: ${sleeping}`)
        lines.push(`LTV сумма: ${(totalLtv / 1_000_000).toFixed(1)}M KZT`)
        lines.push(`Сегменты: ${Array.from(bySegment.entries()).map(([s, c]) => `${s}=${c}`).join(', ')}`)
      }
    }
  } catch { /* noop */ }

  // 4. Revenue losses
  try {
    const r = await fetch(`${url}/rest/v1/revenue_losses?client_id=eq.${userId}&order=estimated_loss_kzt.desc`, { headers: H, cache: 'no-store' })
    if (r.ok) {
      const rows = await r.json() as Array<{ loss_key: string; estimated_loss_kzt: number; severity: string; source_data: string }>
      if (rows.length > 0) {
        lines.push(`\n# Карта потерь выручки`)
        for (const l of rows.slice(0, 10)) {
          lines.push(`- ${l.loss_key} (${l.severity}): ${Math.round(l.estimated_loss_kzt / 1000)}K KZT/мес · ${l.source_data}`)
        }
      }
    }
  } catch { /* noop */ }

  // 5. Growth bundles
  try {
    const r = await fetch(`${url}/rest/v1/growth_bundles?client_id=eq.${userId}&order=priority.asc&limit=5`, { headers: H, cache: 'no-store' })
    if (r.ok) {
      const rows = await r.json() as Array<{ bundle_key: string; estimated_revenue_kzt: number; complexity: string }>
      if (rows.length > 0) {
        lines.push(`\n# Связки роста (топ-5)`)
        for (const b of rows) {
          lines.push(`- ${b.bundle_key} (${b.complexity}): +${Math.round(b.estimated_revenue_kzt / 1000)}K KZT/мес`)
        }
      }
    }
  } catch { /* noop */ }

  // 6. Recent financial extractions
  try {
    const r = await fetch(`${url}/rest/v1/ai_extractions?user_id=eq.${userId}&order=created_at.desc&limit=20`, { headers: H, cache: 'no-store' })
    if (r.ok) {
      const rows = await r.json() as Array<{ entity_type: string; data: unknown }>
      if (rows.length > 0) {
        lines.push(`\n# AI-извлечения из файлов (последние 20)`)
        const byType = new Map<string, number>()
        for (const e of rows) byType.set(e.entity_type, (byType.get(e.entity_type) ?? 0) + 1)
        lines.push(Array.from(byType.entries()).map(([t, c]) => `${t}: ${c}`).join(', '))
      }
    }
  } catch { /* noop */ }

  // 7. Survey answers
  try {
    const r = await fetch(`${url}/rest/v1/survey_answers?user_id=eq.${userId}&select=question_key,answer&limit=200`, { headers: H, cache: 'no-store' })
    if (r.ok) {
      const rows = await r.json() as Array<{ question_key: string; answer: { value?: string } | null }>
      if (rows.length > 0) {
        const filled = rows.filter((r) => (r.answer?.value ?? '').toString().trim().length > 0)
        lines.push(`\n# Анкета (заполнено ${filled.length}/${rows.length})`)
        for (const r of filled.slice(0, 15)) {
          const v = (r.answer?.value ?? '').toString().slice(0, 100)
          lines.push(`- ${r.question_key}: ${v}`)
        }
      }
    }
  } catch { /* noop */ }

  return lines.join('\n') || '# Нет данных. Юзер только зарегистрировался.'
}

class InsufficientDataError extends Error {
  code = 'insufficient_data' as const
  constructor(public missingSections: string[]) {
    super(`Недостаточно данных для генерации стратегии. Нужно: ${missingSections.join(', ')}`)
  }
}

async function generateStrategy(userId: string): Promise<GriStrategy> {
  const context = await fetchBusinessContext(userId)

  // Don't burn $0.10 of Opus on an empty profile — short-circuit with a
  // structured error the UI can render with an actionable CTA.
  const isEmpty = context.startsWith('# Нет данных') || context.length < 200
  if (isEmpty) {
    throw new InsufficientDataError(['анкета', 'хотя бы один загруженный файл'])
  }

  const result = await extractWithCache({
    model: CLAUDE_MODELS.opus,
    schema: STRATEGY_SCHEMA,
    schemaName: 'gri_strategy',
    system: SYSTEM_PROMPT,
    user: `# Контекст бизнеса пользователя\n\n${context}\n\nСоставь топ-5 ограничений роста и план действий 30/60/90 дней.`,
    // Opus easily writes 5000-6000 output tokens for full strategy.
    // 4000 was cutting it off mid-JSON → schema parse failed with all
    // fields undefined.
    maxTokens: 8000,
    temperature: 0.4,
  })

  return result.data
}

async function persistStrategy(userId: string, strategy: GriStrategy) {
  const { url, key } = getServiceCreds()
  // Merge into existing profiles.branding JSONB
  try {
    const getRes = await fetch(`${url}/rest/v1/profiles?id=eq.${userId}&select=branding`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: 'no-store',
    })
    const rows = await getRes.json() as Array<{ branding: Record<string, unknown> | null }>
    const current = rows[0]?.branding ?? {}
    const next = { ...current, gri_strategy: { ...strategy, generated_at: new Date().toISOString() } }

    await fetch(`${url}/rest/v1/profiles?id=eq.${userId}`, {
      method: 'PATCH',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ branding: next }),
    })
  } catch (e) {
    console.error('[gri-strategy] persist failed', e)
  }
}

export async function GET() {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const { url, key } = getServiceCreds()
  try {
    const r = await fetch(`${url}/rest/v1/profiles?id=eq.${user.id}&select=branding`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: 'no-store',
    })
    if (!r.ok) return NextResponse.json({ ok: true, strategy: null })
    const rows = await r.json() as Array<{ branding: Record<string, unknown> | null }>
    const branding = rows[0]?.branding ?? {}
    const strategy = (branding.gri_strategy as (GriStrategy & { generated_at?: string }) | undefined) ?? null
    return NextResponse.json({ ok: true, strategy })
  } catch (e) {
    console.error('[gri-strategy GET]', e)
    return NextResponse.json({ ok: true, strategy: null })
  }
}

export async function POST() {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  try {
    const strategy = await generateStrategy(user.id)
    await persistStrategy(user.id, strategy)
    return NextResponse.json({ ok: true, strategy })
  } catch (e) {
    if (e instanceof InsufficientDataError) {
      return NextResponse.json(
        {
          ok: false,
          code: e.code,
          error: e.message,
          missing: e.missingSections,
          hint: 'Загрузите файлы через /client/intake или пройдите анкету — потом нажмите «Пересчитать».',
        },
        { status: 422 }
      )
    }
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[gri-strategy POST]', msg)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
