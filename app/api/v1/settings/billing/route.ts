import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { srGet } from '@/lib/expert-auth'

// Self-scoped read of the caller's subscription for Settings › Биллинг.
// `subscriptions.orgId` is a free-form tenant key = companies.id OR the auth
// user id (see the Prisma model note). We resolve the tenant id(s) from the
// SESSION only — never from client input — then read via service role (the
// table has no self-read RLS policy). 2026-07-02.
export const dynamic = 'force-dynamic'

interface SubscriptionRow {
  orgId: string
  tier: string
  status: string
  provider: string | null
  trialEndsAt: string | null
  currentPeriodEnd: string | null
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  // Tenant key(s): the caller's company id (if any) + their user id.
  const companies = await srGet<Array<{ id: string }>>(
    `companies?user_id=eq.${user.id}&select=id&limit=1`,
  )
  const tenantIds = [companies?.[0]?.id, user.id].filter((v): v is string => Boolean(v))
  if (tenantIds.length === 0) return NextResponse.json({ ok: true, data: null })

  const inList = tenantIds.map((id) => `"${id}"`).join(',')
  const rows = await srGet<SubscriptionRow[]>(
    `subscriptions?orgId=in.(${inList})&select=orgId,tier,status,provider,trialEndsAt,currentPeriodEnd&order=updatedAt.desc&limit=1`,
  )

  return NextResponse.json({ ok: true, data: rows?.[0] ?? null })
}
