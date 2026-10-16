/**
 * lib/moderation/profanity.ts — фильтр мата и нецензурной лексики (RU + EN).
 *
 * Ищет слова, а не подстроки: «рубля», «употреблять», «застрахуй», «мудрый»,
 * «хлеб», «ребёнок» не срабатывают. Устойчив к обходам: латиница вместо
 * кириллицы (xyй, bля), ё/е, повторы букв (бляяя), разделители между буквами
 * (б.л.я, х у й), цифры-двойники (3 → з, 0 → о). Чистые функции, без IO.
 *
 * Используется везде, где пользователь или персонал пишут текст:
 *   - входящие сообщения → маскировка «б***» + флаг (оригинал хранится);
 *   - ответы бота / AI → маскировка перед отправкой;
 *   - сообщения и рассылки персонала, названия, комментарии, анкета → отказ
 *     с понятной ошибкой (assertClean).
 */

export interface ProfanityMatch {
  /** Позиция в исходном тексте (UTF-16). */
  start: number
  end: number
  /** Слово как написано. */
  word: string
}

/** Латиница и цифры, похожие на кириллицу (только для поиска). */
const LOOKALIKE: Record<string, string> = {
  a: 'а', b: 'б', c: 'с', e: 'е', h: 'н', k: 'к', m: 'м', o: 'о', p: 'р', t: 'т', x: 'х', y: 'у',
  u: 'и', '3': 'з', '0': 'о', '6': 'б', '@': 'а', '$': 'с', ё: 'е',
}

/**
 * Корни мата (в начале слова после возможной приставки). Регулярка применяется
 * к нормализованному слову (только кириллица, без повторов букв).
 */
const PREFIXES = '(?:за|на|по|от|до|вы|раз|рас|из|ис|об|у|в|въ|вз|с|съ|под|пере|при|про|недо|ни|бес|без|о)?'
const RU_ROOTS: RegExp[] = [
  new RegExp(`^${PREFIXES}ху[йеёияюл]`),            // хуй, похуй, нахуя, хуета, хули
  new RegExp(`^${PREFIXES}пизд`),                    // пизда, распиздяй, спиздить
  new RegExp(`^${PREFIXES}п[иеё]зд`),
  new RegExp(`^${PREFIXES}[её]б(?:а|у|л|н|и|о|ну|ош|ыр|ло|ись|ит|ет|ёт|ут|ал|ан|ен|ть|ля)`), // ебать, заебал, уебан, выебон
  new RegExp(`^${PREFIXES}ъ?[её]б(?:а|у|л|н|и|ну|ал|ан|ен|ать|ыв)`), // въебать, разъебать
  /^бля/,                                             // бля, блядь, блять
  /^бл[яе]д/,
  /^мудак|^мудил|^мудо[зх]в|^мудач/,
  /^пид[оа]р|^пидр|^педик/,
  /^гандон|^гондон/,
  /^залуп/,
  /^шлюх|^шлюш/,
  /^дроч/,
  /^сук(?:а|и|е|у|ой|ин|ам|ами|ах)?$|^сучк|^сучар|^сучий/,
  /^манд[аеуыо](?:$|в|ч|ищ|ой|ою)/,
  /^ублюд/,
  /^хер(?:$|ня|ни|ов|ом|а|у|ачит|ово)|^нахер|^похер/,
  /^говн|^гавн/,
  /^жоп[аеуыо]|^жоп$/,
  /^долбо[её]б|^долба[её]б/,
  /^шалав/,
]

/** Слова, которые содержат корень, но не мат. */
const RU_WHITELIST = new Set([
  'страхуй', 'застрахуй', 'подстрахуй', 'перестрахуй', 'хулиган', 'хула', 'хулить', 'хулу',
  'мудрый', 'мудрость', 'мудрец', 'мудро', 'немудрено', 'употреблять', 'употребляет', 'употребление',
  'оскорблять', 'рубля', 'корабля', 'сукно', 'сукна', 'сукном', 'херсон', 'херес', 'мандарин', 'мандат',
  'мандаты', 'мандата', 'мандатов', 'ебидоеб',
  // «сук…» — только точные формы в RU_ROOTS, ветки «сукк…» не нужны
])

const EN_LIST = ['fuck', 'fucking', 'fucked', 'fucker', 'motherfucker', 'shit', 'shitty', 'bullshit', 'bitch', 'bitches', 'cunt', 'dick', 'dickhead', 'asshole', 'bastard', 'whore', 'slut', 'fag', 'faggot', 'nigger', 'nigga', 'wanker', 'twat']
const collapse = (s: string) => s.replace(/(.)\1+/g, '$1')
const EN_WORDS = new Set(EN_LIST.flatMap((w) => [w, `${w}s`]))
/** «FUUUCK», «shiiit»: the same words with every repeat collapsed. */
const EN_COLLAPSED = new Set([...EN_WORDS].map(collapse))

/** Слово → нормализованная кириллица без повторов, для сравнения с корнями. */
export function normalizeWord(raw: string): string {
  const lower = raw.toLowerCase()
  let out = ''
  for (const ch of lower) {
    const mapped = LOOKALIKE[ch] ?? ch
    if (/[а-я]/.test(mapped) && out[out.length - 1] !== mapped) out += mapped
  }
  return out
}

function isRussianProfane(word: string): boolean {
  const n = normalizeWord(word)
  if (n.length < 3 && n !== 'ху' && n !== 'хуй') return false
  if (RU_WHITELIST.has(n)) return false
  return RU_ROOTS.some((re) => re.test(n))
}

function isEnglishProfane(word: string): boolean {
  const w = word.toLowerCase().replace(/[^a-z]/g, '')
  return w.length >= 3 && (EN_WORDS.has(w) || EN_COLLAPSED.has(collapse(w)))
}

/**
 * Слова текста, включая «разорванные» (б.л.я, х у й): соседние одиночные
 * буквы, разделённые точками/пробелами/дефисами, склеиваются в одно слово.
 */
function tokens(text: string): Array<{ start: number; end: number; word: string }> {
  const out: Array<{ start: number; end: number; word: string }> = []
  const re = /[\p{L}\p{N}@$*]+/gu
  let m: RegExpExecArray | null
  const raw: Array<{ start: number; end: number; word: string }> = []
  while ((m = re.exec(text))) raw.push({ start: m.index, end: m.index + m[0].length, word: m[0] })
  for (let i = 0; i < raw.length; i++) {
    // Glue a run of single characters separated by 1–2 non-letters: «б.л.я», «х у й».
    if (raw[i].word.length === 1) {
      let j = i
      let word = raw[i].word
      while (j + 1 < raw.length && raw[j + 1].word.length === 1 && raw[j + 1].start - raw[j].end <= 2) {
        j++
        word += raw[j].word
      }
      if (j > i) {
        out.push({ start: raw[i].start, end: raw[j].end, word })
        i = j
        continue
      }
    }
    out.push(raw[i])
  }
  return out
}

/** Все нецензурные слова текста с позициями. */
export function findProfanity(text: string | null | undefined): ProfanityMatch[] {
  if (!text) return []
  return tokens(text).filter((t) => isRussianProfane(t.word) || isEnglishProfane(t.word))
}

export function hasProfanity(text: string | null | undefined): boolean {
  return findProfanity(text).length > 0
}

/** «блядь» → «б****»: первая буква остаётся, остальное — звёздочки. */
export function maskProfanity(text: string): string {
  const found = findProfanity(text)
  if (!found.length) return text
  let out = ''
  let pos = 0
  for (const f of found) {
    out += text.slice(pos, f.start)
    const chars = [...text.slice(f.start, f.end)]
    out += chars[0] + chars.slice(1).map((c) => (/[\s.\-_]/.test(c) ? '' : '*')).join('')
    pos = f.end
  }
  return out + text.slice(pos)
}

/** Ошибка для форм: персонал, названия, комментарии, анкета. */
export class ProfanityError extends Error {
  constructor(public readonly field: string | null = null) {
    super('Уберите нецензурные слова — такой текст сохранить нельзя.')
    this.name = 'ProfanityError'
  }
}

/** Бросает ProfanityError, если в любом из полей есть мат. */
export function assertClean(fields: Record<string, string | null | undefined>): void {
  for (const [field, value] of Object.entries(fields)) {
    if (hasProfanity(value)) throw new ProfanityError(field)
  }
}

/** Первое «грязное» поле из набора (для 400 с указанием поля) или null. */
export function dirtyField(fields: Record<string, string | null | undefined>): string | null {
  for (const [field, value] of Object.entries(fields)) if (hasProfanity(value)) return field
  return null
}

/** Вежливое предупреждение пользователю (бот / автоответ). */
export const PROFANITY_WARNING =
  'Пожалуйста, давайте общаться без грубых слов — так мы быстрее поможем. Эксперт увидит ваше сообщение.'
