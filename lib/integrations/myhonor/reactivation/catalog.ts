import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase-service'
import type {
  MyHonorReactivationConfiguration,
  MyHonorReactivationInterest,
} from './types'
import type {
  MyHonorProductSeason,
  MyHonorVerifiedProduct,
  MyHonorVerifiedStock,
  MyHonorVerifiedVariant,
} from './recommendations'

interface Row { [key: string]: unknown }

function row(value: unknown): Row {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Row
    : {}
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function number(value: unknown): number | null {
  const result = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(result) ? result : null
}

function boolean(value: unknown): boolean {
  return value === true
}

function classifyInterests(value: string): MyHonorReactivationInterest[] {
  const normalized = value.normalize('NFKC').toLocaleLowerCase('ru-RU')
  const interests = new Set<MyHonorReactivationInterest>()
  if (/охот|hunter|hunting/.test(normalized)) interests.add('hunting')
  if (/рыбал|рыбол|fishing/.test(normalized)) interests.add('fishing')
  if (/тактич|tactical/.test(normalized)) interests.add('tactical')
  if (/горн|трек|trek|hiking|mountain/.test(normalized)) interests.add('mountains')
  if (/ботин|обув|сапог|кроссов|нос(ки|ок)|shoe|boot/.test(normalized)) {
    interests.add('footwear')
  }
  if (/термо|базов.{0,8}слой|base.?layer/.test(normalized)) {
    interests.add('base_layer')
  }
  if (/аксесс|перчат|вареж|головн|шапк|ремень|сумк|рюкзак|accessor/.test(normalized)) {
    interests.add('accessories')
  }
  if (interests.size === 0 || /outdoor|активн.{0,8}отдых|туризм/.test(normalized)) {
    interests.add('outdoor')
  }
  return [...interests].sort()
}

function classifySeasons(value: string): MyHonorProductSeason[] {
  const normalized = value.normalize('NFKC').toLocaleLowerCase('ru-RU')
  const seasons = new Set<MyHonorProductSeason>()
  if (/зим|winter|thinsulate|утепл|-[1-5][0-9]/.test(normalized)) seasons.add('winter')
  if (/лет|summer|mesh|жарк/.test(normalized)) seasons.add('summer')
  if (/весен|spring/.test(normalized)) seasons.add('spring')
  if (/осен|autumn|fall/.test(normalized)) seasons.add('autumn')
  if (/демисез|soft.?shell/.test(normalized)) {
    seasons.add('spring')
    seasons.add('autumn')
  }
  if (seasons.size === 0 || /всесез|all.?season/.test(normalized)) {
    seasons.add('all_season')
  }
  return [...seasons].sort()
}

function requireBinding(configuration: MyHonorReactivationConfiguration): {
  userId: string
  companyId: string
} {
  if (!configuration.ownerUserId || !configuration.companyId) {
    throw new Error('MyHonor reactivation catalog binding is not configured')
  }
  return { userId: configuration.ownerUserId, companyId: configuration.companyId }
}

/**
 * Loads only canonical products joined to variants and the currently published
 * inventory/price imports. Names classify activity/season deterministically;
 * price, URL and stock are copied only from server-owned snapshots.
 */
export async function loadVerifiedMyHonorProducts(
  input: { configuration: MyHonorReactivationConfiguration; limit?: number },
  client: SupabaseClient = createServiceClient(),
): Promise<MyHonorVerifiedProduct[]> {
  const binding = requireBinding(input.configuration)
  const limit = Math.min(500, Math.max(1, input.limit ?? 300))
  const [productResult, variantResult, runResult, warehouseResult] = await Promise.all([
    client.from('ecommerce_products')
      .select('id, external_id, name, url, description, price, currency, availability, catalog_active, catalog_synced_at')
      .eq('user_id', binding.userId)
      .eq('company_id', binding.companyId)
      .eq('source', 'myhonor.shop')
      .eq('catalog_active', true)
      .eq('availability', 'in_stock')
      .order('catalog_synced_at', { ascending: false })
      .limit(limit),
    client.from('store_product_variants')
      .select('id, ecommerce_product_id, name, category, size, color, is_active')
      .eq('user_id', binding.userId)
      .eq('company_id', binding.companyId)
      .eq('is_active', true)
      .limit(5_000),
    client.from('store_import_runs')
      .select('id, import_kind, published_at')
      .eq('user_id', binding.userId)
      .eq('company_id', binding.companyId)
      .eq('status', 'published')
      .in('import_kind', ['prices', 'inventory'])
      .order('published_at', { ascending: false })
      .limit(100),
    client.from('store_warehouses')
      .select('id, code, city, is_active')
      .eq('user_id', binding.userId)
      .eq('company_id', binding.companyId)
      .eq('is_active', true)
      .limit(500),
  ])
  if (productResult.error || variantResult.error || runResult.error || warehouseResult.error) {
    throw new Error('load MyHonor verified catalog: source facts unavailable')
  }

  const runs = (runResult.data ?? []).map(row)
  const priceRunId = runs
    .filter((item) => item.import_kind === 'prices')
    .map((item) => text(item.id))
    .find((value): value is string => Boolean(value)) ?? null
  const inventoryRunId = runs
    .filter((item) => item.import_kind === 'inventory')
    .map((item) => text(item.id))
    .find((value): value is string => Boolean(value)) ?? null
  if (!inventoryRunId) return []

  // A published import is a complete source snapshot. Reading multiple runs
  // would let an older positive stock survive a newer zero/missing row and
  // could make a marketing message promise inventory that no longer exists.
  const pricePromise = priceRunId
    ? client.from('store_price_snapshots')
      .select('variant_id, import_run_id, retail_price, snapshot_date, created_at')
      .in('import_run_id', [priceRunId])
      .limit(10_000)
    : Promise.resolve({ data: [], error: null })
  const inventoryPromise = client.from('store_inventory_snapshots')
    .select('variant_id, warehouse_id, import_run_id, quantity_available, quantity_reserved, snapshot_date, created_at')
    .in('import_run_id', [inventoryRunId])
    .limit(20_000)
  const [priceResult, inventoryResult] = await Promise.all([
    pricePromise,
    inventoryPromise,
  ])
  if (priceResult.error || inventoryResult.error) {
    throw new Error('load MyHonor verified catalog: published facts unavailable')
  }

  const runPublishedAt = new Map(
    runs.map((item) => [text(item.id), text(item.published_at)]),
  )
  const warehouseById = new Map(
    (warehouseResult.data ?? []).map((value) => {
      const item = row(value)
      return [text(item.id), item]
    }),
  )
  const pricesByVariant = new Map<string, { price: number; at: string }>()
  for (const value of priceResult.data ?? []) {
    const item = row(value)
    const variantId = text(item.variant_id)
    const price = number(item.retail_price)
    const at = runPublishedAt.get(text(item.import_run_id))
      ?? text(item.created_at)
      ?? text(item.snapshot_date)
    if (!variantId || !price || !at) continue
    const previous = pricesByVariant.get(variantId)
    if (!previous || Date.parse(at) > Date.parse(previous.at)) {
      pricesByVariant.set(variantId, { price, at })
    }
  }

  const stocksByVariant = new Map<string, MyHonorVerifiedStock[]>()
  for (const value of inventoryResult.data ?? []) {
    const item = row(value)
    const variantId = text(item.variant_id)
    const warehouse = warehouseById.get(text(item.warehouse_id))
    const quantity = (number(item.quantity_available) ?? 0)
      - (number(item.quantity_reserved) ?? 0)
    const verifiedAt = runPublishedAt.get(text(item.import_run_id))
      ?? text(item.created_at)
      ?? text(item.snapshot_date)
    const warehouseCode = text(warehouse?.code)
    if (!variantId || !warehouseCode || !verifiedAt || quantity <= 0) continue
    const stocks = stocksByVariant.get(variantId) ?? []
    stocks.push({
      warehouseCode,
      city: text(warehouse?.city),
      availableQuantity: quantity,
      verifiedAt,
    })
    stocksByVariant.set(variantId, stocks)
  }

  const variantsByProduct = new Map<string, MyHonorVerifiedVariant[]>()
  const tagsByProduct = new Map<string, string[]>()
  for (const value of variantResult.data ?? []) {
    const item = row(value)
    const productId = text(item.ecommerce_product_id)
    const variantId = text(item.id)
    if (!productId || !variantId || !boolean(item.is_active)) continue
    const stocks = stocksByVariant.get(variantId) ?? []
    if (stocks.length === 0) continue
    const variants = variantsByProduct.get(productId) ?? []
    variants.push({
      id: variantId,
      active: true,
      size: text(item.size),
      color: text(item.color),
      priceKzt: pricesByVariant.get(variantId)?.price ?? null,
      stocks,
    })
    variantsByProduct.set(productId, variants)
    const tags = tagsByProduct.get(productId) ?? []
    tags.push(text(item.name) ?? '', text(item.category) ?? '')
    tagsByProduct.set(productId, tags)
  }

  const products: MyHonorVerifiedProduct[] = []
  for (const value of productResult.data ?? []) {
    const item = row(value)
    const databaseId = text(item.id)
    const externalId = text(item.external_id)
    const name = text(item.name)
    const canonicalUrl = text(item.url)
    const priceKzt = number(item.price)
    const verifiedAt = text(item.catalog_synced_at)
    const variants = databaseId ? variantsByProduct.get(databaseId) ?? [] : []
    if (!externalId || !name || !canonicalUrl || !priceKzt || !verifiedAt || variants.length === 0) {
      continue
    }
    const classifierText = [
      name,
      text(item.description) ?? '',
      ...(tagsByProduct.get(databaseId as string) ?? []),
    ].join(' ')
    if (item.currency !== 'KZT') continue
    products.push({
      id: externalId,
      name,
      canonicalUrl,
      priceKzt,
      currency: 'KZT',
      catalogActive: boolean(item.catalog_active),
      availability: item.availability === 'in_stock' ? 'in_stock' : 'unknown',
      verificationStatus: 'verified',
      verifiedAt,
      interests: classifyInterests(classifierText),
      seasons: classifySeasons(classifierText),
      variants,
    })
  }
  return products
}
