/**
 * lib/integrations/registry.ts — the e-commerce integrations the platform
 * knows (W7). Single source for the API, the UI (client Settings ›
 * Интеграции and GIGA › Интеграции), the sync agent and the documentation.
 *
 * Rules (owner decision + platform rules):
 *   • A live adapter exists ONLY where the provider's official documentation
 *     was read; each adapter cites its doc URLs and pins its base URL / API
 *     version (lib/integrations/providers/*). Every live adapter is marked
 *     «не проверено вживую» (verifiedLive: false) until it is tested with a
 *     seller key.
 *   • Where the docs could not be reached or the provider requires an OAuth
 *     application the platform does not have, the provider is 'file': the
 *     connection record carries no credentials and its data comes from the
 *     seller's exports (CSV/XLSX) through the documents pipeline. `blocked`
 *     states why, what is needed and how to unblock.
 *   • Credentials are stored only encrypted (lib/integrations/credentials.ts)
 *     and never returned by an API.
 *
 * Keys are stable: the CHECK constraints of migration 105 list them (a test
 * keeps both in sync).
 */
import type { FactKey } from './facts'

export const INTEGRATION_PROVIDER_KEYS = [
  'moysklad',
  'kaspi',
  'wildberries',
  'ozon',
  'ga4',
  'yandex_metrika',
  'shopify',
  'insales',
  'tilda',
  'bitrix_shop',
  'meta_ads',
  'yandex_direct',
  'google_ads',
] as const

export type ProviderKey = (typeof INTEGRATION_PROVIDER_KEYS)[number]

export type ProviderCategory = 'accounting' | 'marketplace' | 'analytics' | 'platform' | 'ads'

export const CATEGORY_LABELS: Readonly<Record<ProviderCategory, string>> = {
  accounting: 'Учёт и склад',
  marketplace: 'Маркетплейсы',
  analytics: 'Веб-аналитика',
  platform: 'Сайт и магазин',
  ads: 'Реклама',
}

export interface CredentialField {
  name: string
  label: string
  /** secret → encrypted secret_ciphertext; setting → plain `settings` (not secret: ids, domains). */
  target: 'secret' | 'setting'
  input: 'password' | 'text' | 'textarea'
  placeholder?: string
  help?: string
  /** Validation of the trimmed value. */
  pattern: RegExp
  /** Message when the pattern does not match. */
  invalid: string
  maxLength: number
}

export interface BlockedInfo {
  reason: string
  requiredInput: string
  howToUnblock: string
}

export interface ProviderDef {
  key: ProviderKey
  label: string
  category: ProviderCategory
  /** live: a documented adapter syncs facts; file: exports only (no credentials stored). */
  mode: 'live' | 'file'
  authKind: 'token' | 'basic' | 'oauth' | 'file'
  fields: readonly CredentialField[]
  /** Official documentation that was read (live) or that could not be reached (file). */
  docs: readonly string[]
  /** Where the seller gets the key / what to upload (Russian, shown in the UI). */
  keySource: string
  /** Facts the adapter writes. */
  facts: readonly FactKey[]
  /** A live adapter is «не проверено вживую» until tested with a seller key. */
  verifiedLive: boolean
  blocked?: BlockedInfo
  /** Which export to upload and as which document type (documents pipeline). */
  exportHint: string
}

const TOKEN_RE = /^[\x21-\x7e]{16,4096}$/

const tokenField = (label: string, help: string, placeholder = 'Вставьте токен'): CredentialField => ({
  name: 'token',
  label,
  target: 'secret',
  input: 'password',
  placeholder,
  help,
  pattern: TOKEN_RE,
  invalid: 'Токен выглядит неполным: проверьте, что скопирован целиком, без пробелов',
  maxLength: 4096,
})

export const INTEGRATION_PROVIDERS: Readonly<Record<ProviderKey, ProviderDef>> = {
  moysklad: {
    key: 'moysklad',
    label: 'МойСклад',
    category: 'accounting',
    mode: 'live',
    authKind: 'token',
    fields: [tokenField(
      'Токен доступа JSON API',
      'МойСклад → профиль пользователя (правый верхний угол) → «Токены» → «Создать токен». Нужны права на просмотр показателей и отчётов. Создание нового токена через API отзывает старые — используйте отдельного сотрудника для интеграции.',
    )],
    docs: [
      'https://dev.moysklad.ru/doc/api/remap/1.2/#/general',
      'https://dev.moysklad.ru/doc/api/remap/1.2/#/restrictions',
      'https://dev.moysklad.ru/doc/api/remap/1.2/#/reports/report-sales-orders',
      'https://dev.moysklad.ru/doc/api/remap/1.2/#/reports/report-stock',
      'https://github.com/moysklad/api-remap-1.2-doc (официальный репозиторий документации, md/)',
    ],
    keySource: 'Токен сотрудника МоегоСклада (Профиль → Токены).',
    facts: ['orders_count', 'orders_amount', 'sales_count', 'revenue', 'returns_count', 'returns_amount', 'sku_count', 'sku_in_stock'],
    verifiedLive: false,
    exportHint: 'Отчёты «Прибыльность» или «Остатки» из МоегоСклада (XLSX/CSV) — тип «Остатки / склад» или «Отчёт о продажах».',
  },
  kaspi: {
    key: 'kaspi',
    label: 'Kaspi Магазин',
    category: 'marketplace',
    mode: 'live',
    authKind: 'token',
    fields: [tokenField(
      'Токен API Магазина на Kaspi.kz',
      'Только руководитель компании: веб-кабинет продавца Kaspi → Настройки → «Токен API» → «Сформировать». Токен даёт доступ к заказам и товарам — не пересылайте его в мессенджерах.',
    )],
    docs: [
      'https://guide.kaspi.kz/partner/ru/shop/api/general/q3196',
      'https://guide.kaspi.kz/partner/ru/shop/api/orders/q3201',
      'https://guide.kaspi.kz/partner/ru/shop/api/general/q3198',
    ],
    keySource: 'Кабинет продавца Kaspi → Настройки → Токен API (формирует руководитель).',
    facts: ['orders_count', 'orders_amount', 'sales_count', 'revenue', 'returns_count', 'returns_amount'],
    verifiedLive: false,
    exportHint: 'Выгрузка заказов из кабинета продавца Kaspi (XLSX) — тип «Отчёт маркетплейса».',
  },
  wildberries: {
    key: 'wildberries',
    label: 'Wildberries',
    category: 'marketplace',
    mode: 'live',
    authKind: 'token',
    fields: [tokenField(
      'Токен WB API (категория «Статистика»)',
      'Портал продавца WB → Профиль → Настройки → «Доступ к API» → создать токен с категорией «Статистика» (только чтение). Базовый токен ограничен 1 запросом в 2–3 часа — синхронизация будет медленной.',
    )],
    docs: [
      'https://dev.wildberries.ru/openapi/api-information (спецификация: https://dev.wildberries.ru/api/swagger/yaml/ru/01-general.yaml)',
      'https://dev.wildberries.ru/openapi/reports (спецификация: https://dev.wildberries.ru/api/swagger/yaml/ru/12-reports.yaml)',
    ],
    keySource: 'Портал продавца WB → Настройки → Доступ к API, категория «Статистика».',
    facts: ['orders_count', 'orders_amount', 'sales_count', 'revenue', 'returns_count', 'returns_amount', 'payout'],
    verifiedLive: false,
    exportHint: 'Еженедельный «Отчёт о реализации» (детализация) из портала продавца WB — тип «Отчёт маркетплейса».',
  },
  ozon: {
    key: 'ozon',
    label: 'Ozon',
    category: 'marketplace',
    mode: 'file',
    authKind: 'file',
    fields: [],
    docs: ['https://docs.ozon.ru/api/seller/ (недоступна из контура: антибот-проверка JavaScript)'],
    keySource: 'Live-подключение пока недоступно — загрузите «Отчёт о реализации» из кабинета Ozon.',
    facts: [],
    verifiedLive: false,
    blocked: {
      reason: 'Официальная документация Ozon Seller API (docs.ozon.ru/api/seller) не открывается из контура платформы: страница отдаёт антибот-проверку с JavaScript; опубликованной спецификации OpenAPI на открытом адресе нет. Писать адаптер по сторонним клиентам запрещено правилами.',
      requiredInput: 'Доступ к официальной документации Ozon Seller API (или её OpenAPI-файл от Ozon) и пара Client-Id + Api-Key продавца для живой проверки.',
      howToUnblock: 'Открыть сеть контура к docs.ozon.ru (или приложить официальную спецификацию), затем написать адаптер по документации и проверить ключом продавца. До этого — загрузка «Отчёта о реализации» (CSV/XLSX).',
    },
    exportHint: 'Финансы → Документы → «Отчёт о реализации» (XLSX) — тип «Отчёт маркетплейса».',
  },
  ga4: {
    key: 'ga4',
    label: 'Google Analytics 4',
    category: 'analytics',
    mode: 'live',
    authKind: 'token',
    fields: [
      {
        name: 'property_id',
        label: 'ID ресурса GA4',
        target: 'setting',
        input: 'text',
        placeholder: '123456789',
        help: 'GA4 → Администратор → Настройки ресурса → «Идентификатор ресурса» (только цифры).',
        pattern: /^\d{4,20}$/,
        invalid: 'ID ресурса — только цифры',
        maxLength: 20,
      },
      {
        name: 'service_account_json',
        label: 'Ключ сервисного аккаунта (JSON)',
        target: 'secret',
        input: 'textarea',
        placeholder: '{"type": "service_account", …}',
        help: 'Google Cloud → IAM → Сервисные аккаунты → создать аккаунт → «Ключи» → JSON. Включите Google Analytics Data API в проекте и добавьте e-mail сервисного аккаунта в GA4 (Администратор → Управление доступом к ресурсу) с ролью «Читатель».',
        pattern: /^\s*\{[\s\S]{40,20000}\}\s*$/,
        invalid: 'Вставьте содержимое JSON-файла ключа целиком',
        maxLength: 20000,
      },
    ],
    docs: [
      'https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/runReport',
      'https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema',
      'https://developers.google.com/analytics/devguides/reporting/data/v1/quotas',
      'https://developers.google.com/identity/protocols/oauth2/service-account',
    ],
    keySource: 'JSON-ключ сервисного аккаунта Google Cloud с ролью «Читатель» в ресурсе GA4. Вход через Google (OAuth) не настроен: у платформы нет OAuth-клиента Google.',
    facts: ['sessions', 'users', 'web_purchases', 'web_revenue'],
    verifiedLive: false,
    exportHint: 'Отчёт GA4 «Трафик» / «Покупки» (CSV) — тип «Экспорт GA4».',
  },
  yandex_metrika: {
    key: 'yandex_metrika',
    label: 'Яндекс Метрика',
    category: 'analytics',
    mode: 'live',
    authKind: 'oauth',
    fields: [
      {
        name: 'counter_id',
        label: 'Номер счётчика',
        target: 'setting',
        input: 'text',
        placeholder: '44147844',
        help: 'Метрика → список счётчиков → номер рядом с названием.',
        pattern: /^\d{3,12}$/,
        invalid: 'Номер счётчика — только цифры',
        maxLength: 12,
      },
      tokenField(
        'OAuth-токен Яндекса (доступ metrika:read)',
        'oauth.yandex.ru → «Создать приложение» с доступом «Получение статистики, чтение параметров своих и доверенных счётчиков» → откройте https://oauth.yandex.ru/authorize?response_type=token&client_id=<ClientID> и скопируйте токен.',
        'y0_…',
      ),
    ],
    docs: [
      'https://yandex.ru/dev/metrika/ru/intro/authorization',
      'https://yandex.ru/dev/metrika/ru/stat/openapi/data_1',
      'https://yandex.ru/dev/metrika/ru/intro/quotas',
      'https://yandex.ru/dev/metrika/ru/stat/metrics/visits/ecommerce',
    ],
    keySource: 'OAuth-токен из своего приложения на oauth.yandex.ru (инструкция Метрики «Получение OAuth-токена»).',
    facts: ['sessions', 'users', 'web_purchases'],
    verifiedLive: false,
    exportHint: 'Отчёт Метрики «Посещаемость» (CSV/XLSX) — тип «Маркетинговый отчёт».',
  },
  shopify: {
    key: 'shopify',
    label: 'Shopify',
    category: 'platform',
    mode: 'live',
    authKind: 'token',
    fields: [
      {
        name: 'shop_domain',
        label: 'Домен магазина',
        target: 'setting',
        input: 'text',
        placeholder: 'myshop.myshopify.com',
        help: 'Адрес вида <магазин>.myshopify.com (не собственный домен).',
        pattern: /^[a-z0-9][a-z0-9-]{1,60}\.myshopify\.com$/,
        invalid: 'Нужен адрес вида myshop.myshopify.com',
        maxLength: 80,
      },
      tokenField(
        'Admin API access token (custom app)',
        'Только для уже созданного в админке Shopify custom app с доступом read_orders: Settings → Apps → Develop apps → приложение → API credentials. Новые такие приложения Shopify создавать больше не позволяет.',
        'shpat_…',
      ),
    ],
    docs: [
      'https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/generate-app-access-tokens-admin',
      'https://shopify.dev/docs/api/admin-graphql/latest/queries/ordersCount',
      'https://shopify.dev/docs/api/admin-graphql/latest/queries/orders',
      'https://shopify.dev/docs/api/usage/limits',
    ],
    keySource: 'Токен существующего admin-created custom app (X-Shopify-Access-Token). Для новых магазинов нужен OAuth — см. «Требуется» в документации.',
    facts: ['orders_count', 'orders_amount'],
    verifiedLive: false,
    exportHint: 'Orders → Export (CSV) — тип «Отчёт о продажах».',
  },
  insales: {
    key: 'insales',
    label: 'InSales',
    category: 'platform',
    mode: 'file',
    authKind: 'file',
    fields: [],
    docs: ['https://api.insales.ru/ (справочник методов доступен)', 'https://wiki.insales.ru (HTTP 403 из контура)'],
    keySource: 'Live-подключение пока недоступно — загрузите выгрузку заказов InSales.',
    facts: [],
    verifiedLive: false,
    blocked: {
      reason: 'Справочник api.insales.ru описывает методы и Basic-авторизацию, но не то, как продавец выпускает идентификатор и пароль доступа; страницы wiki.insales.ru о ключах API закрыты из контура (HTTP 403). Без фильтра по дате заказа (только updated_since) нужна полная инкрементальная выгрузка — её нельзя спроектировать без документации по лимитам и ключам.',
      requiredInput: 'Официальная инструкция InSales по выпуску ключа API (или OAuth-приложение InSales) и тестовый магазин с ключом.',
      howToUnblock: 'Открыть доступ к wiki.insales.ru / документации для разработчиков, получить ключ тестового магазина, затем написать адаптер. До этого — выгрузка заказов (CSV/XLSX).',
    },
    exportHint: 'Заказы → Экспорт (CSV/XLSX) — тип «Отчёт о продажах».',
  },
  tilda: {
    key: 'tilda',
    label: 'Tilda',
    category: 'platform',
    mode: 'file',
    authKind: 'file',
    fields: [],
    docs: ['https://help-ru.tilda.cc/api'],
    keySource: 'API Тильды отдаёт только страницы сайта — заказы загружайте выгрузкой.',
    facts: [],
    verifiedLive: false,
    blocked: {
      reason: 'Официальный API Тильды (help-ru.tilda.cc/api) отдаёт только проекты и страницы (getprojectslist, getpage …); заказов и аналитики в нём нет. Заказы Тильда передаёт вебхуком форм или в подключённую CRM.',
      requiredInput: 'Решение владельца: принимать заказы Тильды вебхуком (эндпоинт приёма + секрет) или через CRM клиента.',
      howToUnblock: 'Спроектировать приёмник вебхука форм Тильды по документации «Приём данных из форм», затем считать заказы как факты. До этого — выгрузка заявок из CRM Тильды (CSV).',
    },
    exportHint: 'CRM Тильды → Заявки → Экспорт (CSV) — тип «Отчёт о продажах».',
  },
  bitrix_shop: {
    key: 'bitrix_shop',
    label: '1С-Битрикс: интернет-магазин',
    category: 'platform',
    mode: 'file',
    authKind: 'file',
    fields: [],
    docs: ['https://dev.1c-bitrix.ru/rest_help/'],
    keySource: 'Live-подключение пока недоступно — загрузите выгрузку заказов. Сделки Битрикс24 подключаются в разделе CRM.',
    facts: [],
    verifiedLive: false,
    blocked: {
      reason: 'Коробочный сайт на 1С-Битрикс не имеет стандартного внешнего REST для заказов (модуль sale доступен через REST только в Битрикс24 / при установленном модуле REST и приложении). Сделки и контакты Битрикс24 уже подключаются в разделе CRM.',
      requiredInput: 'Тип установки клиента (Битрикс24-магазин или коробка), входящий вебхук с правами sale и тестовый магазин.',
      howToUnblock: 'Для Битрикс24-магазина — адаптер sale.order.list по dev.1c-bitrix.ru/rest_help с вебхуком клиента; для коробки — выгрузка заказов (CSV/XLSX).',
    },
    exportHint: 'Магазин → Заказы → Экспорт в Excel — тип «Отчёт о продажах».',
  },
  meta_ads: {
    key: 'meta_ads',
    label: 'Meta Ads (Facebook / Instagram)',
    category: 'ads',
    mode: 'file',
    authKind: 'file',
    fields: [],
    docs: ['https://developers.facebook.com/docs/marketing-api/insights/'],
    keySource: 'Live-подключение пока недоступно — загрузите отчёт Ads Manager.',
    facts: [],
    verifiedLive: false,
    blocked: {
      reason: 'Marketing API (Insights) требует приложение Meta с разрешением ads_read (Advanced Access после App Review) и токен пользователя или системного пользователя бизнеса. Приложения Meta с ads_read у платформы нет — текущее приложение Meta настроено только для WhatsApp.',
      requiredInput: 'Приложение Meta с одобренным ads_read, OAuth-вход (client id / secret в env) и рекламный аккаунт клиента для проверки.',
      howToUnblock: 'Владелец создаёт/расширяет приложение Meta, проходит App Review на ads_read, добавляет META_ADS_APP_ID/SECRET; затем OAuth-подключение и адаптер Insights. До этого — экспорт отчёта Ads Manager (CSV).',
    },
    exportHint: 'Ads Manager → Отчёты → Экспорт (CSV) — тип «Рекламный отчёт».',
  },
  yandex_direct: {
    key: 'yandex_direct',
    label: 'Яндекс Директ',
    category: 'ads',
    mode: 'file',
    authKind: 'file',
    fields: [],
    docs: [
      'https://yandex.ru/dev/direct/doc/ru/concepts/auth-token',
      'https://yandex.ru/dev/direct/doc/ru/reports',
      'https://yandex.ru/dev/direct/doc/ru/headers',
    ],
    keySource: 'Live-подключение пока недоступно — загрузите отчёт «Мастер отчётов».',
    facts: [],
    verifiedLive: false,
    blocked: {
      reason: 'Документация Директа требует зарегистрированное приложение с одобренной заявкой на доступ к API и получение токена в автоматическом режиме, если с приложением работают разные пользователи. Такого приложения (client id) у платформы нет.',
      requiredInput: 'Приложение Яндекс ID с одобренным доступом к API Директа (YANDEX_DIRECT_CLIENT_ID/SECRET), OAuth-вход и рекламный аккаунт клиента.',
      howToUnblock: 'Зарегистрировать приложение, подать заявку на доступ к API Директа, добавить ключи в env; затем OAuth-подключение и адаптер Reports (returnMoneyInMicros, офлайн-режим). До этого — выгрузка «Мастера отчётов» (CSV/XLSX).',
    },
    exportHint: 'Директ → Мастер отчётов → Скачать (CSV/XLSX) — тип «Рекламный отчёт».',
  },
  google_ads: {
    key: 'google_ads',
    label: 'Google Ads',
    category: 'ads',
    mode: 'file',
    authKind: 'file',
    fields: [],
    docs: ['https://developers.google.com/google-ads/api/docs/start'],
    keySource: 'Live-подключение пока недоступно — загрузите отчёт Google Ads.',
    facts: [],
    verifiedLive: false,
    blocked: {
      reason: 'Google Ads API требует developer token (выдаётся аккаунту управляющего после проверки Google) и OAuth 2.0-клиент приложения. Ни того, ни другого у платформы нет.',
      requiredInput: 'Developer token, OAuth-клиент Google (GOOGLE_ADS_CLIENT_ID/SECRET), управляющий аккаунт и аккаунт клиента для проверки.',
      howToUnblock: 'Владелец получает developer token и OAuth-клиент, добавляет их в env; затем OAuth-подключение и адаптер отчётов (GAQL). До этого — экспорт отчёта (CSV).',
    },
    exportHint: 'Google Ads → Отчёты → Скачать (CSV) — тип «Рекламный отчёт».',
  },
}

export function isProviderKey(v: unknown): v is ProviderKey {
  return typeof v === 'string' && (INTEGRATION_PROVIDER_KEYS as readonly string[]).includes(v)
}

export function providerDef(key: ProviderKey): ProviderDef {
  return INTEGRATION_PROVIDERS[key]
}

export function providerLabel(key: string): string {
  return isProviderKey(key) ? INTEGRATION_PROVIDERS[key].label : key
}

/** Public catalogue for the UI: no regexes, no functions. */
export interface ProviderCatalogItem {
  key: ProviderKey
  label: string
  category: ProviderCategory
  categoryLabel: string
  mode: 'live' | 'file'
  authKind: ProviderDef['authKind']
  fields: Array<Pick<CredentialField, 'name' | 'label' | 'target' | 'input' | 'placeholder' | 'help' | 'maxLength'>>
  docs: readonly string[]
  keySource: string
  verifiedLive: boolean
  blocked: BlockedInfo | null
  exportHint: string
}

export function providerCatalog(): ProviderCatalogItem[] {
  return INTEGRATION_PROVIDER_KEYS.map((k) => {
    const d = INTEGRATION_PROVIDERS[k]
    return {
      key: d.key,
      label: d.label,
      category: d.category,
      categoryLabel: CATEGORY_LABELS[d.category],
      mode: d.mode,
      authKind: d.authKind,
      fields: d.fields.map(({ name, label, target, input, placeholder, help, maxLength }) => ({ name, label, target, input, placeholder, help, maxLength })),
      docs: d.docs,
      keySource: d.keySource,
      verifiedLive: d.verifiedLive,
      blocked: d.blocked ?? null,
      exportHint: d.exportHint,
    }
  })
}

export type CredentialParse =
  | { ok: true; secret: Record<string, string>; settings: Record<string, string> }
  | { ok: false; error: string; field?: string }

/**
 * Validates a connect form against the provider's fields. Unknown fields are
 * ignored; every declared field is required. Values are trimmed.
 */
export function parseCredentials(key: ProviderKey, input: unknown): CredentialParse {
  const def = INTEGRATION_PROVIDERS[key]
  if (def.mode !== 'live') return { ok: true, secret: {}, settings: {} }
  const body = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const secret: Record<string, string> = {}
  const settings: Record<string, string> = {}
  for (const f of def.fields) {
    const raw = body[f.name]
    const v = typeof raw === 'string' ? raw.trim() : ''
    if (!v) return { ok: false, error: `Заполните поле «${f.label}»`, field: f.name }
    if (v.length > f.maxLength || !f.pattern.test(v)) return { ok: false, error: f.invalid, field: f.name }
    if (f.target === 'secret') secret[f.name] = v
    else settings[f.name] = v
  }
  return { ok: true, secret, settings }
}
