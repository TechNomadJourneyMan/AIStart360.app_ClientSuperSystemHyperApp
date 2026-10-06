/**
 * Authorisation of the client integration routes (/api/integrations/**):
 * the caller's session + lib/tenancy. Reading needs can_read_company; any
 * change (connect, test with the stored key, disconnect) needs
 * can_manage_company — the owner or a company admin. Errors never confirm
 * that another company exists (404 for a foreign companyId).
 */
import { NextResponse, type NextRequest } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { resolveTenantWith, tenantErrorMessage, type TenantContext } from '@/lib/tenancy'
import { isProviderKey, type ProviderKey } from './registry'

export type ClientAuth =
  | { ok: true; tenant: TenantContext; supabase: SupabaseClient }
  | { ok: false; response: NextResponse }

export async function authorizeClient(req: NextRequest, access: 'read' | 'manage'): Promise<ClientAuth> {
  const supabase = (await createClient()) as unknown as SupabaseClient
  const { data: { user } } = await supabase.auth.getUser()
  const companyId = req.nextUrl.searchParams.get('companyId')
  const resolved = await resolveTenantWith(supabase, user?.id ?? null, { companyId, access })
  if (!resolved.ok) {
    return { ok: false, response: NextResponse.json({ ok: false, error: tenantErrorMessage(resolved.error), code: resolved.error }, { status: resolved.status }) }
  }
  return { ok: true, tenant: resolved.tenant, supabase }
}

export function providerParam(raw: string): ProviderKey | null {
  return isProviderKey(raw) ? raw : null
}

export function unknownProvider(): NextResponse {
  return NextResponse.json({ ok: false, error: 'Неизвестная интеграция' }, { status: 404 })
}

export function serverError(scope: string, err: unknown): NextResponse {
  console.error(`[${scope}]`, err instanceof Error ? err.message.split('\n')[0] : 'error')
  return NextResponse.json({ ok: false, error: 'Внутренняя ошибка' }, { status: 500 })
}
