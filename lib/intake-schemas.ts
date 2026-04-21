// Intake schema per vertical. The generic flow still uses the 12-step
// onboarding components in components/onboarding/. The medical flow is
// a single 8-field form modelled on the /9 clinic landing page.

import type { VerticalId } from '@/lib/verticals'

export interface IntakeField {
  key: string
  label: string
  type: 'text' | 'email' | 'tel' | 'url' | 'textarea' | 'file' | 'select'
  placeholder?: string
  required?: boolean
  maxLength?: number
  /** Server-side storage key inside survey_answers.answers JSON */
  answerKey: string
  /** For 'select' */
  options?: Array<{ value: string; label: string }>
  /** Hint text shown below the field */
  hint?: string
}

// ── Medical intake (from in.aistart360.app/9 landing mockup) ────────────────
export const MEDICAL_INTAKE_FIELDS: IntakeField[] = [
  {
    key: 'full_name',
    label: 'Имя',
    type: 'text',
    required: true,
    placeholder: 'Как к вам обращаться',
    answerKey: 'full_name',
    maxLength: 80,
  },
  {
    key: 'phone',
    label: 'Телефон',
    type: 'tel',
    required: true,
    placeholder: '+7 (___) ___-__-__',
    answerKey: 'phone',
    hint: 'Для связи по стратегии (Казахстан: +7 7_…)',
    maxLength: 24,
  },
  {
    key: 'email',
    label: 'Email для отправки расчёта',
    type: 'email',
    required: true,
    placeholder: 'mail@клиника.kz',
    answerKey: 'email',
    maxLength: 120,
  },
  {
    key: 'clinic_name',
    label: 'Название клиники',
    type: 'text',
    required: true,
    placeholder: 'Sau Zhurek, Шымкент',
    answerKey: 'clinic_name',
    maxLength: 120,
  },
  {
    key: 'clinic_website',
    label: 'Сайт клиники',
    type: 'url',
    required: false,
    placeholder: 'https://…',
    answerKey: 'clinic_website',
    maxLength: 200,
  },
  {
    key: 'top_services',
    label: 'Топ-3 услуги (ваши основные направления)',
    type: 'textarea',
    required: true,
    placeholder: 'Например: УЗИ сердца, ЭКГ, консультация кардиолога',
    answerKey: 'top_services',
    hint: 'Через запятую или с новой строки',
    maxLength: 400,
  },
  {
    key: 'top_competitors',
    label: 'Топ-3 конкурента',
    type: 'textarea',
    required: false,
    placeholder: 'Клиники, с которыми сравнивают пациенты',
    answerKey: 'top_competitors',
    maxLength: 400,
  },
  {
    key: 'patient_base_file',
    label: 'Выгрузка базы пациентов (для аудита)',
    type: 'file',
    required: false,
    answerKey: 'patient_base_file',
    hint: 'Excel, CSV, PDF (до 5 МБ). Для файлов больше 5 МБ — используйте ссылку на облако.',
  },
]

// ── Generic intake stays in components/onboarding (not replicated here) ─────

export function getIntakeFields(vertical: VerticalId): IntakeField[] | null {
  if (vertical === 'medical') return MEDICAL_INTAKE_FIELDS
  return null // generic → use existing multi-step onboarding
}
