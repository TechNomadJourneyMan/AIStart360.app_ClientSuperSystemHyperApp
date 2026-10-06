/**
 * Personal and contact data that must not be sent to a language model.
 *
 * Model prompts need the business picture (numbers, processes, goals), not
 * who the person is or how to reach them. Survey keys that carry names,
 * phones, emails, messenger handles, addresses, web/social links or
 * identification numbers are dropped before a prompt is built.
 *
 * Masking is shape-based and deliberately narrow: money amounts
 * («1 500 000 000 тенге»), year ranges («2023-2024») and percentages stay
 * intact so the business figures still reach the model.
 */
const PERSONAL_KEY_RE =
  /(contact|phone|e-?mail|telegram|whatsapp|viber|instagram|facebook|vk|social|website|site_url|address|_addr|passport|\biin\b|_iin|\bbin\b|_bin|full_?name|first_?name|last_?name|_fio|owner_name|company_name|brand|legal_name)/i

export function isPersonalDataKey(key: string): boolean {
  return PERSONAL_KEY_RE.test(key)
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
/**
 * Phone shapes only: an international prefix (+7, +998, +1 …) or a Kazakh /
 * Russian trunk «8» (followed by a separator or a 7xx / 9xx code), then a
 * 2–4 digit operator / area code and a 3-2-2 (or 3-4) subscriber part.
 * Space-grouped amounts are 3-3-3 and never match.
 */
const PHONE_RE =
  /(?<![\d+])(?:\+\d{1,3}|8(?=[\s\-.(]|[79]))[\s\-.]*\(?\d{2,4}\)?[\s\-.]*\d{3}[\s\-.]*\d{2}[\s\-.]*\d{2}(?!\d)/g
/** IIN / BIN (12 digits) when labelled, or when it starts with a valid YYMMDD. */
const LABELLED_ID_RE = /((?:ИИН|БИН|IIN|BIN)\s*[:№#-]?\s*)\d{12}(?!\d)/gi
const BARE_IIN_RE = /(?<!\d)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])[0-6]\d{5}(?!\d)/g

/** Mask emails, phone numbers and IIN/BIN inside free text. */
export function maskContacts(text: string): string {
  return text
    .replace(EMAIL_RE, '[email]')
    .replace(PHONE_RE, '[телефон]')
    .replace(LABELLED_ID_RE, '$1[ИИН]')
    .replace(BARE_IIN_RE, '[ИИН]')
}

const UPPER = 'А-ЯЁӘҒҚҢӨҰҮҺІ'
const LOWER = 'а-яёәғқңөұүһі'
const WORD = `[${UPPER}][${LOWER}]+(?:-[${UPPER}][${LOWER}]+)?`
/** «Иванов Иван Иванович», «Иван Петрович», «Ахметов Серик Болатұлы». */
const PATRONYMIC_NAME_RE = new RegExp(
  `(?:${WORD}\\s+){1,2}[${UPPER}][${LOWER}]+(?:вич|вна|ична|инична|ұлы|улы|қызы|кызы)(?![${LOWER}])`,
  'g',
)
/** «Иванов И.И.», «И. И. Иванов». */
const INITIALS_NAME_RE = new RegExp(
  `${WORD}\\s+[${UPPER}]\\.\\s?[${UPPER}]\\.|[${UPPER}]\\.\\s?[${UPPER}]\\.\\s?${WORD}`,
  'g',
)
/** «ФИО: Иванов Иван», «Пациент — Анна Смирнова», «Contact person: John Smith». */
const LABELLED_NAME_RE = new RegExp(
  `(?<![${LOWER}${UPPER}A-Za-z])((?:ФИО|Ф\\.И\\.О\\.?|[Ии]мя|[Фф]амилия|[Кк]онтактное лицо|[Кк]онтакт|[Пп]ациент(?:ка)?|[Кк]лиент(?:ка)?|[Пп]окупатель|[Дд]иректор|[Рр]уководитель|[Оо]тветственный|[Мм]енеджер|[Nn]ame|[Ff]ull name|[Cc]ontact person|[Pp]atient|[Cc]ustomer)\\s*[:—–-]\\s*)(?:(?:${WORD}|[A-Z][a-z]+)(?:\\s+(?:${WORD}|[A-Z][a-z]+|[${UPPER}A-Z]\\.)){0,2})`,
  'g',
)

/**
 * Contacts plus person names that can be recognised by their shape
 * (patronymic, initials, or a «ФИО:» style label). Numbers are untouched.
 */
export function maskPersonalText(text: string): string {
  return maskContacts(text)
    .replace(LABELLED_NAME_RE, '$1[имя]')
    .replace(PATRONYMIC_NAME_RE, '[имя]')
    .replace(INITIALS_NAME_RE, '[имя]')
}

/**
 * Deep copy of a survey answer with every string masked and nested personal
 * keys dropped. Answers are stored as `{ value: … }` (lib/survey/schema.ts),
 * and values can be arrays / tables of objects.
 */
export function maskAnswer(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return maskPersonalText(value)
  if (depth > 8 || value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((v) => maskAnswer(v, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (isPersonalDataKey(k)) continue
    out[k] = maskAnswer(v, depth + 1)
  }
  return out
}

/** Survey rows without personal keys, every free-text value masked. */
export function withoutPersonalData<T extends { question_key: string; answer: unknown }>(rows: ReadonlyArray<T>): T[] {
  return rows
    .filter((r) => !isPersonalDataKey(r.question_key))
    .map((r) => ({ ...r, answer: maskAnswer(r.answer) }))
}
