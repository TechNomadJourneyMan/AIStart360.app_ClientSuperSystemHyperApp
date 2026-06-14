/**
 * Market Analysis (Анализ рынка) — typed question registry.
 *
 * The «Гений GTM — Рынок» checklist: 50 market-evaluation questions across
 * 6 blocks (A..F). Questions are VERBATIM from docs/market-50-questions-source.txt.
 *
 * Each question has a stable key (e.g. 'A1', 'C7', 'F5') used as the primary
 * identifier across the DB (market_analysis_answers.question_key), the API, and
 * the snapshot builder. Do not renumber — keys are persisted.
 */

export type BlockId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F'

export interface MarketQuestion {
  /** Stable key, e.g. 'A1', 'C7', 'F5'. Persisted in the DB. */
  key: string
  /** 1-based index within the block. */
  idx: number
  /** Question text, verbatim (Russian). */
  text: string
  /** Owning block id. */
  block: BlockId
}

export interface MarketBlock {
  id: BlockId
  /** Short code shown in the UI, e.g. 'TAM / SAM / SOM'. */
  code: string
  /** Full Russian title, verbatim. */
  title: string
  questions: MarketQuestion[]
}

// ---------------------------------------------------------------------------
// Raw question text per block (verbatim from the source checklist)
// ---------------------------------------------------------------------------

const BLOCK_DEFS: Array<{ id: BlockId; code: string; title: string; texts: string[] }> = [
  {
    id: 'A',
    code: 'TAM / SAM / SOM',
    title: 'TAM / SAM / SOM (ёмкость рынка)',
    texts: [
      'Какой общий объём рынка (TAM)?',
      'Какой объём доступного сегмента (SAM)?',
      'Какой реальный достижимый рынок (SOM) за 12–18 месяцев?',
      'Достаточно ли SOM, чтобы выйти на $2M / 1 млрд?',
      'Рынок растущий, стабильный, падающий?',
      'Какой CAGR за последние 3–5 лет?',
      'Как изменилось потребление за последние 12 месяцев?',
      'Какой прогноз роста категории на следующие 2 года?',
      'Есть ли суб-категории, растущие быстрее основного рынка?',
      'Есть ли окно возможностей (trend opportunity window)?',
    ],
  },
  {
    id: 'B',
    code: 'Рост рынка',
    title: 'Рост рынка (growth rate)',
    texts: [
      'Рынок растёт из-за поведения людей или маркетинга?',
      'Растут ли премиальные сегменты?',
      'Растёт ли онлайн потребление в этой нише?',
      'Есть ли цикличность (сезонность) и как она влияет?',
      'Есть ли барьеры, которые исчезают и открывают рост (регуляции, новые технологии)?',
    ],
  },
  {
    id: 'C',
    code: 'Тренды',
    title: 'Тренды (market trends)',
    texts: [
      'Какие 3–5 сильных трендов ведут рынок вверх?',
      'Есть ли глобальные сдвиги (здоровье, AI, автоматизация, ESG)?',
      'Какие новые типы продуктов появляются?',
      'Какие привычки людей меняются?',
      'Какие цифровые каналы растут в этой категории?',
      'Какие форматы потребления набирают обороты (подписки, комьюнити, сервисы)?',
      'Какие компании создают новые микро-рынки внутри большого?',
      'Есть ли тренды, которые могут убить продукт?',
      'Есть ли тренды, которые позволяют войти «в волну»?',
      'Какие тренды самые недооценённые конкурентами?',
    ],
  },
  {
    id: 'D',
    code: 'Барьеры входа',
    title: 'Барьеры входа',
    texts: [
      'Какие регуляторные барьеры существуют?',
      'Нужны ли лицензии/сертификация/допуски?',
      'Насколько сложна операционная часть?',
      'Насколько сложно масштабировать?',
      'Сколько денег нужно для входа?',
      'Сколько стоит привлечь клиента сейчас?',
      'Какой CAC у конкурентов?',
      'Есть ли технологический барьер (разработка, R&D)?',
      'Есть ли культурные барьеры (поведение людей)?',
      'Есть ли барьеры, которые можно использовать как конкурентное преимущество?',
    ],
  },
  {
    id: 'E',
    code: 'Конкуренты и их слабости',
    title: 'Конкуренты и их слабости',
    texts: [
      'Кто 5 главных конкурентов?',
      'В чём их сильные стороны?',
      'Где их слепые зоны?',
      'Какие продукты/услуги у них самые слабые?',
      'Какие конкуренты отстают на уровне упаковки?',
      'Какие конкуренты проигрывают по скорости?',
      'У каких конкурентов слабая коммуникация?',
      'У кого плохой сервис/операционка?',
      'Кто зависим от одного канала?',
      'У кого нет подписки, комьюнити или экосистемности?',
    ],
  },
  {
    id: 'F',
    code: 'Сегменты ×10',
    title: 'Сегменты ×10 (micro-segments)',
    texts: [
      'Какой сегмент растёт быстрее всех?',
      'Есть ли сегмент с высокой болью и деньгами?',
      'Какой сегмент недосмотрен конкурентами?',
      'Какой сегмент проще всего охватить первыми 100 клиентами?',
      'Какой микро-сегмент даёт ×10 скорость (быстро реагирует, покупает, платит)?',
    ],
  },
]

// ---------------------------------------------------------------------------
// Materialized registry
// ---------------------------------------------------------------------------

export const BLOCKS: MarketBlock[] = BLOCK_DEFS.map((def) => ({
  id: def.id,
  code: def.code,
  title: def.title,
  questions: def.texts.map((text, i) => ({
    key: `${def.id}${i + 1}`,
    idx: i + 1,
    text,
    block: def.id,
  })),
}))

/** Flat list of all 50 questions in block order. */
export const ALL_QUESTIONS: MarketQuestion[] = BLOCKS.flatMap((b) => b.questions)

/** All 50 question keys, in canonical order: A1..A10, B1..B5, … F1..F5. */
export const ALL_QUESTION_KEYS: string[] = ALL_QUESTIONS.map((q) => q.key)

export const TOTAL_QUESTIONS = ALL_QUESTION_KEYS.length // 50

const QUESTION_BY_KEY: Map<string, MarketQuestion> = new Map(
  ALL_QUESTIONS.map((q) => [q.key, q]),
)

const VALID_KEYS: Set<string> = new Set(ALL_QUESTION_KEYS)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** True if `key` is one of the 50 registered question keys. */
export function isValidQuestionKey(key: string): boolean {
  return VALID_KEYS.has(key)
}

/** Returns the question for a key, or null if unknown. */
export function getQuestion(key: string): MarketQuestion | null {
  return QUESTION_BY_KEY.get(key) ?? null
}

/** Returns the block id ('A'..'F') for a key, or null if unknown. */
export function getBlockForKey(key: string): BlockId | null {
  return QUESTION_BY_KEY.get(key)?.block ?? null
}
