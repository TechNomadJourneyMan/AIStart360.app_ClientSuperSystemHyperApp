/**
 * lib/client-shell/free-step.ts — the free next step of an account with the
 * full GRI closed (R2-C: FirstRunWizard and «Следующий шаг» on /dashboard; one
 * call for both).
 *
 * «Снимок бизнеса» (/client/onboarding/snapshot) is a screen of the survey mode
 * «Экспресс + блоки», switched on in GIGA (setting `survey_modes`, R4-B4; the
 * page sends the client to the full questionnaire when it is off). So it is
 * offered only while the express mode is enabled — the server passes the modes
 * (lib/survey/modes-server.ts getSurveyModes). Otherwise the step is the
 * questionnaire (free), with a text that promises nothing else.
 */
import type { SurveyMode } from '@/lib/survey/modes'

export interface FreeNextStep {
  kind: 'snapshot' | 'survey'
  href: string
  /** Wizard step. */
  title: string
  desc: string
  cta: string
  icon: string
  /** /dashboard «Следующий шаг». */
  eyebrow: string
  headline: string
  lead: string
}

export const FREE_SNAPSHOT_HREF = '/client/onboarding/snapshot'
export const FREE_SURVEY_HREF = '/client/onboarding'

/**
 * `modes` — the server decision (getSurveyModes().enabled). Without it (a
 * component rendered without the server value) — the questionnaire: always
 * open, never a page that may be switched off.
 */
export function freeNextStep(modes: readonly SurveyMode[] = ['full']): FreeNextStep {
  if (modes.includes('express')) {
    return {
      kind: 'snapshot',
      href: FREE_SNAPSHOT_HREF,
      title: 'Получите экспресс-оценку',
      desc: '«Снимок бизнеса» по вашей анкете — бесплатно. Полный GRI и Точка А — в платном доступе.',
      cta: 'Открыть снимок бизнеса',
      icon: 'insights',
      eyebrow: 'Следующий шаг · Снимок бизнеса',
      headline: 'Бесплатная экспресс-оценка по вашей анкете',
      lead: '«Снимок бизнеса» покажет общую картину по ответам анкеты. Полный GRI и разбор Точки А — в платном доступе.',
    }
  }
  return {
    kind: 'survey',
    href: FREE_SURVEY_HREF,
    title: 'Дополните анкету',
    desc: 'Анкета — бесплатно: чем полнее ответы, тем точнее будет диагностика. Полный GRI и Точка А — в платном доступе.',
    cta: 'Открыть анкету',
    icon: 'edit_note',
    eyebrow: 'Следующий шаг · Анкета',
    headline: 'Дополните анкету — это бесплатно',
    lead: 'Чем полнее ответы, тем точнее будет диагностика. Полный GRI и разбор Точки А — в платном доступе.',
  }
}
