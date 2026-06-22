// STUB: real Halyk acquiring integration pending. Wire SDK + webhooks here.
import { randomBytes } from 'crypto'
import type { CheckoutParams, CheckoutSession } from '../types'

export async function createCheckoutSession(
  p: CheckoutParams,
): Promise<CheckoutSession> {
  return {
    provider: 'halyk',
    sessionId: 'stub_' + randomBytes(12).toString('hex'),
    checkoutUrl: '/checkout/stub?provider=halyk&plan=' + p.planKey,
    status: 'stub',
  }
}
