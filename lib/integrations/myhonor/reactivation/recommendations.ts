import type {
  MyHonorReactivationInterest,
  MyHonorReactivationSegment,
} from './types'

export const MYHONOR_PRODUCT_SEASONS = [
  'spring',
  'summer',
  'autumn',
  'winter',
  'all_season',
] as const

export type MyHonorProductSeason = (typeof MYHONOR_PRODUCT_SEASONS)[number]

export interface MyHonorVerifiedStock {
  warehouseCode: string
  city: string | null
  /** Net sellable stock supplied by the trusted inventory projection. */
  availableQuantity: number
  verifiedAt: string
}

export interface MyHonorVerifiedVariant {
  id: string
  active: boolean
  size: string | null
  color: string | null
  /** Optional variant price; product catalog price is used when absent. */
  priceKzt: number | null
  stocks: readonly MyHonorVerifiedStock[]
}

export interface MyHonorVerifiedProduct {
  /** Canonical source id, not an LLM-created identifier. */
  id: string
  name: string
  canonicalUrl: string
  priceKzt: number
  currency: 'KZT'
  catalogActive: boolean
  availability: 'in_stock' | 'out_of_stock' | 'preorder' | 'discontinued' | 'unknown'
  verificationStatus: 'verified' | 'unverified'
  verifiedAt: string
  interests: readonly MyHonorReactivationInterest[]
  seasons: readonly MyHonorProductSeason[]
  variants: readonly MyHonorVerifiedVariant[]
}

export interface MyHonorRecommendationProfile {
  interests: readonly MyHonorReactivationInterest[]
  seasons: readonly MyHonorProductSeason[]
  size: string | null
  budgetKzt: number | null
  city: string | null
}

export interface MyHonorRecommendationInput {
  products: readonly MyHonorVerifiedProduct[]
  profile: MyHonorRecommendationProfile
  limit?: number
  now?: Date
  maxCatalogAgeHours?: number
  maxStockAgeHours?: number
  excludeProductIds?: readonly string[]
  /** Non-empty for back-in-stock: only these contact-specific products qualify. */
  requiredProductIds?: readonly string[]
  /** Use for campaigns promising availability in the customer's exact city. */
  requireCityStock?: boolean
}

export interface MyHonorProductRecommendation {
  productId: string
  name: string
  canonicalUrl: string
  priceKzt: number
  currency: 'KZT'
  variantId: string
  size: string | null
  color: string | null
  stockCity: string | null
  warehouseCode: string
  availableQuantity: number
  catalogVerifiedAt: string
  stockVerifiedAt: string
  matchedInterests: MyHonorReactivationInterest[]
  matchedSeasons: MyHonorProductSeason[]
  stockScope: 'requested_city' | 'other_city' | 'unspecified_city'
}

const INTEREST_AFFINITY_REQUIRED_SEGMENTS = new Set<MyHonorReactivationSegment>([
  'old_lead',
  'registered_no_order',
  'dormant_customer',
  'post_purchase',
])

/**
 * Prevents a broad lifecycle campaign from selecting a generic cheap product
 * when the Store has no category/activity affinity for the contact. Cart and
 * restock campaigns are product-specific; seasonal campaigns have an explicit
 * season. The remaining broad segments require a campaign or contact interest
 * until a source-owned prior-purchase category mapping exists.
 */
export function myHonorRecommendationAffinityExclusion(input: {
  segment: MyHonorReactivationSegment
  campaignInterest: MyHonorReactivationInterest | null
  contactInterests: readonly MyHonorReactivationInterest[]
}): 'insufficient_personalization' | null {
  if (!INTEREST_AFFINITY_REQUIRED_SEGMENTS.has(input.segment)) return null
  return input.campaignInterest || input.contactInterests.length > 0
    ? null
    : 'insufficient_personalization'
}

interface SelectedVariant {
  variant: MyHonorVerifiedVariant
  stock: MyHonorVerifiedStock
  priceKzt: number
  local: boolean
}

function normalizeComparable(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('ru-RU')
}

function validVerifiedAt(
  value: string,
  now: Date,
  maxAgeHours: number,
): boolean {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed) || !Number.isFinite(now.getTime())) return false
  const age = now.getTime() - parsed
  return age >= -5 * 60 * 1000 && age <= maxAgeHours * 60 * 60 * 1000
}

function validPrice(value: number): boolean {
  return Number.isFinite(value) && value > 0 && value <= 100_000_000
}

function validCanonicalProductUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:'
      && url.hostname === 'myhonor.shop'
      && !url.port
      && !url.username
      && !url.password
      && !url.search
      && !url.hash
      && /^\/product\/[a-z0-9-]+\/?$/.test(url.pathname)
  } catch {
    return false
  }
}

function validPositiveHours(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : fallback
}

function chooseVariant(
  product: MyHonorVerifiedProduct,
  profile: MyHonorRecommendationProfile,
  now: Date,
  maxStockAgeHours: number,
  requireCityStock: boolean,
): SelectedVariant | null {
  const requestedSize = normalizeComparable(profile.size)
  const requestedCity = normalizeComparable(profile.city)
  const candidates: SelectedVariant[] = []

  for (const variant of product.variants) {
    if (!variant.active || !variant.id.trim()) continue
    const variantSize = normalizeComparable(variant.size)
    if (requestedSize && variantSize !== requestedSize) continue
    const priceKzt = variant.priceKzt ?? product.priceKzt
    if (!validPrice(priceKzt)) continue
    if (profile.budgetKzt !== null && priceKzt > profile.budgetKzt) continue

    for (const stock of variant.stocks) {
      if (
        !stock.warehouseCode.trim()
        || !Number.isFinite(stock.availableQuantity)
        || stock.availableQuantity <= 0
        || !validVerifiedAt(stock.verifiedAt, now, maxStockAgeHours)
      ) continue
      const local = Boolean(
        requestedCity && normalizeComparable(stock.city) === requestedCity,
      )
      if (requireCityStock && requestedCity && !local) continue
      candidates.push({ variant, stock, priceKzt, local })
    }
  }

  candidates.sort((left, right) =>
    Number(right.local) - Number(left.local)
    || right.stock.availableQuantity - left.stock.availableQuantity
    || left.priceKzt - right.priceKzt
    || left.variant.id.localeCompare(right.variant.id)
    || left.stock.warehouseCode.localeCompare(right.stock.warehouseCode),
  )
  return candidates[0] ?? null
}

/**
 * Selects only source-verified catalog facts. Text generation is intentionally
 * absent: callers may render only the returned name, price, URL and stock facts.
 */
export function recommendVerifiedMyHonorProducts(
  input: MyHonorRecommendationInput,
): MyHonorProductRecommendation[] {
  const now = input.now ?? new Date()
  if (!Number.isFinite(now.getTime())) return []
  const maxCatalogAgeHours = validPositiveHours(input.maxCatalogAgeHours, 168)
  const maxStockAgeHours = validPositiveHours(input.maxStockAgeHours, 48)
  const limit = Number.isInteger(input.limit)
    ? Math.min(3, Math.max(1, input.limit ?? 1))
    : 2
  const excluded = new Set(input.excludeProductIds ?? [])
  const required = new Set(input.requiredProductIds ?? [])
  const requestedInterests = [...new Set(input.profile.interests)].sort()
  const requestedSeasons = [...new Set(input.profile.seasons)].sort()
  const requestedCity = normalizeComparable(input.profile.city)

  const scored: Array<{ recommendation: MyHonorProductRecommendation; score: number }> = []
  for (const product of input.products) {
    if (
      excluded.has(product.id)
      || (required.size > 0 && !required.has(product.id))
      || !/^myhonor:[a-f0-9]{64}$/.test(product.id)
      || product.verificationStatus !== 'verified'
      || !product.catalogActive
      || product.availability !== 'in_stock'
      || product.currency !== 'KZT'
      || !product.name.trim()
      || product.name.trim().length > 300
      || !validCanonicalProductUrl(product.canonicalUrl)
      || !validPrice(product.priceKzt)
      || !validVerifiedAt(product.verifiedAt, now, maxCatalogAgeHours)
    ) continue

    const matchedInterests = requestedInterests.filter((interest) =>
      product.interests.includes(interest),
    )
    if (requestedInterests.length > 0 && matchedInterests.length === 0) continue
    const matchedSeasons = requestedSeasons.filter((season) =>
      product.seasons.includes(season) || product.seasons.includes('all_season'),
    )
    if (requestedSeasons.length > 0 && matchedSeasons.length === 0) continue

    const selected = chooseVariant(
      product,
      input.profile,
      now,
      maxStockAgeHours,
      input.requireCityStock ?? false,
    )
    if (!selected) continue
    const stockScope = requestedCity
      ? selected.local
        ? 'requested_city'
        : selected.stock.city
          ? 'other_city'
          : 'unspecified_city'
      : 'unspecified_city'
    const score = (required.has(product.id) ? 1_000 : 0)
      + matchedInterests.length * 100
      + matchedSeasons.length * 50
      + (selected.local ? 30 : 0)
      + (input.profile.size ? 20 : 0)
      + (requestedCity && selected.stock.city ? 5 : 0)

    scored.push({
      score,
      recommendation: {
        productId: product.id,
        name: product.name.trim(),
        canonicalUrl: product.canonicalUrl,
        priceKzt: selected.priceKzt,
        currency: 'KZT',
        variantId: selected.variant.id,
        size: selected.variant.size?.trim() || null,
        color: selected.variant.color?.trim() || null,
        stockCity: selected.stock.city?.trim() || null,
        warehouseCode: selected.stock.warehouseCode.trim(),
        availableQuantity: selected.stock.availableQuantity,
        catalogVerifiedAt: product.verifiedAt,
        stockVerifiedAt: selected.stock.verifiedAt,
        matchedInterests,
        matchedSeasons,
        stockScope,
      },
    })
  }

  scored.sort((left, right) =>
    right.score - left.score
    || left.recommendation.priceKzt - right.recommendation.priceKzt
    || left.recommendation.productId.localeCompare(right.recommendation.productId),
  )
  return scored.slice(0, limit).map(({ recommendation }) => recommendation)
}
