/**
 * lib/survey/chat/guard.ts — «ИИ не придумывает чисел» (spec §3 anti-goal, §8.6).
 *
 * The model only REPORTS literals it saw («5,5», scale «млн», period «year»);
 * this module checks each one against the client's own words about the
 * question and computes the value on the server:
 *
 *   • the number must be in the client's text — as digits (canonicalNumber of
 *     lib/point-b/insights/numbers.ts: «5,5» = «5.5», «1 500 000» = «1500000»)
 *     or as simple Russian numerals («пять», «двадцать пять», «полтора»,
 *     «миллион» alone = 1 миллион);
 *   • the scale (тыс / млн / млрд) is the word written right after the number
 *     (or after a range «5–6 млн») — the client's word wins over the model's;
 *     a model scale with no such word anywhere in the text is refused;
 *   • month ↔ year: only ÷12 into a `*_month` question, only when the client
 *     wrote «в год», and the card says «пересчитал: … в год ÷ 12».
 *
 * Numbers in the helper's free replies (`reply`, `clarify`) are checked with
 * `foreignNumbers` against the client's words, the registry texts and the
 * proposed value; one foreign number → the reply is replaced by a template.
 * Pure and browser-safe.
 */
import { allowedNumbers, canonicalNumber, extractNumbers, foreignNumbers } from '@/lib/point-b/insights/numbers'
import { SURVEY_TERMS } from '../terms'
import { whereToFindFor } from '../where-to-find'
import type { SurveyQuestion } from '../questions'
import type { NumberLiteral } from './types'

// ─── Russian numerals ────────────────────────────────────────────────────────

const UNITS: Record<string, number> = {
  ноль: 0, нуль: 0, один: 1, одна: 1, одно: 1, одного: 1, одну: 1, два: 2, две: 2, двух: 2, три: 3, трех: 3, четыре: 4, четырех: 4,
  пять: 5, пяти: 5, шесть: 6, шести: 6, семь: 7, семи: 7, восемь: 8, восьми: 8, девять: 9, девяти: 9,
}
const TEENS: Record<string, number> = {
  десять: 10, десяти: 10, одиннадцать: 11, двенадцать: 12, тринадцать: 13, четырнадцать: 14, пятнадцать: 15,
  шестнадцать: 16, семнадцать: 17, восемнадцать: 18, девятнадцать: 19,
}
const TENS: Record<string, number> = {
  двадцать: 20, двадцати: 20, тридцать: 30, тридцати: 30, сорок: 40, сорока: 40, пятьдесят: 50, пятидесяти: 50,
  шестьдесят: 60, семьдесят: 70, восемьдесят: 80, девяносто: 90,
}
const HUNDREDS: Record<string, number> = {
  сто: 100, ста: 100, двести: 200, триста: 300, четыреста: 400, пятьсот: 500, шестьсот: 600, семьсот: 700, восемьсот: 800, девятьсот: 900,
}
const HALF: Record<string, number> = { полтора: 1.5, полторы: 1.5 }

type Scale = NonNullable<NumberLiteral['scale']>
const SCALE_VALUE: Record<Scale, number> = { тыс: 1e3, млн: 1e6, млрд: 1e9 }

/**
 * A scale word → its scale. `strong` = a full word («миллион», «тысяча») that
 * means «1 миллион» on its own; abbreviations («млн», «к») count only right
 * after a number («300к»), so the preposition «к» is never a thousand.
 */
export function scaleOfWord(word: string): { scale: Scale; strong: boolean } | null {
  const w = word.toLowerCase().replace(/ё/g, 'е').replace(/\.$/, '')
  if (/^(миллиард\p{L}*)$/u.test(w)) return { scale: 'млрд', strong: true }
  if (/^(млрд|ярд\p{L}*)$/u.test(w)) return { scale: 'млрд', strong: false }
  if (/^(миллион\p{L}*|лям\p{L}*)$/u.test(w)) return { scale: 'млн', strong: true }
  if (/^(млн|mln)$/u.test(w)) return { scale: 'млн', strong: false }
  if (/^(тысяч\p{L}*|тыщ\p{L}*)$/u.test(w)) return { scale: 'тыс', strong: true }
  if (/^(тыс|к|k)$/u.test(w)) return { scale: 'тыс', strong: false }
  return null
}

/** «полмиллиона» / «полтысячи» → 0.5 of the scale. */
function halfScale(word: string): Scale | null {
  const m = word.match(/^пол(миллиона|миллиарда|тысячи)$/u)
  if (!m) return null
  return m[1].startsWith('миллиона') ? 'млн' : m[1].startsWith('миллиарда') ? 'млрд' : 'тыс'
}

type Token =
  | { t: 'num'; value: number; text: string }
  | { t: 'scale'; scale: Scale; strong?: boolean }
  | { t: 'sep' }
  | { t: 'word'; text: string }

const TOKEN_RE = /(\d+(?:[   ]\d{3})*(?:[.,]\d+)?)|([\p{L}]+\.?)|([-–—~≈]|\.\.)/gu

/** Text → tokens: numbers (digits and numerals), scale words, range separators, other words. */
export function tokenize(text: string): Token[] {
  const raw: Token[] = []
  for (const m of text.toLowerCase().replace(/ё/g, 'е').matchAll(TOKEN_RE)) {
    if (m[1]) {
      const c = canonicalNumber(m[1])
      if (c !== null) raw.push({ t: 'num', value: Number(c), text: m[1] })
    } else if (m[2]) {
      const word = m[2].replace(/\.$/, '')
      const half = halfScale(word)
      if (half) { raw.push({ t: 'num', value: 0.5, text: word }, { t: 'scale', scale: half }); continue }
      const scale = scaleOfWord(m[2])
      if (scale) raw.push({ t: 'scale', scale: scale.scale, strong: scale.strong })
      else if (word === 'до' || word === 'или') raw.push({ t: 'sep' })
      else raw.push({ t: 'word', text: word })
    } else if (m[3]) {
      raw.push({ t: 'sep' })
    }
  }
  // Numerals: «двадцать пять» → 25, «сто двадцать» → 120; a new number starts
  // when the order breaks («пять шесть» → 5, 6); «миллион» alone → 1 миллион.
  const out: Token[] = []
  let acc: { value: number; rank: number; text: string } | null = null
  const flush = () => { if (acc) out.push({ t: 'num', value: acc.value, text: acc.text }); acc = null }
  for (const tok of raw) {
    if (tok.t === 'word') {
      const w = tok.text
      const part = HUNDREDS[w] !== undefined ? { v: HUNDREDS[w], r: 3 }
        : TENS[w] !== undefined ? { v: TENS[w], r: 2 }
          : TEENS[w] !== undefined ? { v: TEENS[w], r: 1 }
            : UNITS[w] !== undefined ? { v: UNITS[w], r: 1 }
              : HALF[w] !== undefined ? { v: HALF[w], r: 0 }
                : null
      if (part) {
        if (acc && part.r < acc.rank && part.r > 0) acc = { value: acc.value + part.v, rank: part.r, text: `${acc.text} ${w}` }
        else { flush(); acc = { value: part.v, rank: part.r, text: w } }
        continue
      }
    }
    flush()
    if (tok.t === 'scale') {
      const prev = out[out.length - 1]
      const afterNumber = prev?.t === 'num'
      // «к нам», «тыс.» without a number: not a scale.
      if (!afterNumber && !tok.strong) { out.push({ t: 'word', text: 'scale' }); continue }
      // «миллион в месяц»: one million.
      if (!afterNumber) out.push({ t: 'num', value: 1, text: '1' })
    }
    out.push(tok)
  }
  flush()
  return out
}

/** The canonical numbers the client wrote (digits and numerals). */
export function clientNumbers(texts: readonly string[]): Set<string> {
  const out = new Set<string>()
  for (const text of texts) {
    for (const tok of tokenize(text)) if (tok.t === 'num') out.add(String(Math.abs(tok.value)))
    for (const c of extractNumbers(text)) out.add(c)
  }
  return out
}

/** The canonical form of a model literal («5,5» → "5.5», «пять» → "5"); null when unreadable. */
export function canonicalLiteral(raw: string): string | null {
  const s = raw.trim().replace(/^[-−]/, '')
  if (/\d/.test(s)) return canonicalNumber(s.replace(/[^\d\s  .,]/g, '').trim())
  const nums = tokenize(s).filter((t): t is Extract<Token, { t: 'num' }> => t.t === 'num')
  return nums.length === 1 ? String(nums[0].value) : null
}

/** The scale written right after the number `canonical` (or after «5–6 млн»); null when none. */
export function adjacentScale(texts: readonly string[], canonical: string): Scale | null {
  for (const text of texts) {
    const toks = tokenize(text)
    for (let i = 0; i < toks.length; i += 1) {
      const tok = toks[i]
      if (tok.t !== 'num' || String(tok.value) !== canonical) continue
      let j = i + 1
      // «5–6 млн», «от 5 до 6 млн»: skip the separator and the second number.
      if (toks[j]?.t === 'sep' && toks[j + 1]?.t === 'num') j += 2
      const after = toks[j]
      if (after?.t === 'scale') return after.scale
    }
  }
  return null
}

function hasScaleWord(texts: readonly string[], scale: Scale): boolean {
  return texts.some((t) => tokenize(t).some((tok) => tok.t === 'scale' && tok.scale === scale))
}

// JS \b does not see Cyrillic letters: explicit letter look-arounds.
const YEAR_RE = /(?<!\p{L})(год|года|году|годовая|годовой|годовую|годовых|годовые|ежегодно|ежегодный)(?!\p{L})/iu
const MONTH_RE = /(?<!\p{L})(мес|месяц|месяца|месяцев|месяцу|ежемесячно|ежемесячная|ежемесячный|помесячно)(?!\p{L})/iu

/** What period the client named: only year words → 'year', only month words → 'month'. */
export function textPeriod(texts: readonly string[]): 'month' | 'year' | null {
  const all = texts.join('\n').toLowerCase()
  const year = YEAR_RE.test(all)
  const month = MONTH_RE.test(all)
  if (year && !month) return 'year'
  if (month && !year) return 'month'
  return null
}

/** The question asks a monthly amount (the `*_month` keys with an automatic year). */
export function isMonthQuestion(q: Pick<SurveyQuestion, 'key' | 'unit'>): boolean {
  return /_month$/.test(q.key) || q.unit === '₸/мес'
}

export type GuardFailure = 'not_in_text' | 'scale_not_in_text' | 'period_mismatch' | 'unreadable'

export interface GroundedNumber {
  value: number
  /** «пересчитал: 66 млн в год ÷ 12». */
  note?: string
}

const SCALE_LABEL: Record<Scale, string> = { тыс: 'тыс.', млн: 'млн', млрд: 'млрд' }

/**
 * One model literal → a value the client actually wrote, or why not.
 * `texts` are the client's messages about this question.
 */
export function groundNumber(lit: NumberLiteral, q: Pick<SurveyQuestion, 'key' | 'unit'>, texts: readonly string[]):
  { ok: true; number: GroundedNumber } | { ok: false; reason: GuardFailure } {
  const canonical = canonicalLiteral(lit.raw)
  if (canonical === null) return { ok: false, reason: 'unreadable' }
  if (!clientNumbers(texts).has(canonical)) return { ok: false, reason: 'not_in_text' }

  const near = adjacentScale(texts, canonical)
  let scale: Scale | null = near
  if (lit.scale && lit.scale !== near) {
    // The model's scale must be a word the client wrote.
    if (near !== null || !hasScaleWord(texts, lit.scale)) return { ok: false, reason: 'scale_not_in_text' }
    scale = lit.scale
  }
  let value = Number(canonical) * (scale ? SCALE_VALUE[scale] : 1)
  if (!Number.isFinite(value)) return { ok: false, reason: 'unreadable' }

  // Period: the client's words decide; the model's period only when the text is silent.
  const said = textPeriod(texts)
  const period = said ?? lit.period
  if (said === null && lit.period === 'year' && isMonthQuestion(q)) return { ok: false, reason: 'period_mismatch' }
  let note: string | undefined
  if (isMonthQuestion(q) && period === 'year') {
    const shown = `${canonical.replace('.', ',')}${scale ? ` ${SCALE_LABEL[scale]}` : ''}`
    value = Math.round(value / 12)
    note = `пересчитал: ${shown} в год ÷ 12`
  } else if (!isMonthQuestion(q) && period === 'month' && /_year$|_20\d\d$/.test(q.key)) {
    // A yearly question answered per month: no silent ×12 outside the month/year pairs.
    return { ok: false, reason: 'period_mismatch' }
  }
  return { ok: true, number: note ? { value, note } : { value } }
}

/** A negative number is taken only when the client wrote a minus or «убыток». */
export function clientSaidNegative(texts: readonly string[]): boolean {
  return texts.some((t) => /(^|[\s(])[-−]\s*\d|минус|убыт/iu.test(t))
}

// ─── Free replies ────────────────────────────────────────────────────────────

/** Every number a reply about `q` may show: the client's, the registry's, the proposed value's. */
export function replyAllowedNumbers(q: SurveyQuestion, clientTexts: readonly string[], extra: unknown[] = []): Set<string> {
  const allowed = clientNumbers(clientTexts)
  const where = whereToFindFor(q.key)
  allowedNumbers([
    q.label, q.formLabel, q.plain, q.why, q.unit, q.range,
    q.options?.map((o) => o.label),
    q.term ? SURVEY_TERMS[q.term] : null,
    where ? [where.short, where.how, where.sources, where.ifUnknown, where.example] : null,
    ...extra,
  ], allowed)
  // Plain numerals of the client («пять») are allowed as words too; digits only matter here.
  return allowed
}

/** The numbers of a reply that come from nowhere ([] = grounded). */
export function replyForeignNumbers(reply: string, allowed: ReadonlySet<string>): string[] {
  return foreignNumbers(reply, allowed)
}
