import type { Tone } from '@/components/giga-panel/kit'

/** Подписи обращений к эксперту (`expert_cases`, миграция 032). */

export const CASE_STATUS: Record<string, { label: string; tone: Tone }> = {
  new: { label: 'Новое', tone: 'blue' },
  in_progress: { label: 'В работе', tone: 'violet' },
  resolved: { label: 'Решено', tone: 'green' },
  closed: { label: 'Закрыто', tone: 'neutral' },
}

export const CASE_PRIORITY: Record<string, { label: string; tone: Tone }> = {
  critical: { label: 'Критический', tone: 'red' },
  high: { label: 'Высокий', tone: 'amber' },
  medium: { label: 'Средний', tone: 'blue' },
  low: { label: 'Низкий', tone: 'neutral' },
}

export const CASE_TRIGGER: Record<string, string> = {
  user_requested_help: 'Запрос клиента',
  validation_issue: 'Ошибка в данных',
  llm_recommendation: 'Рекомендация ИИ',
  critical_risk: 'Критический риск',
  incomplete_data: 'Неполные данные',
  manual: 'Вручную',
}
