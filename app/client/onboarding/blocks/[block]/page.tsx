'use client'

import { BlockScreen } from '@/components/onboarding/blocks/BlockScreens'

/** One deepening block (spec 2026-10-23 §7.4): /client/onboarding/blocks/b1 … b15. */
export default function SurveyBlockPage({ params }: { params: { block: string } }) {
  return <BlockScreen key={params.block} id={params.block} />
}
