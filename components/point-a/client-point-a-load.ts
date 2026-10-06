/**
 * Loader of the client «Точка А» page (app/client/point-a): the current
 * diagnostic and the company card.
 *
 * A failed diagnostic load (HTTP error, `ok: false`, non-JSON body such as a
 * 502 page, network) is an ERROR — the page shows it with «Повторить» instead
 * of silently dropping every level-2 section as if there were no diagnostic.
 * `diagnostic: null` with ok means there really is none yet. The company card
 * only feeds the greeting, so its failure is not fatal.
 */
import type { Diagnostic } from '@/types/onboarding'

export interface ClientCompanyCard { id?: string | number; name: string; industry: string | null; employee_count: number | null }

export type ClientPointALoad =
  | { ok: true; diagnostic: Diagnostic | null; company: ClientCompanyCard | null }
  | { ok: false; error: string; company: ClientCompanyCard | null }

export const DIAGNOSTIC_LOAD_ERROR = 'Не удалось загрузить диагностику.'
export const DIAGNOSTIC_SESSION_ERROR = 'Сессия истекла — войдите заново, чтобы увидеть диагностику.'

async function readJson(res: Response): Promise<{ ok?: boolean; data?: unknown } | null> {
  try {
    return (await res.json()) as { ok?: boolean; data?: unknown } | null
  } catch {
    return null
  }
}

export async function loadClientPointA(userId: string, fetchImpl: typeof fetch = fetch): Promise<ClientPointALoad> {
  const q = encodeURIComponent(userId)
  const [diagRes, compRes] = await Promise.all([
    fetchImpl(`/api/v1/diagnostics/current?user_id=${q}`).catch(() => null),
    fetchImpl(`/api/v1/onboarding/company?user_id=${q}`).catch(() => null),
  ])
  const comp = compRes && compRes.ok ? await readJson(compRes) : null
  const company = comp?.ok && comp.data ? (comp.data as ClientCompanyCard) : null

  if (!diagRes) return { ok: false, error: DIAGNOSTIC_LOAD_ERROR, company }
  if (diagRes.status === 401) return { ok: false, error: DIAGNOSTIC_SESSION_ERROR, company }
  const diag = diagRes.ok ? await readJson(diagRes) : null
  if (!diag?.ok) return { ok: false, error: DIAGNOSTIC_LOAD_ERROR, company }
  return { ok: true, diagnostic: (diag.data as Diagnostic | null) ?? null, company }
}
