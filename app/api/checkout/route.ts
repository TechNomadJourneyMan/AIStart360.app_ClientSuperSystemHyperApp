export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import {
  createCheckout,
  getPlan,
  DEFAULT_PROVIDER,
  type AcquiringProviderName,
} from '@/lib/payments'

const VALID_PROVIDERS: AcquiringProviderName[] = [
  'stripe',
  'cloudpayments',
  'kaspi',
  'halyk',
  'mir',
]

/**
 * Resolve the billing org id for the authenticated Supabase user.
 *
 * The Prisma `subscription` / `paymentTransaction` tables key on `orgId`. In the
 * live Supabase schema the per-user tenant is `companies.id` (keyed by
 * `user_id`). We use that as the org id when present, otherwise fall back to the
 * auth user id so a brand-new account can still start a checkout.
 */
async function resolveOrgId(
  sb: ReturnType<typeof createServerClient>,
  userId: string,
): Promise<string> {
  try {
    const { data } = await sb
      .from('companies')
      .select('id')
      .eq('user_id', userId)
      .order('id', { ascending: true })
      .limit(1)
      .maybeSingle()
    const id = (data?.id as string | undefined) ?? null
    if (id) return id
  } catch {
    // companies table unavailable — fall back to the user id below.
  }
  return userId
}

/**
 * POST /api/checkout
 * Body: { planKey: string, provider?: AcquiringProviderName }
 *
 * - Authenticates the user via the Supabase session.
 * - Resolves the billing org id.
 * - Trial plan → upserts a trialing subscription and returns { checkoutUrl: '/dashboard' }.
 * - Paid plan → creates an acquiring checkout (stub), records a payment
 *   transaction, and returns the provider's checkoutUrl.
 *
 * All DB writes are wrapped so a not-yet-migrated table degrades gracefully
 * (the checkout still resolves to a usable URL) instead of returning a 500.
 */
export async function POST(req: NextRequest) {
  // Resolve the session. A missing/misconfigured Supabase client (e.g. env vars
  // not set) is treated as "not authenticated" → 401, never a 500.
  let sb: ReturnType<typeof createServerClient>
  let user: Awaited<ReturnType<ReturnType<typeof createServerClient>['auth']['getUser']>>['data']['user'] = null
  try {
    sb = createServerClient()
    const { data } = await sb.auth.getUser()
    user = data.user
  } catch (err) {
    console.warn('[api/checkout] auth unavailable:', err)
    return NextResponse.json(
      { error: 'Требуется вход в аккаунт', loginUrl: '/login?from=/' },
      { status: 401 },
    )
  }

  if (!user) {
    return NextResponse.json(
      { error: 'Требуется вход в аккаунт', loginUrl: '/login?from=/' },
      { status: 401 },
    )
  }

  try {

    let body: { planKey?: string; provider?: string }
    try {
      body = (await req.json()) as { planKey?: string; provider?: string }
    } catch {
      return NextResponse.json({ error: 'Некорректный запрос' }, { status: 400 })
    }

    const planKey = body.planKey
    if (!planKey) {
      return NextResponse.json({ error: 'Не указан тариф (planKey)' }, { status: 400 })
    }

    const plan = getPlan(planKey)
    if (!plan) {
      return NextResponse.json({ error: `Неизвестный тариф: ${planKey}` }, { status: 400 })
    }

    const provider: AcquiringProviderName =
      body.provider && VALID_PROVIDERS.includes(body.provider as AcquiringProviderName)
        ? (body.provider as AcquiringProviderName)
        : DEFAULT_PROVIDER

    const orgId = await resolveOrgId(sb, user.id)
    const customerEmail = user.email ?? undefined

    // ── Trial: no payment, just provision a trialing subscription ──────────
    if (plan.kind === 'trial') {
      const trialDays = plan.trialDays ?? 30
      const trialEndsAt = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000)
      try {
        const { prisma } = await import('@/lib/db')
        await prisma.subscription.upsert({
          where: { orgId },
          create: {
            orgId,
            tier: 'pilot',
            status: 'trialing',
            trialEndsAt,
          },
          update: {
            tier: 'pilot',
            status: 'trialing',
            trialEndsAt,
          },
        })
      } catch (err) {
        // Subscription table not yet migrated — still let the user into the
        // pilot. The trial is a stub today; the dashboard renders regardless.
        console.warn('[api/checkout] subscription upsert skipped:', err)
      }
      return NextResponse.json({ checkoutUrl: '/dashboard' })
    }

    // ── Paid plans (subscription or one-time) → acquiring checkout ─────────
    const session = await createCheckout(provider, {
      orgId,
      planKey,
      amount: plan.amount,
      currency: plan.currency,
      successUrl: '/checkout/success?plan=' + encodeURIComponent(planKey),
      cancelUrl: '/checkout/cancel',
      customerEmail,
    })

    // Record the (stub) transaction. Non-fatal if the table is missing.
    try {
      const { prisma } = await import('@/lib/db')
      await prisma.paymentTransaction.create({
        data: {
          orgId,
          provider,
          amount: plan.amount,
          currency: plan.currency,
          planKey,
          status: session.status === 'pending' ? 'pending' : 'stub',
          externalId: session.sessionId,
          metadata: {
            kind: plan.kind,
            sessionId: session.sessionId,
            ...(session.orderId ? { orderId: session.orderId } : {}),
            ...(typeof session.amountKzt === 'number' ? { amountKzt: session.amountKzt } : {}),
          },
        },
      })
    } catch (err) {
      console.warn('[api/checkout] paymentTransaction insert skipped:', err)
    }

    return NextResponse.json({ checkoutUrl: session.checkoutUrl })
  } catch (err) {
    console.error('[api/checkout] POST error:', err)
    const msg = err instanceof Error ? err.message : ''
    if (msg.startsWith('kaspi_kzt_only')) {
      return NextResponse.json(
        { error: 'Оплата через Kaspi доступна только в тенге — тариф ещё не сконфигурирован для KZT.' },
        { status: 503 },
      )
    }
    if (msg.startsWith('kaspi_api_error')) {
      return NextResponse.json(
        { error: 'Платёжный сервис Kaspi временно недоступен. Попробуйте позже.' },
        { status: 502 },
      )
    }
    return NextResponse.json(
      { error: 'Не удалось создать оплату. Попробуйте позже.' },
      { status: 500 },
    )
  }
}
