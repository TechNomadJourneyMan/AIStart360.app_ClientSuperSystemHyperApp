// STUB: real Kaspi acquiring integration pending. Wire SDK + webhooks here.
import { randomBytes } from 'crypto'
import type { CheckoutParams, CheckoutSession } from '../types'

export async function createCheckoutSession(
  p: CheckoutParams,
): Promise<CheckoutSession> {
  return {
    provider: 'kaspi',
    sessionId: 'stub_' + randomBytes(12).toString('hex'),
    checkoutUrl: '/checkout/stub?provider=kaspi&plan=' + p.planKey,
    status: 'stub',
  }
}
