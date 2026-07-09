// lib/crm/phone.ts — нормализация телефона в E.164 (KZ/RU-осведомлённая).
// Телефон опционален: некорректный ввод даёт e164=null, а не ошибку.

export interface NormalizedPhone {
  /** E.164 (+7…) либо null, если распознать не удалось. */
  e164: string | null
  /** Исходная строка, как её ввёл пользователь. */
  raw: string
}

/**
 * Правила:
 *  - убираем всё, кроме цифр (пробелы, скобки, дефисы);
 *  - `8XXXXXXXXXX` (11 цифр, каз/рос) → `+7XXXXXXXXXX`;
 *  - `7XXXXXXXXXX` (11 цифр) → `+7…`;
 *  - строка уже с ведущим `+` и 11–15 цифрами → нормализуем как `+<digits>`;
 *  - иначе e164 = null.
 */
export function normalizePhone(raw: string): NormalizedPhone {
  const original = typeof raw === 'string' ? raw : ''
  const trimmed = original.trim()
  if (!trimmed) return { e164: null, raw: original }

  const hasPlus = trimmed.startsWith('+')
  const digits = trimmed.replace(/\D/g, '')

  if (hasPlus) {
    // Уже международный формат: принимаем 11–15 цифр (E.164 max = 15).
    if (digits.length >= 11 && digits.length <= 15) {
      return { e164: `+${digits}`, raw: original }
    }
    return { e164: null, raw: original }
  }

  // KZ/RU: 8XXXXXXXXXX (11 цифр) → +7XXXXXXXXXX
  if (digits.length === 11 && digits.startsWith('8')) {
    return { e164: `+7${digits.slice(1)}`, raw: original }
  }

  // 7XXXXXXXXXX (11 цифр) → +7…
  if (digits.length === 11 && digits.startsWith('7')) {
    return { e164: `+${digits}`, raw: original }
  }

  return { e164: null, raw: original }
}
