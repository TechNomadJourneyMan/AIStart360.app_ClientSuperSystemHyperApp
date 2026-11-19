export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { isRateLimited } from '@/lib/rate-limit'
import { getDailyBriefing } from '@/lib/pulse/briefing'
import { hasOpenRouterKey } from '@/lib/ai/openrouter'
import { withDeadline } from '@/lib/runtime/deadline'
import { loadCrmToday } from '@/lib/crm/today'
import { crmBriefingPrompt } from '@/lib/crm/briefing-prompt'

/**
 * POST /api/pulse/briefing — «Рекомендация на сегодня» over the CALLER'S OWN CRM base.
 *
 * Same session auth as /api/v1/crm/* (any signed-in owner; their crm_clients only — the old
 * profiles.role gate 403'd every client, and the old Bitrix path answered «No CRM connected» to
 * everyone else). The queue comes from the shared loader (lib/crm/today.ts loadCrmToday), so the
 * briefing is about exactly the clients «Кому звонить сегодня» shows. Generation goes through
 * getDailyBriefing with its DEFAULT deps: the daily cache keyed by user + Almaty day belongs to
 * this page (GET /api/pulse uses UNCACHED_BRIEFING_DEPS and never touches it), plus the hourly
 * limit and the daily AI budget.
 *
 * Answer: { status, briefing, message?, reason?, cached? }
 *   ok          — briefing text (cached: from today's cache)
 *   empty       — nothing generated: reason no_clients (empty base) | empty_queue
 *   limited     — 429: reason rate_limit | budget
 *   unavailable — 503: no AI provider configured
 *   error       — the base could not be read / the model gave nothing
 */
type BriefingStatus = 'ok' | 'empty' | 'limited' | 'unavailable' | 'error'

function answer(status: BriefingStatus, http: number, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ status, briefing: null, ...extra }, { status: http })
}

async function handlePost(req: NextRequest) {
  try {
    const sb = createServerClient()
    const { data: userData } = await sb.auth.getUser()
    const user = userData?.user
    if (!user?.id) return answer('error', 401, { error: 'Unauthorized' })

    // Per-caller throttle of the route (the paid generation is also limited per user per hour
    // inside getDailyBriefing).
    if (await isRateLimited(req, 'pulse-briefing')) {
      return answer('limited', 429, { reason: 'rate_limit', message: 'Слишком часто. Попробуйте через минуту.' })
    }

    const loaded = await loadCrmToday(sb, user.id, Date.now())
    if (!loaded.ok) return answer('error', 500, { message: 'Не удалось прочитать базу клиентов. Попробуйте позже.' })
    const today = loaded.data

    if (today.stats.totalClients === 0) {
      return answer('empty', 200, {
        reason: 'no_clients',
        message: 'В базе пока нет клиентов — рекомендацию строить не из чего. Добавьте клиентов на вкладке «База».',
      })
    }
    const prompt = crmBriefingPrompt(today)
    if (!prompt) {
      return answer('empty', 200, {
        reason: 'empty_queue',
        message: 'Очередь на сегодня пуста: все клиенты обработаны или их контакт запланирован на другой день.',
      })
    }

    if (!hasOpenRouterKey()) {
      return answer('unavailable', 503, { message: 'AI-рекомендации сейчас недоступны.' })
    }

    const result = await getDailyBriefing(user.id, prompt)
    if (result.limited) {
      return answer('limited', 429, {
        reason: result.limitReason ?? 'rate_limit',
        message:
          result.limitReason === 'budget'
            ? 'Дневной AI-бюджет исчерпан — новая рекомендация будет доступна завтра.'
            : 'Лимит генераций исчерпан (10 в час). Попробуйте позже.',
      })
    }
    if (!result.text) {
      return answer('error', 502, { message: 'Не удалось получить рекомендацию от AI. Попробуйте позже.' })
    }
    return NextResponse.json({ status: 'ok', briefing: result.text, cached: result.cached, validation: result.validation })
  } catch (error) {
    console.error('[pulse/briefing] Error:', error instanceof Error ? error.message : error)
    return answer('error', 500, { message: 'Не удалось получить рекомендацию. Попробуйте позже.' })
  }
}

/**
 * R-015: on Railway `next start` ignores maxDuration, so the request had no time limit. After 60 s the client
 * gets 504 (DEADLINE_EXCEEDED) and the work below sees its deadline spent. ROUTE_DEADLINE_MS_PULSE_BRIEFING overrides it;
 * ROUTE_DEADLINE_DISABLED=1 turns it off.
 */
export const POST = withDeadline(handlePost, { label: 'pulse-briefing', ms: 60_000 })
