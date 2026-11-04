/**
 * lib/moderation/hint.ts — подсказка в форме до отправки (браузер).
 *
 * Та же чистая проверка, что и на сервере (без словаря из админки — его
 * видит только сервер, поэтому окончательное решение всё равно за API).
 */
import { checkProfanity, PROFANITY_CATEGORY_LABELS } from './profanity'

/** Текст предупреждения под полем или null, если всё чисто. */
export function contentHint(value: unknown, kind: 'name' | 'text' = 'text'): string | null {
  const r = checkProfanity(value, { kind })
  if (r.clean) return null
  const what = r.categories.map((c) => PROFANITY_CATEGORY_LABELS[c].toLowerCase()).join(', ')
  return `Уберите недопустимые слова (${what}) — с ними данные не сохранятся.`
}
