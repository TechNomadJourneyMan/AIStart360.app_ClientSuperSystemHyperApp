import { describe, expect, it } from 'vitest'
import {
  ONBOARDING_STORAGE_VERSION,
  normalizeOnboardingStep,
  onboardingDraftStorageKey,
  resolveOnboardingAnswers,
  resolveOnboardingResumeStep,
} from '@/lib/onboarding-draft'

describe('onboarding draft recovery', () => {
  it('isolates drafts by user while keeping the legacy key addressable', () => {
    expect(onboardingDraftStorageKey('user-1')).toBe('aistart360_onboarding:user-1')
    expect(onboardingDraftStorageKey()).toBe('aistart360_onboarding')
  })

  it('restores the exact active step for a current local draft', () => {
    expect(resolveOnboardingResumeStep({
      version: ONBOARDING_STORAGE_VERSION,
      current_step: 2,
    }, 5)).toBe(2)
  })

  it('moves legacy drafts forward to the latest confirmed server step', () => {
    expect(resolveOnboardingResumeStep({ current_step: 2 }, 4)).toBe(4)
  })

  it('rejects invalid steps and uses a safe fallback', () => {
    expect(normalizeOnboardingStep(7, 3)).toBe(3)
    expect(normalizeOnboardingStep('not-a-step', 1)).toBe(1)
  })

  it('does not let an older local draft overwrite newer server answers', () => {
    expect(resolveOnboardingAnswers({
      answers: { company: 'Старое название' },
      saved_at: '2026-07-28T09:00:00.000Z',
    }, {
      company: 'Новое название',
    }, '2026-07-28T10:00:00.000Z')).toEqual({
      answers: { company: 'Новое название' },
      source: 'server',
      conflict: true,
    })
  })

  it('restores a newer offline draft without discarding server-only fields', () => {
    expect(resolveOnboardingAnswers({
      answers: { revenue: 250 },
      saved_at: '2026-07-28T11:00:00.000Z',
    }, {
      company: 'Acme',
      revenue: 100,
    }, '2026-07-28T10:00:00.000Z')).toEqual({
      answers: { company: 'Acme', revenue: 250 },
      source: 'local',
      conflict: true,
    })
  })
})
