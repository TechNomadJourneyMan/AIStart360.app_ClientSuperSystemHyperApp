'use client'

import { createContext, useContext, type ReactNode } from 'react'
import { DEFAULT_SURVEY_MODES_CONFIG, type SurveyModesConfig } from '@/lib/survey/modes'

/**
 * The survey modes of the platform for the client screens (R4-B4, R-027): the
 * server reads the GIGA settings (lib/survey/modes-server.ts) in
 * app/client/onboarding/layout.tsx and passes the result down — the screens no
 * longer read a build flag at module load. Without a provider (dev previews,
 * render tests) — the registry defaults.
 */
const SurveyModesCtx = createContext<SurveyModesConfig>(DEFAULT_SURVEY_MODES_CONFIG)

export function SurveyModesProvider({ value, children }: { value: SurveyModesConfig; children: ReactNode }) {
  return <SurveyModesCtx.Provider value={value}>{children}</SurveyModesCtx.Provider>
}

export function useSurveyModes(): SurveyModesConfig {
  return useContext(SurveyModesCtx)
}
