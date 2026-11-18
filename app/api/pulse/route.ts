import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { hasOpenRouterKey } from '@/lib/ai/openrouter'
import { fenceUntrusted } from '@/lib/ai/gateway'
import { getDailyBriefing, UNCACHED_BRIEFING_DEPS } from '@/lib/pulse/briefing'
import { resolveFeature } from '@/lib/access/decision'
import { loadSnapshotsByDiagnostic, officialPointA, type OfficialState } from '@/lib/point-a/official'

export const dynamic = 'force-dynamic'

// Platform clients only. The CRM-deal branch (Bitrix24/amoCRM through the Prisma `CrmIntegration`,
// dead since its integration lookup was cut to `null`) is archived in
// archive/legacy-prisma-crm/app/api/pulse/route.with-crm-branch.ts (2026-11-18). The owner CRM
// is /api/v1/crm/*.

/** Why a platform client has no score (the official Point A state) — said instead of a number. */
const NO_SCORE_COMMENT: Record<OfficialState, string> = {
  none: 'Анкета не заполнена',
  preliminary: 'Нет оценки: анкета не завершена',
  no_score: 'Нет оценки: мало данных для оценки',
  // scored, but without a health index
  scored: 'Нет оценки здоровья',
}

// ─── Role / user helpers ─────────────────────────────────────────────────────

type UserRole = 'super_admin' | 'admin' | 'expert' | 'manager' | 'client'

/**
 * Resolve the caller from the Supabase session (NOT from the unsigned legacy
 * `aistart360_role` cookie, which could be forged to `admin` to read every
 * CRM deal). Returns null when there is no authenticated session → 401.
 */
async function resolveCallerContext(
  sb: ReturnType<typeof createServerClient>,
): Promise<{
  role: UserRole
  userId: string
  userEmail: string | null
} | null> {
  const {
    data: { user },
  } = await sb.auth.getUser()
  if (!user?.id) return null

  // Own-row read is RLS-safe (no cross-tenant recursion). Role comes from the DB.
  const { data: profile } = await sb
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()
  const rawRole = typeof profile?.role === 'string' ? profile.role : 'client'
  // Legacy 'owner' accounts are clients: they see only their own data (they
  // used to get every CRM deal and every platform client).
  const role = (['super_admin', 'admin', 'expert', 'manager', 'client'].includes(rawRole)
    ? rawRole
    : 'client') as UserRole

  return { role, userId: user.id, userEmail: user.email ?? null }
}

/**
 * Filter platform clients for non-admin roles.
 */
function filterPlatformClientsByRole(
  clients: Array<Record<string, unknown>>,
  role: UserRole,
  userId: string | null,
): Array<Record<string, unknown>> {
  if (['super_admin', 'admin'].includes(role)) {
    return clients
  }

  // Client role — only their own data
  if (role === 'client' && userId) {
    return clients.filter(c => c.id === userId)
  }

  // Manager / expert — show all platform clients (they manage them)
  return clients
}

export async function GET() {
  try {
    const sb = createServerClient()

    // ── 0. Resolve caller context (Supabase session required) ──
    const ctx = await resolveCallerContext(sb)
    if (!ctx) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { role, userId } = ctx

    // ── 1. Platform clients (companies + profiles + diagnostics) ──
    let platformClients: Array<Record<string, unknown>> = []

    // R2-A: a client's own row is built from their Point A (health, block
    // scores) — a paid section; without it the row is not built at all.
    const ownPointAOpen = role !== 'client' || !userId
      || (await resolveFeature(sb, userId, 'point_a', { exemptStaff: true })).allowed
    // A failed read is an error (500), never «no clients» or «no survey» for everyone.
    const { data: companies, error: companiesErr } = ownPointAOpen
      ? await sb.from('companies').select('user_id, name, industry, employee_count')
      : { data: null, error: null }
    if (companiesErr) throw new Error(`companies: ${companiesErr.message}`)

    if (companies?.length) {
      const companyUserIds = companies.map(c => c.user_id)
      const companyMap = new Map<string, { name: string; industry: string | null }>()
      for (const c of companies) {
        companyMap.set(c.user_id, { name: c.name, industry: c.industry })
      }

      const { data: profiles, error: profilesErr } = await sb
        .from('profiles')
        .select('id, email, full_name, organization, created_at')
        .eq('role', 'client')
        .eq('status', 'approved')
        .in('id', companyUserIds)
      if (profilesErr) throw new Error(`profiles: ${profilesErr.message}`)

      if (profiles?.length) {
        // The current Point A of each client with its OFFICIAL numbers (lib/point-a/official.ts, the
        // reader of every other screen): the health only when the state is «scored» — not before the
        // full questionnaire, not when v4 found too little data, not for a row written under older
        // rules. (diagnostics.health_index alone can hold a number in each of those cases.)
        const { data: diagnostics, error: diagnosticsErr } = await sb
          .from('diagnostics')
          // diagnostics has no created_at: it is calculated_at.
          .select('id, user_id, overall_score, health_index, stage, calculated_at')
          // Only the current Point A of each client: every recalculation keeps the old row (not
          // current), and the history would fill PostgREST's row cap before every client's current row.
          .eq('is_current', true)
          .order('calculated_at', { ascending: false })
        if (diagnosticsErr) throw new Error(`diagnostics: ${diagnosticsErr.message}`)
        // strict: a failed snapshot read is an error — without the snapshot the raw row would pass as
        // official, numbers the official reader drops included.
        const snaps = await loadSnapshotsByDiagnostic(sb, (diagnostics ?? []).map(d => String(d.id)), { strict: true })

        const diagMap = new Map<string, { state: OfficialState; health: number | null; calculatedAt: string }>()
        for (const d of diagnostics ?? []) {
          if (!diagMap.has(d.user_id)) {
            const o = officialPointA(d as Record<string, unknown>, snaps.get(String(d.id)) ?? null)
            // Whole points (health_index is numeric(5,2)), so the risk, its level and the action all
            // come from the same number.
            const health = o.state === 'scored' && typeof o.health_index === 'number' && Number.isFinite(o.health_index)
              ? Math.round(o.health_index) : null
            diagMap.set(d.user_id, { state: o.state, health, calculatedAt: d.calculated_at })
          }
        }

        for (const p of profiles) {
          const comp = companyMap.get(p.id)
          const diag = diagMap.get(p.id)
          // null until scored. It used to fall back to 50 — a made-up «medium risk» for every client
          // without a score.
          const health = diag?.health ?? null
          // No score → no risk at all (null), not a stand-in number.
          const riskScore = health === null ? null : Math.max(0, 100 - health)
          const daysSince = diag ? Math.floor((Date.now() - new Date(diag.calculatedAt).getTime()) / 86400000) : null

          platformClients.push({
            id: p.id,
            name: comp?.name ?? p.organization ?? p.full_name ?? p.email,
            sector: comp?.industry ?? 'Не указана',
            forbes: null,
            lastOrder: diag ? new Date(diag.calculatedAt).toLocaleDateString('ru-RU', { month: 'short', day: 'numeric' }) : null,
            daysSince,
            // The platform has no orders of its clients: no check, no volume change, no order cycle.
            // (These were finance score × 10 000 ₸, sales score − 50 and 30 days — numbers shown as money.)
            avgCheck: null,
            volumeChange: null,
            riskScore,
            // Churn probability is derived deterministically from the risk score.
            // No random jitter — we never present noise as data.
            churnProb: riskScore,
            churnLevel: health === null ? null : health < 40 ? 'high' : health < 60 ? 'medium' : 'low',
            comment: health === null
              ? NO_SCORE_COMMENT[diag?.state ?? 'none']
              : health < 40 ? 'Требует внимания' : null,
            // Without a score the thing to do is ask the client for the answers or data it lacks
            // (nothing to ask when it is scored, only without a health index).
            action: health === null
              ? (diag?.state === 'scored' ? 'monitor' : 'message')
              : health < 50 ? 'call' : health < 70 ? 'message' : 'monitor',
            orderCycle: null,
            // Only real points: there is no per-client health history, so the current value alone.
            history: health === null ? [] : [health],
          })
        }
      }
    }

    // ── Role-based filtering for platform clients ──
    platformClients = filterPlatformClientsByRole(platformClients, role, userId)

    // ── 2. Riskiest first; clients without a score (riskScore null) after every scored one ──
    const riskOf = (c: Record<string, unknown>): number | null =>
      typeof c.riskScore === 'number' ? c.riskScore : null
    const checkOf = (c: Record<string, unknown>): number | null =>
      typeof c.avgCheck === 'number' && Number.isFinite(c.avgCheck) ? c.avgCheck : null
    const todayClients = [...platformClients]
      .sort((a, b) => (riskOf(b) ?? -1) - (riskOf(a) ?? -1))
    const scoredClients = todayClients.filter(c => riskOf(c) !== null)

    // Stats reflect the filtered dataset (not global)
    const highRisk = todayClients.filter(c => c.churnLevel === 'high')
    const mediumRisk = todayClients.filter(c => c.churnLevel === 'medium')
    // Money at risk only when it is known: every client has a risk (a client without a score may be
    // high-risk) and every high-risk client has a check. A partial sum, or 0 for checks nobody knows,
    // would understate it. null = unknown.
    const revenueAtRisk = scoredClients.length === todayClients.length && highRisk.every(c => checkOf(c) !== null)
      ? highRisk.reduce((sum, c) => sum + (checkOf(c) ?? 0), 0)
      : null

    const stats = {
      revenueAtRisk,
      highRisk: highRisk.length,
      mediumRisk: mediumRisk.length,
      noScore: todayClients.length - scoredClients.length,
      totalClients: todayClients.length,
      processedToday: todayClients.filter(c => c.action !== 'monitor').length,
      dailyTarget: 6,
    }

    // ── 3. AI briefing (shared OpenRouter client, validated, the user's daily AI budget —
    // lib/pulse/briefing.ts), without the daily cache and with its own 10 generations/hour
    // (UNCACHED_BRIEFING_DEPS: the cache and the hourly limit of the «Пульс» page stay its own) ──
    // Only over scored clients: ranking by a risk nobody has would make it up.
    let aiBriefing: string | null = null
    if (hasOpenRouterKey() && scoredClients.length > 0) {
      const money = (n: number | null) => (n === null ? 'нет данных' : `${n.toLocaleString('ru')} ₸`)
      const top5 = scoredClients
        .slice(0, 5)
        .map((c, i) => {
          const check = checkOf(c)
          return `${i + 1}. "${c.name}" — риск ${c.riskScore}/100${check === null ? '' : `, ${money(check)}`}, ${c.sector}, ${c.comment || 'без комментария'}`
        })
        .join('\n')

      // Same rule as the money at risk: a total only when every check is known.
      const totalRevenue = todayClients.every(c => checkOf(c) !== null)
        ? todayClients.reduce((s, c) => s + (checkOf(c) ?? 0), 0)
        : null

      const prompt = `Ты AI-ассистент продаж в системе AIStart360. Дай краткий утренний брифинг для менеджера на русском языке (3-4 предложения).

Данные портфеля на сегодня:
- Всего сделок: ${todayClients.length}
- Общая сумма: ${money(totalRevenue)}
- Высокий риск: ${highRisk.length}
- Средний риск: ${mediumRisk.length}
- Без оценки (риск неизвестен): ${stats.noScore}
- Выручка под угрозой: ${money(revenueAtRisk)}

ТОП-5 приоритетных сделок:
${fenceUntrusted('crm_deals', top5)}

Скажи: с кем поговорить в первую очередь и почему. Будь конкретен — назови название сделки. Опирайся только на эти данные, ничего не выдумывай. Формат: 3-4 предложения, без заголовков и списков.`

      // Not the daily cache: it is keyed by user and day only and belongs to the «Пульс» page
      // (POST /api/pulse/briefing, the CRM base) — this platform-client text would replace its
      // briefing for the rest of the day, or this route would return the CRM one.
      const briefing = await getDailyBriefing(userId, prompt, UNCACHED_BRIEFING_DEPS)
      aiBriefing = briefing.text
    }

    return NextResponse.json({ stats, todayClients, aiBriefing })
  } catch (error) {
    console.error('Pulse API Error:', error)
    // An error, not an empty portfolio: zeros here would read as «no clients, nothing at risk».
    return NextResponse.json({ error: 'Пульс временно недоступен' }, { status: 500 })
  }
}
