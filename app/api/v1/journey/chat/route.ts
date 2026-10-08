import { NextResponse } from 'next/server'
import {
  identityFromRequest,
  journeyErrorResponse,
  resolveJourneyActor,
  withJourneyRequestIdentity,
} from '@/lib/journey/http'
import { orchestrateJourneyTurn } from '@/lib/journey/orchestrator'
import { enforceJourneyStatePolicy } from '@/lib/journey/policy'
import { isRateLimited, isRateLimitedKey } from '@/lib/rate-limit'
import {
  appendJourneyMessages,
  loadJourneyState,
  saveJourneyState,
} from '@/lib/journey/persistence'
import { journeyChatRequestSchema } from '@/lib/journey/schema'
import { AI_BUDGET_MESSAGE, assertAiBudget, isAiBudgetError } from '@/lib/ai/budget'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request: Request) {
  try {
    const actorUserId = await resolveJourneyActor()
    const payload = journeyChatRequestSchema.parse(
      withJourneyRequestIdentity(request, await request.json()),
    )
    const identity = identityFromRequest(request, payload)
    if (
      await isRateLimited(request, 'journey-chat-ip', { max: 30, windowMs: 60 * 60_000 }) ||
      await isRateLimitedKey(identity.workspaceId, 'journey-chat', { max: 12, windowMs: 60_000 })
    ) {
      return NextResponse.json(
        { error: { code: 'JOURNEY_RATE_LIMIT', message: 'Слишком много сообщений. Попробуйте через минуту.' } },
        { status: 429 },
      )
    }
    try {
      await assertAiBudget({ userId: actorUserId ?? null, actorId: `journey:${identity.workspaceId}` }, 'journey')
    } catch (budgetErr) {
      if (isAiBudgetError(budgetErr)) {
        return NextResponse.json(
          { error: { code: 'AI_BUDGET_EXCEEDED', message: AI_BUDGET_MESSAGE } },
          { status: 429 },
        )
      }
    }
    await loadJourneyState(identity, actorUserId)
    const state = payload.state
    const previousMessageIds = new Set(state.messages.map((message) => message.id))
    const result = await orchestrateJourneyTurn(state, payload.message)
    const saved = await saveJourneyState(identity, enforceJourneyStatePolicy(result.state), actorUserId)
    const newMessages = saved.state.messages.filter((message) => !previousMessageIds.has(message.id))
    await appendJourneyMessages(identity, newMessages, saved.state.provider.mode)

    return NextResponse.json({
      state: saved.state,
      provider: saved.state.provider,
      persistence: saved.persistence,
      orchestration: { mode: result.mode, fallbackReason: result.fallbackReason },
    })
  } catch (error) {
    return journeyErrorResponse(error)
  }
}
