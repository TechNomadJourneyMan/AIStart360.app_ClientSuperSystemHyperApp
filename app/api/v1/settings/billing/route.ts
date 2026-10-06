import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { BillingError, getEffectivePlan } from '@/lib/payments/billing'

// Self-scoped read of the caller's effective plan for Settings › Биллинг.
// The person comes from the SESSION only — never from client input. The plan
// is the unified one (lib/payments/billing.ts): subscriptions under either
// tenant key (companies.id or the user id) + profiles.tier, so a plan assigned
// by an administrator in GIGA is shown exactly like a paid one.
export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const plan = await getEffectivePlan({ userId: user.id })
    // The administrator's note is internal: it never reaches the client.
    return NextResponse.json({
      ok: true,
      data: {
        tier: plan.tier,
        status: plan.status,
        periodEnd: plan.periodEnd,
        source: plan.source,
        provider: plan.provider,
        accessTier: plan.accessTier,
      },
    })
  } catch (e) {
    console.error('[settings/billing]', e instanceof BillingError ? e.code : e)
    return NextResponse.json({ ok: false, error: 'Не удалось загрузить данные тарифа' }, { status: 503 })
  }
}
