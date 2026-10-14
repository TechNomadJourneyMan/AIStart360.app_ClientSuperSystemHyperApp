/**
 * lib/moderation/profanity.ts — фильтр нецензурной лексики, оскорблений и спама.
 *
 * Чистая функция без БД и сети: работает и на сервере (lib/moderation/guard.ts
 * отклоняет сохранение), и в браузере (подсказка в форме до отправки).
 *
 * Как устроено:
 *  1. Текст режется на слова (Unicode-буквы). Обходы склеиваются: «х.у.й»,
 *     «х у й», «х-у-й», «ххууййй», латиница-двойники «xyй», цифры «3» → «з».
 *  2. Каждое слово проверяется по корням. Мат матчится там, где корень
 *     действительно стоит (начало слова, приставки), а не «где угодно» —
 *     иначе ловятся «хлебать», «колебание», «употреблять», «себестоимость».
 *  3. Встроенный список исключений + словарь «разрешить» из админки
 *     (content_filter_terms.kind = 'allow') снимают ложные срабатывания;
 *     словарь «запретить» (kind = 'block') добавляет свои слова.
 *
 * Покрытие тестами: tests/unit/moderation/profanity.test.ts — в том числе
 * корпус нормальных деловых слов, которые НЕ должны срабатывать.
 */

export type ProfanityCategory = 'mat' | 'insult' | 'spam' | 'custom'

export const PROFANITY_CATEGORY_LABELS: Record<ProfanityCategory, string> = {
  mat: 'Нецензурная лексика',
  insult: 'Оскорбление',
  spam: 'Спам / реклама',
  custom: 'Запрещённое слово (словарь)',
}

export interface ProfanityMatch {
  category: ProfanityCategory
  /** Слово так, как оно стоит в тексте (для журнала маскируется через maskWord). */
  word: string
}

export interface ProfanityResult {
  clean: boolean
  matches: ProfanityMatch[]
  categories: ProfanityCategory[]
}

export interface ProfanityDictionary {
  /** Свои запрещённые слова: совпадение с началом слова (без учёта регистра, ё = е). */
  block?: readonly string[]
  /** Исключения: слово, начинающееся так, не считается нарушением. */
  allow?: readonly string[]
}

export interface ProfanityOptions {
  /**
   * 'name' — имя, должность, название компании: дополнительно запрещены ссылки
   * и @-ники (типичный спам в имени). 'text' — описания и свободные ответы.
   */
  kind?: 'name' | 'text'
  dictionary?: ProfanityDictionary
}

// ── Нормализация ─────────────────────────────────────────────────────────────

/** Латиница и цифры, которыми подменяют кириллицу («xyй», «cyka», «3ае6ал»). */
const TO_CYR: Record<string, string> = {
  a: 'а', b: 'в', c: 'с', e: 'е', h: 'н', k: 'к', m: 'м', o: 'о', p: 'р', t: 'т', x: 'х', y: 'у', u: 'и',
  '0': 'о', '3': 'з', '4': 'ч', '6': 'б', '@': 'а', $: 'с',
}

function baseNormalize(s: string): string {
  return s.toLowerCase().replace(/ё/g, 'е')
}

function toCyrillic(word: string): string {
  let out = ''
  for (const ch of word) out += TO_CYR[ch] ?? ch
  return out
}

function collapseRepeats(word: string): string {
  return word.replace(/(\p{L})\1+/gu, '$1')
}

/** Буквы + цифры/символы-подмены внутри слова. */
const WORD_RE = /[\p{L}0-9@$]+/gu
/** Разделители внутри слова, которыми разбивают мат: «х.у.й», «бл_ять», «х-уй». */
const INNER_SEP_RE = /(?<=[\p{L}0-9@$])[.\-_*'`~|+]+(?=[\p{L}0-9@$])/gu

/**
 * Слова-кандидаты. Помимо обычных слов добавляет склейки из подряд идущих
 * одиночных символов («х у й», «п и з д а») — так пишут, чтобы обойти фильтр.
 */
export function candidateWords(text: string): string[] {
  const lower = baseNormalize(text)
  const words: string[] = lower.match(WORD_RE) ?? []
  // «х.у.й», «бл_ять»: те же слова со склеенными разделителями — в дополнение к исходным.
  const joined = (lower.replace(INNER_SEP_RE, '').match(WORD_RE) ?? []).filter((w) => !words.includes(w))
  const out = [...words, ...joined]
  let run: string[] = []
  const flush = () => {
    if (run.length >= 3) out.push(run.join(''))
    run = []
  }
  for (const w of words) {
    if ([...w].length === 1) run.push(w)
    else flush()
  }
  flush()
  return out
}

// ── Правила ──────────────────────────────────────────────────────────────────

interface Rule { category: ProfanityCategory; re: RegExp }

/** Приставки, с которыми встречается корень «еб» (заебал, наебать, отъебись…). */
const EB_PREFIX = '(?:за|на|по|у|вы|от|отъ|подъ|разъ|раз|съ|въ|объ|при|пере|до|про|недо|из|изъ|рас|о|ни|долбо|мудо|мозго|хуе|пизд[оа])?'

/** Правила для кириллического вида слова (после TO_CYR и ё → е). */
const CYR_RULES: Rule[] = [
  // хуй и производные — корень где угодно в слове (нахуя, охуеть, хуйня); исключения ниже.
  { category: 'mat', re: /ху[йеяюи]/u },
  { category: 'mat', re: /пизд/u },
  { category: 'mat', re: /пезд/u },
  { category: 'mat', re: new RegExp(`^${EB_PREFIX}еб(?:$|а|у|л|н|ош|ы|ись|и|е[тш]|ок|ец|ень|ля|уч|ан)`, 'u') },
  { category: 'mat', re: /^еб$/u },
  { category: 'mat', re: /^(?:вы)?бля(?:$|д|т|ди|дс)/u },
  { category: 'mat', re: /^(?:с)?сук(?:а|и|е|у|ой|ам|ами|ах|ин|ина|ины|ин[оа]?м)$/u },
  { category: 'mat', re: /^сучар/u },
  { category: 'mat', re: /^муд(?:ак|ач|ил|озв|оеб|ень)/u },
  { category: 'mat', re: /^п[еи]д[оа]р/u },
  { category: 'mat', re: /^пидр/u },
  { category: 'mat', re: /^педик(?:и|а|у|ом|ов|ами|ах)?$/u },
  { category: 'mat', re: /^г[ао]нд[оа]н/u },
  { category: 'mat', re: /^шлюх/u },
  { category: 'mat', re: /залуп/u },
  { category: 'mat', re: /^(?:за|по|на|от|вз|об)?дроч/u },
  { category: 'mat', re: /^манд(?:а|ы|е|у|ой|ец|еж|ой|авошк)$/u },
  { category: 'mat', re: /^(?:вы|по|на|за|об|рас)?ср(?:ать|ал|ала|али|ало|ет|ут|ань|ака|аки|аный|анн|анец|анц|ун)/u },
  { category: 'mat', re: /^г[ао]вн/u },
  { category: 'mat', re: /^жоп/u },
  { category: 'mat', re: /^ублюд/u },
  { category: 'mat', re: /^шалав/u },
  // оскорбления — только точные формы, чтобы не задеть «урожай», «лохматый», «мразь» в цитатах и т. п.
  { category: 'insult', re: /^дебил/u },
  { category: 'insult', re: /^идиот/u },
  { category: 'insult', re: /^кретин/u },
  { category: 'insult', re: /^дегенерат/u },
  { category: 'insult', re: /^выродок|^выродк/u },
  { category: 'insult', re: /^ур[оа]д(?:ы|а|у|ом|ов|ина|ины|ец)?$/u },
  { category: 'insult', re: /^тва(?:рь|ри|рью|рей)$/u },
  { category: 'insult', re: /^мраз(?:ь|и|ью|ей)$/u },
  { category: 'insult', re: /^гнид(?:а|ы|е|у|ой)$/u },
  { category: 'insult', re: /^чмо$|^чмош/u },
  { category: 'insult', re: /^лох(?:и|а|у|ом|ов|ушк)?$|^лошар/u },
  { category: 'insult', re: /^падл(?:а|ы|е|у|ой)$/u },
  { category: 'insult', re: /^скотин/u },
  { category: 'insult', re: /^даун(?:ы|а|ом|ов)?$/u },
  // спам
  { category: 'spam', re: /^порн/u },
  { category: 'spam', re: /^виагр/u },
  { category: 'spam', re: /^эскорт/u },
]

/** Правила для латинского вида слова: английский мат и транслит русского. */
const LAT_RULES: Rule[] = [
  { category: 'mat', re: /fuck|fuk(?:ing|er)|f[u*]ck/ },
  { category: 'mat', re: /^(?:bull|horse)?shit(?!ake)/ },
  { category: 'mat', re: /bitch/ },
  { category: 'mat', re: /^cunt/ },
  { category: 'mat', re: /asshole|^ass$/ },
  { category: 'mat', re: /^whore/ },
  { category: 'mat', re: /^slut/ },
  { category: 'mat', re: /^motherf/ },
  { category: 'insult', re: /^nigg(?:a|er|ers|as)$/ },
  { category: 'insult', re: /^faggot/ },
  { category: 'insult', re: /^retard(?:ed|s)?$/ },
  // транслит
  { category: 'mat', re: /^(?:na|po|o|za)(?:k?h|x)u[yij]|^(?:k?h|x)u(?:y|i|j)$|^(?:k?h|x)u(?:ynya|inya|ylo|ilo|evo|esos|ey)/ },
  { category: 'mat', re: /^cyka$/ },
  { category: 'mat', re: /pizd|pezd/ },
  { category: 'mat', re: /^(?:vy)?bly(?:a|at|ad|adi?)$/ },
  { category: 'mat', re: /^(?:za|na|po|vy|ot|pro|u|do|raz|ras)?y?eb(?:at|al|an(?!k)|lo|uch|nu|osh)/ },
  { category: 'mat', re: /^p[ie]d[oa]r/ },
  { category: 'mat', re: /^mudak|^mudil/ },
  { category: 'mat', re: /zalup/ },
  { category: 'mat', re: /^g[ao]nd[oa]n/ },
  { category: 'mat', re: /^shl[yi]u?h/ },
  { category: 'mat', re: /^suk(?:a|i)$/ },
  { category: 'spam', re: /^porn|^xxx$|^viagra|^escort/ },
]

/**
 * Встроенные исключения — нормальные слова, содержащие «опасный» корень.
 * Проверяются по началу/вхождению в кириллическом виде слова.
 */
const BUILTIN_ALLOW: RegExp[] = [
  /страху/u, /психу/u, /^ебитд/u, /^ебит$/u, /^ебанк/u, /^ебизнес/u, /^ссуд/u, /^сукн/u, /^сукров/u,
  /^мандат/u, /^мандарин/u, /^мандолин/u, /^гондол/u, /^дебит/u, /^сретен/u,
  /^бляш/u, /^блях/u, /^хуан/u,
]

/** «http://…», «www.…», «t.me/…», «@nickname» — признаки спама в имени. */
const NAME_SPAM_RE = /(?:https?:\/\/|www\.|t\.me\/|wa\.me\/|(?:^|\s)@[a-z0-9_]{4,})/i

function isAllowed(cyr: string, lat: string, allow: readonly string[]): boolean {
  if (BUILTIN_ALLOW.some((re) => re.test(cyr))) return true
  for (const a of allow) {
    const t = baseNormalize(a.trim())
    if (t && (cyr.startsWith(t) || lat.startsWith(t))) return true
  }
  return false
}

const HAS_CYR = /[а-я]/u

function checkWord(word: string, dict: ProfanityDictionary): ProfanityCategory | null {
  const lat = word
  // Латиница-двойники переводятся в кириллицу только в словах, где кириллица
  // уже есть («xyй», «3аебал»): чисто латинское «Mandy» не должно стать «манду».
  const cyr = HAS_CYR.test(word) ? toCyrillic(word) : word
  const variants = [cyr, collapseRepeats(cyr)]
  const latVariants = [lat, collapseRepeats(lat)]
  const allow = dict.allow ?? []
  if (variants.some((v) => isAllowed(v, lat, allow))) return null

  for (const raw of dict.block ?? []) {
    const t = baseNormalize(raw.trim())
    if (t.length >= 2 && (variants.some((v) => v.startsWith(t)) || latVariants.some((v) => v.startsWith(t)) || word.startsWith(t))) return 'custom'
  }
  if (HAS_CYR.test(cyr)) {
    for (const r of CYR_RULES) if (variants.some((v) => r.re.test(v))) return r.category
  }
  if (/[a-z]/.test(lat)) {
    for (const r of LAT_RULES) if (latVariants.some((v) => r.re.test(v))) return r.category
  }
  return null
}

/** Проверить один текст. Пустой / нестроковый ввод — чистый. */
export function checkProfanity(text: unknown, opts: ProfanityOptions = {}): ProfanityResult {
  if (typeof text !== 'string' || !text.trim()) return { clean: true, matches: [], categories: [] }
  const dict = opts.dictionary ?? {}
  const matches: ProfanityMatch[] = []
  const seen = new Set<string>()
  for (const w of candidateWords(text.slice(0, 20_000))) {
    if (seen.has(w)) continue
    seen.add(w)
    const category = checkWord(w, dict)
    if (category) matches.push({ category, word: w })
  }
  if (opts.kind === 'name' && NAME_SPAM_RE.test(text)) matches.push({ category: 'spam', word: 'ссылка' })
  const categories = [...new Set(matches.map((m) => m.category))]
  return { clean: matches.length === 0, matches, categories }
}

/** «хуйня» → «х****». Для журнала и уведомлений: мат не попадает в ленту персонала. */
export function maskWord(word: string): string {
  const chars = [...word]
  if (chars.length <= 1) return '*'
  return chars[0] + '*'.repeat(Math.min(chars.length - 1, 8))
}

/** Текст с замаскированными нарушениями (для журнала). */
export function maskText(text: string, matches: readonly ProfanityMatch[], max = 300): string {
  let out = text.slice(0, max)
  const words = new Set(matches.map((m) => m.word))
  out = out.replace(/[\p{L}0-9@$.\-_*'`~|+]+/gu, (token) => {
    const norm = baseNormalize(token).replace(/[.\-_*'`~|+]/g, '')
    return words.has(norm) ? maskWord(norm) : token
  })
  return out
}
