/**
 * Kaspi.kz acquiring provider (первый реальный провайдер — решение ПО 2026-07-10).
 *
 * Честная деградация: пока Kaspi-мерчант не сконфигурирован через env, провайдер
 * возвращает прежнюю stub-сессию (/checkout/stub) — ничего не ломается и деньги
 * не двигаются. Как только заданы все переменные ниже, создаётся реальный платёж.
 *
 * ENV-контракт (значения выдаёт Kaspi при подключении интернет-эквайринга;
 * пути/поля запроса сверить с актуальной версией мерчант-документации Kaspi Pay):
 *   KASPI_API_BASE       — базовый URL API (например https://api.smartpay.kaspi.kz)
 *   KASPI_MERCHANT_ID    — идентификатор мерчанта (TradePoint / OrganizationBin)
 *   KASPI_API_KEY        — API-ключ (Bearer)
 *   KASPI_WEBHOOK_SECRET — секрет подписи callback'ов (см. app/api/webhooks/kaspi)
 *   KASPI_USD_KZT_RATE   — опционально: курс конвертации USD-тарифов в KZT
 *                          (Kaspi принимает только KZT; без курса USD-тариф
 *                          честно отклоняется, а не «угадывается»)
 *
 * Деньги: каталог тарифов хранит минорные единицы (центы). Kaspi ждёт сумму в
 * тенге (KZT); мы отправляем целые тенге, округляя вверх (в пользу не-недоплаты).
 */

import { randomBytes, randomUUID } from 'crypto'
import type { CheckoutParams, CheckoutSession } from '../types'

const TIMEOUT_MS = 15_000

export function isKaspiConfigured(): boolean {
  return Boolean(
    process.env.KASPI_API_BASE &&
      process.env.KASPI_MERCHANT_ID &&
      process.env.KASPI_API_KEY,
  )
}

function appOrigin(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.AUTH_URL ||
    'http://localhost:3000'
  ).replace(/\/$/, '')
}

/** Convert catalog minor units to whole KZT. Returns null when not convertible. */
function toKzt(amountMinor: number, currency: string): number | null {
  if (currency === 'KZT') return Math.ceil(amountMinor / 100)
  if (currency === 'USD') {
    const rate = Number(process.env.KASPI_USD_KZT_RATE)
    if (!Number.isFinite(rate) || rate <= 0) return null
    return Math.ceil((amountMinor / 100) * rate)
  }
  return null
}

function stubSession(planKey: string): CheckoutSession {
  return {
    provider: 'kaspi',
    sessionId: 'stub_' + randomBytes(12).toString('hex'),
    checkoutUrl: '/checkout/stub?provider=kaspi&plan=' + planKey,
    status: 'stub',
  }
}

export async function createCheckoutSession(
  p: CheckoutParams,
): Promise<CheckoutSession> {
  if (!isKaspiConfigured()) {
    // Мерчант ещё не подключён — прежнее stub-поведение, без сюрпризов.
    return stubSession(p.planKey)
  }

  const amountKzt = toKzt(p.amount, p.currency)
  if (amountKzt === null) {
    throw new Error(
      `kaspi_kzt_only: тариф в ${p.currency} не может быть оплачен через Kaspi — задайте KASPI_USD_KZT_RATE или KZT-цену тарифа`,
    )
  }

  const base = (process.env.KASPI_API_BASE as string).replace(/\/$/, '')
  const orderId = randomUUID()
  const origin = appOrigin()

  const res = await fetch(`${base}/api/v1/payments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.KASPI_API_KEY}`,
    },
    body: JSON.stringify({
      merchantId: process.env.KASPI_MERCHANT_ID,
      orderId,
      amount: amountKzt,
      currency: 'KZT',
      description: `AIStart360 · тариф ${p.planKey}`,
      returnUrl: `${origin}${p.successUrl}`,
      failUrl: `${origin}${p.cancelUrl}`,
      ...(p.customerEmail ? { customerEmail: p.customerEmail } : {}),
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: 'no-store',
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`kaspi_api_error: HTTP ${res.status} ${text.slice(0, 300)}`)
  }

  const data = (await res.json().catch(() => null)) as
    | { paymentId?: string; id?: string; paymentUrl?: string; url?: string; redirectUrl?: string }
    | null
  const paymentId = data?.paymentId ?? data?.id
  const paymentUrl = data?.paymentUrl ?? data?.url ?? data?.redirectUrl
  if (!paymentId || !paymentUrl) {
    throw new Error('kaspi_api_error: ответ без paymentId/paymentUrl — сверьте контракт API')
  }

  return {
    provider: 'kaspi',
    sessionId: String(paymentId),
    checkoutUrl: String(paymentUrl),
    status: 'pending',
    orderId,
    amountKzt,
  }
}

/** Poll a payment's status (reconciliation fallback when a webhook is missed). */
export async function getPaymentStatus(
  paymentId: string,
): Promise<'pending' | 'succeeded' | 'failed' | 'unknown'> {
  if (!isKaspiConfigured()) return 'unknown'
  const base = (process.env.KASPI_API_BASE as string).replace(/\/$/, '')
  try {
    const res = await fetch(`${base}/api/v1/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: `Bearer ${process.env.KASPI_API_KEY}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    })
    if (!res.ok) return 'unknown'
    const data = (await res.json().catch(() => null)) as { status?: string } | null
    const s = (data?.status ?? '').toLowerCase()
    if (['success', 'succeeded', 'paid', 'processed', 'completed'].includes(s)) return 'succeeded'
    if (['failed', 'canceled', 'cancelled', 'declined', 'error', 'expired'].includes(s)) return 'failed'
    if (s) return 'pending'
    return 'unknown'
  } catch {
    return 'unknown'
  }
}
