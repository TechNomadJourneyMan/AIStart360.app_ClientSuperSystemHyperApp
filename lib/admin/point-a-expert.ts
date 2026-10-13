import { NextResponse, type NextRequest } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requireGiga, type GigaActor } from '@/lib/admin/giga-actor'
import { guardClientAccess } from '@/lib/admin/client-scope'
import { createServiceClient } from '@/lib/supabase-service'

/**
 * lib/admin/point-a-expert.ts — the common gate of the expert's Point A routes
 * in User 360 (/api/giga-admin/users/:id/point-a/v4/*, spec 2026-10-12 §7).
 *
 *   read   users.view + users.sensitive (the same as the old Point A tab):
 *          Point A carries the company's money figures
 *   write  clients.review, and only on a client account (not on staff)
 *
 * Then the client scope of the actor («только назначенные») and the company of
 * the user (companies.user_id). Writes go through the service role: the panel
 * has no Supabase session of the client, the identity is the actor.
 */

export type PointAExpertGuard =
  | { response: NextResponse; actor?: undefined; sb?: undefined; companyId?: undefined }
  | { response?: undefined; actor: GigaActor; sb: SupabaseClient; companyId: string }

export const NO_COMPANY_ERROR = 'У пользователя нет компании'

export async function guardPointAExpert(req: NextRequest, userId: string, mode: 'read' | 'write'): Promise<PointAExpertGuard> {
  const guard = await requireGiga(req, mode === 'write' ? 'clients.review' : ['users.view', 'users.sensitive'])
  if (guard.response) return { response: guard.response }
  const scopeDenied = await guardClientAccess(guard.actor, userId, mode === 'write' ? { clientOnly: true } : {})
  if (scopeDenied) return { response: scopeDenied }

  const sb = createServiceClient()
  const { data, error } = await sb.from('companies').select('id').eq('user_id', userId).maybeSingle()
  if (error) return { response: NextResponse.json({ ok: false, error: 'Не удалось найти компанию пользователя' }, { status: 500 }) }
  const companyId = (data as { id?: string } | null)?.id
  if (!companyId) return { response: NextResponse.json({ ok: false, error: NO_COMPANY_ERROR }, { status: 404 }) }
  return { actor: guard.actor, sb, companyId }
}

/** The name the client sees under the expert's note: the profile name, else the email. */
export async function staffDisplayName(sb: SupabaseClient, actor: Pick<GigaActor, 'id' | 'email'>): Promise<string> {
  const { data } = await sb.from('profiles').select('full_name, email').eq('id', actor.id).maybeSingle()
  const p = data as { full_name?: string | null; email?: string | null } | null
  return p?.full_name?.trim() || p?.email?.trim() || actor.email || 'Эксперт AIStart360'
}

export function badRequest(error: string, status = 400): NextResponse {
  return NextResponse.json({ ok: false, error }, { status })
}

/** First zod issue as a Russian message (the schemas carry their own). */
export function zodMessage(issues: Array<{ message: string }>): string {
  const m = issues[0]?.message
  return m && /[а-яё]/i.test(m) ? m : 'Неверный запрос'
}
