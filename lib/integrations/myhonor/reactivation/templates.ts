import type { MyHonorReactivationSegment } from './types'
import {
  type MyHonorProductRecommendation,
  type MyHonorProductSeason,
} from './recommendations'

export const MYHONOR_TEMPLATE_PARAMETER_CONTRACT = {
  old_lead: ['product_name', 'price_kzt', 'product_url'],
  abandoned_cart: ['product_name', 'price_kzt', 'product_url'],
  registered_no_order: ['product_name', 'price_kzt', 'product_url'],
  dormant_customer: ['product_name', 'price_kzt', 'product_url'],
  post_purchase: ['product_name', 'price_kzt', 'product_url'],
  seasonal: ['season', 'product_name', 'price_kzt', 'product_url'],
  club_interest: ['catalog_url', 'club_invite_url'],
  back_in_stock: ['product_name', 'price_kzt', 'product_url'],
} as const satisfies Record<MyHonorReactivationSegment, readonly string[]>

/**
 * Exact Russian copy submitted to Meta for the first controlled rollout.
 * Launch preflight compares the provider-owned BODY against this contract so
 * an approved template cannot silently introduce discounts, compatibility,
 * local-stock or other claims that the recommender does not prove.
 */
export const MYHONOR_TEMPLATE_BODY_CONTRACT_RU = {
  old_lead:
    'Здравствуйте! Для вас есть актуальный вариант экипировки: {{1}} — {{2}}. Подробнее: {{3}}. Если подборки не нужны, ответьте СТОП.',
  abandoned_cart:
    'Здравствуйте! Вы оставили товар в корзине: {{1}} — {{2}}. Он сейчас доступен: {{3}}. Если напоминания не нужны, ответьте СТОП.',
  registered_no_order:
    'Здравствуйте! Можем помочь сократить выбор. Начать можно с {{1}} — {{2}}: {{3}}. Если подборки не нужны, ответьте СТОП.',
  dormant_customer:
    'Здравствуйте! Сейчас доступен актуальный вариант: {{1}} — {{2}}. Карточка товара: {{3}}. Если подборки не нужны, ответьте СТОП.',
  post_purchase:
    'Здравствуйте! Можно рассмотреть актуальный вариант для экипировки: {{1}} — {{2}}. Подробнее: {{3}}. Если подборки не нужны, ответьте СТОП.',
  seasonal:
    'Подборка на сезон «{{1}}»: {{2}} — {{3}}. Подробнее: {{4}}. Если подборки не нужны, ответьте СТОП.',
  club_interest:
    'Посмотреть каталог HONOR: {{1}}. Открыть чат HONOR Club: {{2}}. Если сообщения клуба не нужны, ответьте СТОП.',
  back_in_stock:
    'Вариант, которым вы интересовались, снова доступен: {{1}} — {{2}}. Карточка: {{3}}. Если подборки не нужны, ответьте СТОП.',
} as const satisfies Record<MyHonorReactivationSegment, string>

export function myHonorTemplateBodyContract(
  segment: MyHonorReactivationSegment,
  languageCode: string,
): string | null {
  return languageCode === 'ru'
    ? MYHONOR_TEMPLATE_BODY_CONTRACT_RU[segment]
    : null
}

export interface MyHonorTemplateCta {
  kind: 'product' | 'catalog' | 'club'
  label: string
  url: string
}

export interface MyHonorApprovedTemplateInput {
  segment: MyHonorReactivationSegment
  /** Exact approved Meta template name selected from server configuration. */
  templateName: string
  languageCode: string
  locale: 'ru' | 'kk'
  recommendations: readonly MyHonorProductRecommendation[]
  catalogUrl: string
  clubInviteUrl: string
  /** Server-owned campaign tag. Never contains customer identity. */
  utmCampaign: string
  season?: MyHonorProductSeason | null
}

export interface MyHonorApprovedTemplate {
  segment: MyHonorReactivationSegment
  templateName: string
  languageCode: string
  bodyParameters: string[]
  parameterContract: readonly string[]
  ctas: MyHonorTemplateCta[]
  sourceProductId: string | null
}

const SEASON_LABELS: Record<'ru' | 'kk', Record<MyHonorProductSeason, string>> = {
  ru: {
    spring: 'весна',
    summer: 'лето',
    autumn: 'осень',
    winter: 'зима',
    all_season: 'весь сезон',
  },
  kk: {
    spring: 'көктем',
    summer: 'жаз',
    autumn: 'күз',
    winter: 'қыс',
    all_season: 'барлық маусым',
  },
}

const CTA_LABELS = {
  ru: { product: 'Посмотреть товар', catalog: 'Открыть каталог', club: 'Вступить в клуб' },
  kk: { product: 'Тауарды көру', catalog: 'Каталогты ашу', club: 'Клубқа қосылу' },
} as const

function validTemplateName(value: string): boolean {
  return /^[a-z0-9_]{1,512}$/.test(value)
}

function validLanguageCode(value: string): boolean {
  return /^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(value)
}

function validMyHonorUrl(value: string, requiredPath?: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:'
      && url.hostname === 'myhonor.shop'
      && !url.port
      && !url.username
      && !url.password
      && !url.hash
      && (!requiredPath || url.pathname.replace(/\/$/, '') === requiredPath)
  } catch {
    return false
  }
}

function validMyHonorProductUrl(value: string): boolean {
  if (!validMyHonorUrl(value)) return false
  const url = new URL(value)
  return !url.search && /^\/product\/[a-z0-9-]+\/?$/.test(url.pathname)
}

function validClubInviteUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:'
      && url.hostname === 'chat.whatsapp.com'
      && !url.port
      && !url.username
      && !url.password
      && !url.hash
      && /^\/[A-Za-z0-9]{10,40}\/?$/.test(url.pathname)
  } catch {
    return false
  }
}

function trackedMyHonorUrl(value: string, campaign: string): string | null {
  if (!/^[a-z0-9][a-z0-9_-]{2,99}$/.test(campaign)) return null
  try {
    const url = new URL(value)
    url.searchParams.set('utm_source', 'whatsapp')
    url.searchParams.set('utm_medium', 'reactivation')
    url.searchParams.set('utm_campaign', campaign)
    return url.toString()
  } catch {
    return null
  }
}

function formatKzt(value: number, locale: 'ru' | 'kk'): string {
  return `${new Intl.NumberFormat(locale === 'kk' ? 'kk-KZ' : 'ru-RU', {
    maximumFractionDigits: 0,
  }).format(value)} ₸`
}

function validParameters(values: readonly string[]): boolean {
  return values.length <= 20 && values.every((value) =>
    value === value.trim() && value.length >= 1 && value.length <= 1_024,
  )
}

/** Renders the exact reviewed BODY for operator preview; never invents copy. */
export function renderMyHonorTemplateBody(
  segment: MyHonorReactivationSegment,
  languageCode: string,
  bodyParameters: readonly string[],
): string | null {
  const body = myHonorTemplateBodyContract(segment, languageCode)
  const parameterContract = MYHONOR_TEMPLATE_PARAMETER_CONTRACT[segment]
  if (
    !body
    || bodyParameters.length !== parameterContract.length
    || !validParameters(bodyParameters)
    || bodyParameters.some((value) => /{{|}}/.test(value))
  ) return null

  const rendered = body.replace(/{{([1-9][0-9]*)}}/g, (_placeholder, rawIndex) => {
    const index = Number(rawIndex) - 1
    return bodyParameters[index] ?? ''
  })
  return /{{|}}/.test(rendered) ? null : rendered
}

/**
 * Maps a segment to one immutable approved-template contract. It never writes
 * prose and never accepts a product fact that did not pass the recommender.
 */
export function buildMyHonorApprovedTemplate(
  input: MyHonorApprovedTemplateInput,
): MyHonorApprovedTemplate | null {
  if (
    !validTemplateName(input.templateName)
    || !validLanguageCode(input.languageCode)
    || !validMyHonorUrl(input.catalogUrl, '/catalog')
    || !validClubInviteUrl(input.clubInviteUrl)
  ) return null

  const labels = CTA_LABELS[input.locale]
  const recommendation = input.recommendations[0] ?? null
  const trackedCatalogUrl = trackedMyHonorUrl(input.catalogUrl, input.utmCampaign)
  if (!trackedCatalogUrl) return null
  let bodyParameters: string[]
  let ctas: MyHonorTemplateCta[]
  let sourceProductId: string | null = null

  if (input.segment === 'club_interest') {
    bodyParameters = [trackedCatalogUrl, input.clubInviteUrl]
    ctas = [
      { kind: 'club', label: labels.club, url: input.clubInviteUrl },
      { kind: 'catalog', label: labels.catalog, url: trackedCatalogUrl },
    ]
  } else {
    if (
      !recommendation
      || recommendation.currency !== 'KZT'
      || !Number.isFinite(recommendation.priceKzt)
      || recommendation.priceKzt <= 0
      || !validMyHonorProductUrl(recommendation.canonicalUrl)
      || !validParameters([
        recommendation.name,
        formatKzt(recommendation.priceKzt, input.locale),
        recommendation.canonicalUrl,
      ])
    ) return null
    const trackedProductUrl = trackedMyHonorUrl(
      recommendation.canonicalUrl,
      input.utmCampaign,
    )
    if (!trackedProductUrl) return null
    const productParameters = [
      recommendation.name,
      formatKzt(recommendation.priceKzt, input.locale),
      trackedProductUrl,
    ]
    if (input.segment === 'seasonal') {
      if (!input.season) return null
      bodyParameters = [SEASON_LABELS[input.locale][input.season], ...productParameters]
    } else {
      bodyParameters = productParameters
    }
    ctas = [{
      kind: 'product',
      label: labels.product,
      url: trackedProductUrl,
    }]
    sourceProductId = recommendation.productId
  }

  const parameterContract = MYHONOR_TEMPLATE_PARAMETER_CONTRACT[input.segment]
  if (
    bodyParameters.length !== parameterContract.length
    || !validParameters(bodyParameters)
  ) return null

  return {
    segment: input.segment,
    templateName: input.templateName,
    languageCode: input.languageCode,
    bodyParameters,
    parameterContract,
    ctas,
    sourceProductId,
  }
}
