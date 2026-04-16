export const dynamic = 'force-dynamic'
// TEMPORARY DEBUG — remove after diagnosis
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

export async function GET() {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()

  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '')
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  const keyUsed = serviceKey || anonKey || ''
  let profilesResult: unknown = null
  let profilesError: string | null = null

  if (user && supabaseUrl && keyUsed) {
    try {
      const res = await fetch(
        `${supabaseUrl}/rest/v1/profiles?id=eq.${user.id}&select=id,role&limit=1`,
        { headers: { apikey: keyUsed, Authorization: `Bearer ${keyUsed}` }, cache: 'no-store' }
      )
      const body = await res.text()
      profilesResult = { status: res.status, body }
    } catch (e) {
      profilesError = String(e)
    }
  }

  return NextResponse.json({
    userId: user?.id ?? null,
    hasSupabaseUrl: !!supabaseUrl,
    supabaseUrlPrefix: supabaseUrl.slice(0, 30),
    hasServiceKey: !!serviceKey,
    serviceKeyLen: serviceKey?.length ?? 0,
    hasAnonKey: !!anonKey,
    keyUsedLen: keyUsed.length,
    profilesResult,
    profilesError,
  })
}
