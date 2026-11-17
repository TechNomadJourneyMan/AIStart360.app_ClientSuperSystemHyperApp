import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import * as bitrix24 from '@/lib/crm/bitrix24'
import * as amocrm from '@/lib/crm/amocrm'
import type { CrmDeal } from '@/lib/crm/types'
import { hasOpenRouterKey } from '@/lib/ai/openrouter'
import { fenceUntrusted } from '@/lib/ai/gateway'
import { getDailyBriefing, UNCACHED_BRIEFING_DEPS } from '@/lib/pulse/briefing'
import { resolveFeature } from '@/lib/access/decision'
import { loadSnapshotsByDiagnostic, officialPointA, type OfficialState } from '@/lib/point-a/official'

export const dynamic = 'force-dynamic'

/** Why a platform client has no score (the official Point A state) — said instead of a number. */
const NO_SCORE_COMMENT: Record<OfficialState, string> = {
  none: 'Анкета не заполнена',
  preliminary: 'Нет оценки: анкета не завершена',
  no_score: 'Нет оценки: мало данных для оценки',
  // scored, but without a health index
  scored: 'Нет оценки здоровья',
}

/** Map Bitrix24 stage IDs to risk levels */
const STAGE_RISK: Record<string, { risk: number; label: string }> = {
  NEW: { risk: 30, label: 'Новая' },
  PREPARATION: { risk: 40, label: 'Подготовка' },
  PREPAYMENT_INVOICE: { risk: 25, label: 'Счёт' },
  EXECUTING: { risk: 20, label: 'В работе' },
  WON: { risk: 5, label: 'Выиграна' },
  LOSE: { risk: 90, label: 'Проиграна' },
  APOLOGY: { risk: 95, label: 'Отказ' },
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
  orgName: string | null
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

  // Best-effort org name for the manager/expert deal fallback.
  let orgName: string | null = null
  const { data: company } = await sb
    .from('companies')
    .select('name')
    .eq('user_id', user.id)
    .maybeSingle()
  if (company && typeof company.name === 'string') orgName = company.name

  return { role, userId: user.id, userEmail: user.email ?? null, orgName }
}

/**
 * Filter CRM deals based on the caller's role.
 * - super_admin / admin: see everything
 * - manager / expert: only deals assigned to them (ASSIGNED_BY_ID match)
 * - client: empty list (clients should not see CRM Pulse)
 */
function filterDealsByRole(
  deals: CrmDeal[],
  role: UserRole,
  userId: string | null,
  orgName: string | null,
): CrmDeal[] {
  // Admins see all
  if (['super_admin', 'admin'].includes(role)) {
    return deals
  }

  // Clients should not see CRM deals at all
  if (role === 'client') {
    return []
  }

  // Manager / expert — show deals assigned to them
  // We try to match by Bitrix24 ASSIGNED_BY_ID.
  // Since the cookie userId is the internal app ID (cuid) and Bitrix24 uses its own
  // numeric user IDs, we need a mapping. For now we attempt a direct match first.
  // If no deals match by assignedById, fall back to matching by company/org name
  // so the feature degrades gracefully.
  if (userId) {
    const byAssigned = deals.filter(d => d.assignedById === userId)
    if (byAssigned.length > 0) return byAssigned
  }

  // Fallback: filter by organization name match against deal company title
  if (orgName) {
    const normalizedOrg = orgName.toLowerCase().trim()
    const byOrg = deals.filter(d => {
      const dealCompany = (d.companyTitle || d.contactName || '').toLowerCase().trim()
      return dealCompany.includes(normalizedOrg) || normalizedOrg.includes(dealCompany)
    })
    if (byOrg.length > 0) return byOrg
  }

  // No match found — return empty to avoid showing unrelated data
  return []
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
    const { role, userId, orgName } = ctx

    const crmClients: Array<Record<string, unknown>> = []

    // ── 1. Fetch CRM deals from connected integrations ──
    try {
      // Фаза 4B — фикс МЕЖАРЕНДНОЙ УТЕЧКИ: было
      // prisma.crmIntegration.findFirst({ where: { isActive: true } }) БЕЗ скоупа
      // на владельца → первая подключённая CRM утекала всем. Legacy Prisma-стек
      // мёртв (requireCrmOrg=null → /api/crm 403); реальные подключения теперь в
      // crm_provider_connections (RLS own), а данные CRM — в crm_clients /
      // /api/v1/crm/*. Путь отключён: integration всегда null.
      const integration = null as {
        provider: string
        domain: string
        accessToken: string
        webhookUrl: string | null
      } | null

      if (integration) {
        const config = {
          domain: integration.domain,
          accessToken: integration.accessToken,
          webhookUrl: integration.webhookUrl ?? undefined,
        }

        let deals = integration.provider === 'bitrix24'
          ? await bitrix24.fetchDeals(config, 100)
          : await amocrm.fetchDeals(config, 100)

        // ── Role-based filtering ──
        deals = filterDealsByRole(deals, role, userId, orgName)

        // Calculate portfolio-level stats for relative metrics
        const totalDeals = deals.length
        const avgAmount = totalDeals > 0 ? deals.reduce((s, d) => s + d.amount, 0) / totalDeals : 0
        const wonDeals = deals.filter(d => d.stageSemantic === 'S' || d.stage === 'WON')
        const lostDeals = deals.filter(d => d.stageSemantic === 'F' || d.stage === 'LOSE')
        const winRate = totalDeals > 0 ? wonDeals.length / totalDeals : 0

        for (const deal of deals) {
          const stageInfo = STAGE_RISK[deal.stage] ?? { risk: 50, label: deal.stage }
          const now = Date.now()

          // ── Real: days since last activity ──
          const updatedMs = deal.updatedAt ? new Date(deal.updatedAt).getTime() : now
          const createdMs = deal.createdAt ? new Date(deal.createdAt).getTime() : now
          const daysSinceUpdate = Math.floor((now - updatedMs) / 86400000)
          const dealAgeDays = Math.floor((now - createdMs) / 86400000)

          // ── Real: risk score (multi-factor) ──
          // Factor 1: Stage base risk (0-95)
          let riskScore = stageInfo.risk
          // Factor 2: Stale deal penalty (+1 per day without activity, max +20)
          riskScore += Math.min(20, daysSinceUpdate * 1)
          // Factor 3: Long deal penalty (+0.5 per day of age, max +15)
          riskScore += Math.min(15, Math.round(dealAgeDays * 0.5))
          // Factor 4: Below-average amount = slightly higher risk
          if (deal.amount < avgAmount * 0.5 && deal.amount > 0) riskScore += 5
          // Clamp 0-100
          riskScore = Math.max(0, Math.min(100, riskScore))

          const health = 100 - riskScore
          const churnLevel = health < 40 ? 'high' as const : health < 60 ? 'medium' as const : 'low' as const

          // ── Real: volume change (deal amount vs portfolio average) ──
          const volumeChange = avgAmount > 0
            ? Math.round(((deal.amount - avgAmount) / avgAmount) * 100)
            : 0

          // ── Real: churn probability (based on risk + stage semantic) ──
          let churnProb = riskScore
          if (deal.stageSemantic === 'F') churnProb = 95
          else if (deal.stageSemantic === 'S') churnProb = 2
          else if (daysSinceUpdate > 7) churnProb = Math.min(90, churnProb + 10)
          churnProb = Math.max(0, Math.min(100, churnProb))

          // ── Real: sparkline from deal lifecycle ──
          // Show deal health trajectory: creation → stages → current
          const lifespanDays = Math.max(1, dealAgeDays)
          const progressPct = deal.stageSemantic === 'S' ? 100
            : deal.stageSemantic === 'F' ? 10
            : Math.min(90, Math.round((1 - stageInfo.risk / 100) * 90))
          const history = [
            20, // start: deal created
            Math.round(progressPct * 0.3),
            Math.round(progressPct * 0.6),
            Math.round(progressPct * 0.85),
            progressPct, // current state
          ]

          // ── Real: contextual comment ──
          let comment: string | null = null
          if (deal.stageSemantic === 'S') comment = 'Сделка успешно закрыта'
          else if (deal.stageSemantic === 'F') comment = 'Сделка потеряна'
          else if (daysSinceUpdate > 14) comment = `Нет активности ${daysSinceUpdate} дней`
          else if (daysSinceUpdate > 7) comment = 'Требует внимания — давно без движения'
          else if (deal.amount > avgAmount * 2) comment = 'Крупная сделка — приоритет'
          else if (dealAgeDays > 30 && deal.stageSemantic === 'P') comment = 'Долгий цикл — ускорить'

          // ── Real: action based on multiple factors ──
          let action: 'call' | 'message' | 'monitor' = 'monitor'
          if (deal.stageSemantic === 'F') action = 'call' // try to win back
          else if (daysSinceUpdate > 7) action = 'call'   // re-engage
          else if (riskScore > 60) action = 'call'
          else if (riskScore > 35) action = 'message'

          crmClients.push({
            id: `crm-${deal.id}`,
            name: deal.title,
            sector: stageInfo.label,
            forbes: null,
            lastOrder: deal.updatedAt
              ? new Date(deal.updatedAt).toLocaleDateString('ru-RU', { month: 'short', day: 'numeric' })
              : null,
            daysSince: daysSinceUpdate,
            avgCheck: deal.amount || 0,
            volumeChange,
            riskScore,
            churnProb,
            churnLevel,
            comment,
            action,
            orderCycle: Math.max(1, dealAgeDays),
            history,
          })
        }
      }
    } catch (crmErr) {
      console.error('[pulse] CRM fetch error (non-fatal):', crmErr)
    }

    // ── 2. Fetch platform clients (companies + profiles + diagnostics) ──
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

    // ── 3. Merge, riskiest first; clients without a score (riskScore null) after every scored one ──
    const riskOf = (c: Record<string, unknown>): number | null =>
      typeof c.riskScore === 'number' ? c.riskScore : null
    const checkOf = (c: Record<string, unknown>): number | null =>
      typeof c.avgCheck === 'number' && Number.isFinite(c.avgCheck) ? c.avgCheck : null
    const todayClients = [...crmClients, ...platformClients]
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

    // ── 4. AI briefing (shared OpenRouter client, validated, the user's daily AI budget —
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
