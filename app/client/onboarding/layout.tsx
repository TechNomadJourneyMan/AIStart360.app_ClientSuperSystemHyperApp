export const dynamic = 'force-dynamic'

import type { ReactNode } from 'react'
import { SurveyModesProvider } from '@/components/onboarding/modes/SurveyModesContext'
import { getSurveyModes } from '@/lib/survey/modes-server'

/**
 * /client/onboarding/* — the survey modes switched on in GIGA (R4-B4, R-027),
 * read once on the server and handed to the client screens (chooser, mode
 * switch, express chrome, chat, snapshot). The server pages of the modes check
 * the same setting themselves (surveyModeOffRedirect).
 */
export default async function OnboardingLayout({ children }: { children: ReactNode }) {
  const modes = await getSurveyModes()
  return <SurveyModesProvider value={modes}>{children}</SurveyModesProvider>
}
