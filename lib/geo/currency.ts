// ── ГЕО-ВАЛЮТА (№18) ──────────────────────────────────────────────────────
// Каталог PLANS хранит цены в USD (minor units). Для витрины конвертируем в
// валюту региона по стране посетителя (lib/geo/country.ts): KZ → ₸, RU/BY → ₽,
// остальные страны → $. Страна не определена (локально, закрытая сеть) →
// fallback ₸.
// Курсы — статические витринные ориентиры (не биржевые), суммы для не-USD
// показываются с «≈»; списание в USD по курсу на день оплаты (см. сноску).
export type GeoCurrency = { code: 'USD' | 'KZT' | 'RUB'; symbol: string; perUsd: number }

export const GEO_CURRENCIES: Record<GeoCurrency['code'], GeoCurrency> = {
  USD: { code: 'USD', symbol: '$', perUsd: 1 },
  KZT: { code: 'KZT', symbol: '₸', perUsd: 520 },
  RUB: { code: 'RUB', symbol: '₽', perUsd: 95 },
}

/** Витринная валюта для кода страны (ISO 3166-1 alpha-2, регистр не важен). */
export function currencyForCountry(country: string | null): GeoCurrency {
  if (!country) return GEO_CURRENCIES.KZT // fallback — ₸
  const c = country.toUpperCase()
  if (c === 'KZ') return GEO_CURRENCIES.KZT
  if (c === 'RU' || c === 'BY') return GEO_CURRENCIES.RUB
  return GEO_CURRENCIES.USD
}
