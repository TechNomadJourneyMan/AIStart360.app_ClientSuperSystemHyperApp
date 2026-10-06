/**
 * Personal and contact data that must not be sent to a language model.
 *
 * Model prompts need the business picture (numbers, processes, goals), not
 * who the person is or how to reach them. Survey keys that carry names,
 * phones, emails, messenger handles, addresses, web/social links or
 * identification numbers are dropped before a prompt is built.
 */
const PERSONAL_KEY_RE =
  /(contact|phone|e-?mail|telegram|whatsapp|viber|instagram|facebook|vk|social|website|site_url|address|_addr|passport|\biin\b|_iin|\bbin\b|_bin|full_?name|first_?name|last_?name|_fio|owner_name|company_name|brand|legal_name)/i

export function isPersonalDataKey(key: string): boolean {
  return PERSONAL_KEY_RE.test(key)
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
const PHONE_RE = /(?:\+?\d[\s\-()]*){10,}/g

/** Mask emails and phone-like digit runs inside free text. */
export function maskContacts(text: string): string {
  return text.replace(EMAIL_RE, '[email]').replace(PHONE_RE, '[телефон]')
}

/** Survey rows without personal keys, free-text values masked. */
export function withoutPersonalData<T extends { question_key: string; answer: unknown }>(rows: ReadonlyArray<T>): T[] {
  return rows
    .filter((r) => !isPersonalDataKey(r.question_key))
    .map((r) => (typeof r.answer === 'string' ? { ...r, answer: maskContacts(r.answer) } : r))
}
