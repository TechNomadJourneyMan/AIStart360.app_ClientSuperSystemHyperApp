export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { decideSuggestion } from '@/lib/documents/suggestion-decision-route'

/** POST /api/v1/onboarding/suggestions/[id]/reject — hide a document suggestion. */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  return decideSuggestion(params.id, 'reject')
}
