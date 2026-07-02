import { NextResponse } from 'next/server'
import { isRateLimited } from '@/lib/rate-limit'

// Per-route budgets (requests per minute) for the assistant surface — ТЗ
// §16.1. ask/analyze burn OpenRouter tokens and escalate creates expert_cases,
// so they get the tight budget; chat is grouped with them by the ТЗ even
// though hydrate() is deterministic. The light read/validate routes get 30.
export const ASSISTANT_RATE_LIMITS = {
  'assistant-ask': 10,
  'assistant-chat': 10,
  'assistant-analyze': 10,
  'assistant-escalate': 10,
  'assistant-scripts': 30,
  'assistant-status': 30,
  'assistant-validate': 30,
} as const

export type AssistantRateBucket = keyof typeof ASSISTANT_RATE_LIMITS

/**
 * Throttle an assistant route for the CURRENT user. The budget is keyed by the
 * Supabase userId so it follows the account across IPs; isRateLimited falls
 * back to the client IP when the key is empty. Returns the ready 429 response
 * when the budget is exhausted, null when the request may proceed.
 */
export async function assistantRateLimit(
  req: Request,
  bucket: AssistantRateBucket,
  userId: string,
): Promise<NextResponse | null> {
  const limited = await isRateLimited(req, bucket, {
    max: ASSISTANT_RATE_LIMITS[bucket],
    key: userId,
  })
  if (!limited) return null
  return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429 })
}
