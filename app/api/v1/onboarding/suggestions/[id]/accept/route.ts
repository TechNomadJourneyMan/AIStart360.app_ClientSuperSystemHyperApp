export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { decideSuggestion } from '@/lib/documents/suggestion-decision-route'

/**
 * POST /api/v1/onboarding/suggestions/[id]/accept → { ok, data: { question_key, value } }
 *
 * Marks the suggestion accepted and returns the value; the wizard then writes it
 * through its normal save path (POST /api/v1/onboarding/survey — history,
 * impersonation audit and company sync included). 409 when the question
 * already has an answer: a typed answer is never overwritten.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  return decideSuggestion(params.id, 'accept')
}
