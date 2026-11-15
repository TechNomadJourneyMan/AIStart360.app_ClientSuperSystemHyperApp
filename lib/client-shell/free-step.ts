/**
 * lib/client-shell/free-step.ts — the free next step of an account with the
 * full GRI closed (R2-C: FirstRunWizard and «Следующий шаг» on /dashboard; one
 * call for both).
 *
 * «Снимок бизнеса» (/client/onboarding/snapshot) is a screen of the survey mode
 * «Экспресс + блоки», switched on by NEXT_PUBLIC_SURVEY_MODES (the page itself
 * does not check the flag). So it is offered only while the express mode is
 * enabled — the same helper the questionnaire uses (lib/survey/modes.ts
 * enabledSurveyModes). Otherwise the step is the questionnaire (free), with a
 * text that promises nothing else.
 */
import { enabledSurveyModes, type SurveyMode } from '@/lib/survey/modes'

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

export function freeNextStep(modes: readonly SurveyMode[] = enabledSurveyModes()): FreeNextStep {
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
