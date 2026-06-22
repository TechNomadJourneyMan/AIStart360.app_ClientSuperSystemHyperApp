// STUB: real Stripe acquiring integration pending. Wire SDK + webhooks here.
import { randomBytes } from 'crypto'
import type { CheckoutParams, CheckoutSession } from '../types'

export async function createCheckoutSession(
  p: CheckoutParams,
): Promise<CheckoutSession> {
  return {
    provider: 'stripe',
    sessionId: 'stub_' + randomBytes(12).toString('hex'),
    checkoutUrl: '/checkout/stub?provider=stripe&plan=' + p.planKey,
    status: 'stub',
  }
}
