import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createJourneyConnectCode, JourneyConnectCodeError } from '@/lib/journey/device-sync'
import {
  identityFromRequest,
  journeyErrorResponse,
  resolveJourneyActor,
  withJourneyRequestIdentity,
} from '@/lib/journey/http'
import { isRateLimited, isRateLimitedKey } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bodySchema = z
  .object({
    workspaceId: z.string().min(8).max(120).optional(),
    accessToken: z.string().min(24).max(240).optional(),
  })
  .strict()

export async function POST(request: Request) {
  try {
    if (await isRateLimited(request, 'journey-connect-code-ip', { max: 6, windowMs: 10 * 60_000 })) {
      return rateLimitResponse('Слишком много кодов подключения. Попробуйте позже.')
    }
    const actorUserId = await resolveJourneyActor()
    const raw = await request.json().catch(() => ({}))
    const payload = bodySchema.parse(withJourneyRequestIdentity(request, raw))
    const identity = payload.workspaceId && payload.accessToken
      ? identityFromRequest(request, payload)
      : undefined
    const rateKey = actorUserId ?? identity?.workspaceId
    if (
      rateKey &&
      await isRateLimitedKey(rateKey, 'journey-connect-code-source', { max: 3, windowMs: 10 * 60_000 })
    ) {
      return rateLimitResponse('Новый код можно выпустить через несколько минут.')
    }
    const result = await createJourneyConnectCode({ identity, actorUserId })
    const response = NextResponse.json({
      data: { code: result.code, expiresAt: result.expiresAt, workspaceId: result.workspaceId },
    })
    response.headers.set('cache-control', 'no-store')
    return response
  } catch (error) {
    if (error instanceof JourneyConnectCodeError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: 400 },
      )
    }
    return journeyErrorResponse(error)
  }
}

function rateLimitResponse(message: string): NextResponse {
  return NextResponse.json(
    { error: { code: 'JOURNEY_RATE_LIMIT', message } },
    { status: 429 },
  )
}
