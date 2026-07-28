export const ONBOARDING_STORAGE_VERSION = 2
export const ONBOARDING_STORAGE_PREFIX = 'aistart360_onboarding'

export function onboardingDraftStorageKey(userId?: string | null): string {
  return userId ? `${ONBOARDING_STORAGE_PREFIX}:${userId}` : ONBOARDING_STORAGE_PREFIX
}

export interface OnboardingDraft {
  version?: number
  current_step?: number
  answers?: Record<string, unknown>
  company_id?: string | null
  saved_at?: string
}

export type OnboardingDraftSource = 'local' | 'server' | 'none'

export interface OnboardingAnswerResolution {
  answers: Record<string, unknown>
  source: OnboardingDraftSource
  conflict: boolean
}

function timestamp(value: string | undefined): number {
  if (!value) return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function answersDiffer(
  local: Record<string, unknown>,
  server: Record<string, unknown>,
): boolean {
  const keys = new Set([...Object.keys(local), ...Object.keys(server)])
  return [...keys].some((key) =>
    JSON.stringify(local[key]) !== JSON.stringify(server[key]),
  )
}

export function resolveOnboardingAnswers(
  localDraft: OnboardingDraft,
  serverAnswers: Record<string, unknown>,
  serverSavedAt?: string,
): OnboardingAnswerResolution {
  const localAnswers = localDraft.answers ?? {}
  const hasLocal = Object.keys(localAnswers).length > 0
  const hasServer = Object.keys(serverAnswers).length > 0

  if (!hasLocal && !hasServer) {
    return { answers: {}, source: 'none', conflict: false }
  }
  if (!hasLocal) {
    return { answers: serverAnswers, source: 'server', conflict: false }
  }
  if (!hasServer) {
    return { answers: localAnswers, source: 'local', conflict: false }
  }

  const conflict = answersDiffer(localAnswers, serverAnswers)
  const localSavedAt = timestamp(localDraft.saved_at)
  const serverTimestamp = timestamp(serverSavedAt)
  const localIsNewer = localSavedAt > serverTimestamp

  return localIsNewer
    ? {
        answers: { ...serverAnswers, ...localAnswers },
        source: 'local',
        conflict,
      }
    : {
        answers: serverAnswers,
        source: 'server',
        conflict,
      }
}

export function normalizeOnboardingStep(value: unknown, fallback = 1): number {
  const step = Number(value)
  return Number.isInteger(step) && step >= 1 && step <= 6 ? step : fallback
}

export function resolveOnboardingResumeStep(
  localDraft: OnboardingDraft,
  serverStep: number,
): number {
  const normalizedServerStep = normalizeOnboardingStep(serverStep, 1)
  const localStep = normalizeOnboardingStep(localDraft.current_step, normalizedServerStep)

  return localDraft.version === ONBOARDING_STORAGE_VERSION
    ? localStep
    : Math.max(localStep, normalizedServerStep)
}
