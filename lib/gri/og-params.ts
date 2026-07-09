/**
 * lib/gri/og-params.ts — чистый парсер query-параметров для OG-картинки GRI
 * (`/api/og/gri?score=7.2&s=5,6,7,4,8,6,7`).
 *
 * Картинка рисуется ТОЛЬКО из чисел в query — никаких данных пользователя или
 * БД, поэтому единственная задача парсера — жёстко санитизировать вход:
 * клампить в 0..10, заменять мусор на 0 и всегда возвращать ровно 7 блоков.
 *
 * Файл импортируется edge-роутом `app/api/og/gri/route.tsx` — держим его без
 * node-зависимостей и без импорта тяжёлого `lib/gri-assessment/sections.ts`
 * (подписи ниже продублированы в каноническом порядке GRI_SECTIONS).
 */

/** Число блоков GRI — фиксировано методикой. */
export const OG_GRI_SECTION_COUNT = 7

/**
 * Короткие русские подписи 7 блоков для подписей под барами (порядок ==
 * порядок GRI_SECTIONS в lib/gri-assessment/sections.ts).
 */
export const OG_GRI_BLOCK_LABELS: readonly string[] = [
  'Продукт',
  'Доверие',
  'Модель',
  'Кэш',
  'Операции',
  'Команда',
  'Фаундер',
]

export interface OgGriParams {
  /** Общий индекс GRI, 0..10 с точностью до десятой. */
  score: number
  /** Ровно 7 оценок блоков, каждая 0..10 с точностью до десятой. */
  sections: number[]
}

/** Кламп в 0..10 + округление до одной десятой; мусор (NaN/∞) → 0. */
function clamp01to10(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw ?? ''))
  if (!Number.isFinite(n)) return 0
  const clamped = Math.min(10, Math.max(0, n))
  return Math.round(clamped * 10) / 10
}

/**
 * Разбирает `score` (0..10) и `s` (7 чисел через запятую) из query.
 * Гарантии: score ∈ [0..10]; sections.length === 7; каждый элемент ∈ [0..10];
 * любой мусор/недостача → 0, лишние значения отбрасываются.
 */
export function parseOgGriParams(searchParams: URLSearchParams): OgGriParams {
  const score = clamp01to10(searchParams.get('score'))

  const rawList = (searchParams.get('s') ?? '')
    .split(',')
    .slice(0, OG_GRI_SECTION_COUNT)
    .map((part) => clamp01to10(part.trim()))

  const sections = Array.from(
    { length: OG_GRI_SECTION_COUNT },
    (_, i) => rawList[i] ?? 0,
  )

  return { score, sections }
}
