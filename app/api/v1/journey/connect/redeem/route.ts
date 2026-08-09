import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  journeyConnectCodeSchema,
  hashJourneyConnectCode,
  JourneyConnectCodeError,
  redeemJourneyConnectCode,
} from '@/lib/journey/device-sync'
import {
  JOURNEY_DEVICE_COOKIE,
  JOURNEY_DEVICE_COOKIE_MAX_AGE_SECONDS,
  journeyErrorResponse,
  resolveJourneyActor,
} from '@/lib/journey/http'
import { isRateLimited, isRateLimitedKey } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bodySchema = z
  .object({
    code: z.string().trim().min(8).max(16),
    deviceLabel: z.string().trim().min(1).max(80).optional(),
  })
  .strict()

export async function POST(request: Request) {
  try {
    if (await isRateLimited(request, 'journey-connect-redeem-ip', { max: 10, windowMs: 10 * 60_000 })) {
      return rateLimitResponse()
    }
    const actorUserId = await resolveJourneyActor()
    const payload = bodySchema.parse(await request.json())
    const normalizedCode = journeyConnectCodeSchema.parse(payload.code)
    if (
      await isRateLimitedKey(
        // This bucket limits repeated use of the same guess. Distinct guesses
        // are bounded by the IP limiter above; the keyed digest prevents an
        // offline database snapshot from being used as a code oracle.
        hashJourneyConnectCode(normalizedCode),
        'journey-connect-redeem-code',
        { max: 5, windowMs: 10 * 60_000 },
      )
    ) {
      return rateLimitResponse()
    }
    const result = await redeemJourneyConnectCode({
      code: normalizedCode,
      deviceLabel: payload.deviceLabel,
      actorUserId,
    })
    const response = NextResponse.json({
      data: { workspaceId: result.workspaceId, state: result.state },
    })
    response.cookies.set(JOURNEY_DEVICE_COOKIE, result.deviceToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/api/v1/journey',
      maxAge: JOURNEY_DEVICE_COOKIE_MAX_AGE_SECONDS,
    })
    response.headers.set('cache-control', 'no-store')
    return response
  } catch (error) {
    if (error instanceof JourneyConnectCodeError) {
      const status = error.code === 'JOURNEY_CONNECT_CODE_LOCKED'
        ? 423
        : error.code === 'JOURNEY_CONNECT_CODE_EXPIRED' || error.code === 'JOURNEY_CONNECT_CODE_CONSUMED'
          ? 410
          : 400
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status },
      )
    }
    return journeyErrorResponse(error)
  }
}

function rateLimitResponse(): NextResponse {
  return NextResponse.json(
    { error: { code: 'JOURNEY_RATE_LIMIT', message: 'Слишком много попыток подключения. Попробуйте позже.' } },
    { status: 429 },
  )
}
