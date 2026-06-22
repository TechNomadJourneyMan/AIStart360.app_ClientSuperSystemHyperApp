/**
 * Payments entrypoint. Dispatches checkout creation to the correct acquiring
 * provider stub.
 *
 * Region guidance (default/recommended provider):
 *   - stripe        -> global / international cards (recommended default).
 *   - cloudpayments -> CIS cards.
 *   - kaspi         -> Kazakhstan (Kaspi.kz).
 *   - halyk         -> Kazakhstan (Halyk Bank / ePay).
 *   - mir           -> Russia (Mir cards).
 *
 * All providers are currently STUBS — they return a synthetic checkout session
 * pointing at /checkout/stub. No real money moves until the SDKs + webhooks are
 * wired in each providers/*.ts file.
 */

import type {
  AcquiringProviderName,
  CheckoutParams,
  CheckoutSession,
} from './types'
import { createCheckoutSession as stripe } from './providers/stripe'
import { createCheckoutSession as cloudpayments } from './providers/cloudpayments'
import { createCheckoutSession as kaspi } from './providers/kaspi'
import { createCheckoutSession as halyk } from './providers/halyk'
import { createCheckoutSession as mir } from './providers/mir'

type ProviderFn = (p: CheckoutParams) => Promise<CheckoutSession>

const PROVIDERS: Record<AcquiringProviderName, ProviderFn> = {
  stripe,
  cloudpayments,
  kaspi,
  halyk,
  mir,
}

/** Recommended default provider for international/global cards. */
export const DEFAULT_PROVIDER: AcquiringProviderName = 'stripe'

/** Resolve a provider's checkout function. Throws on unknown provider names. */
export function getProvider(name: AcquiringProviderName): ProviderFn {
  const fn = PROVIDERS[name]
  if (!fn) {
    throw new Error(`Unknown acquiring provider: ${String(name)}`)
  }
  return fn
}

/** Create a checkout session with the given provider. */
export function createCheckout(
  name: AcquiringProviderName,
  params: CheckoutParams,
): Promise<CheckoutSession> {
  return getProvider(name)(params)
}

export { PLANS, getPlan } from './plans'
export type { Plan, PlanKey, PlanInterval, PlanKind } from './plans'
export type {
  AcquiringProviderName,
  CheckoutParams,
  CheckoutSession,
} from './types'
