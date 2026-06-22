/**
 * Payment/acquiring type contracts. Money is always expressed in integer minor
 * units (e.g. cents for USD, tiyn for KZT) to avoid floating-point/Decimal drift.
 */

export type AcquiringProviderName =
  | 'stripe'
  | 'cloudpayments'
  | 'kaspi'
  | 'halyk'
  | 'mir'

export interface CheckoutParams {
  orgId: string
  /** Key from the PLANS catalog (e.g. "pilot", "pro_monthly", "pro_onetime"). */
  planKey: string
  /** Amount in integer minor units (e.g. 30000 = $300.00). */
  amount: number
  /** ISO 4217 currency code, e.g. "USD", "KZT". */
  currency: string
  successUrl: string
  cancelUrl: string
  customerEmail?: string
}

export interface CheckoutSession {
  provider: AcquiringProviderName
  sessionId: string
  checkoutUrl: string
  status: 'stub'
}
