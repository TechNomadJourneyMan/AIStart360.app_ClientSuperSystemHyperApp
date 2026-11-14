/**
 * lib/access/owner-access.ts — is a paid section open for the OWNER of shared
 * data (R2-C, M-4 and the old share links)?
 *
 * Public links have no session of their own: /r/<token> (share of Точка А / Б /
 * GRI / анкеты) and /r/v/<token> (one published version of the expert's report)
 * open the data of a company. The PO's rule: such a link shows the data only
 * while the section is open for the company's owner (companies.user_id) NOW —
 * the same decision the cabinet makes for him (lib/access/decision.ts: the
 * access_gates switch, his tariff + override, the tariff of a company he is a
 * member of; staff do not count — the owner is a client). Closed → the page is
 * the honest «Ссылка недоступна» without the data. The links are not deleted:
 * they open again when the access is opened.
 *
 * Fail closed: any failure of the decision → the link shows nothing.
 */
import { createServiceClient } from '@/lib/supabase-service'
import { getAccessGatesEnabled } from '@/lib/settings/system-settings'
import { sectionClosedFor } from './recipient'
import type { PaidSection } from './entitlements'

/** Section of a share link type (lib/share/tokens.ts SharedReportType); null — free (анкета). */
export function shareSection(type: string): PaidSection | null {
  if (type === 'point_a') return 'point_a'
  if (type === 'point_b') return 'point_b'
  if (type === 'gri') return 'gri_full'
  return null
}

/**
 * The expert's report (every report_versions.report_type) is part of Точка А —
 * decision of the PO (M-4): one right, `point_a`, for the report, its PDF, its
 * links and the expert's comments.
 */
export const REPORT_SECTION: PaidSection = 'point_a'

/** Is `section` open for this owner right now? No owner → open only while the gates are off. */
export async function ownerSectionOpen(ownerId: string | null | undefined, section: PaidSection): Promise<boolean> {
  try {
    if (!ownerId) return !(await getAccessGatesEnabled())
    return !(await sectionClosedFor(ownerId, section))
  } catch {
    return false
  }
}

/** The owner (companies.user_id) of a company; null when unknown. Throws on a DB error. */
async function companyOwner(companyId: string): Promise<string | null> {
  const { data, error } = await createServiceClient().from('companies').select('user_id').eq('id', companyId).maybeSingle()
  if (error) throw new Error('company owner unavailable')
  return ((data as { user_id?: string | null } | null)?.user_id ?? null) || null
}

/** `section` for the owner of the company `companyId` (fail closed). */
export async function companyOwnerSectionOpen(companyId: string, section: PaidSection): Promise<boolean> {
  try {
    return await ownerSectionOpen(await companyOwner(companyId), section)
  } catch {
    return false
  }
}

/**
 * R2-C (review F8 / L-7): the same decision for the OWNERS of many companies in
 * ONE call — SQL paid_sections_for_owners (migration 148, the same rule as
 * has_paid_section, service role only). For the expert / GIGA review queues
 * and the expert bot («клиент на бесплатном тарифе»).
 * Returns companyId → open; a company that is not in the map is UNKNOWN (a
 * failed read, an absent company): the caller shows no note — never a
 * misleading «free tariff» on a database error.
 */
export async function companiesOwnerSectionOpen(companyIds: readonly string[], section: PaidSection): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>()
  const ids = Array.from(new Set(companyIds.filter((id) => typeof id === 'string' && id.length > 0)))
  if (ids.length === 0) return out
  try {
    const { data, error } = await createServiceClient().rpc('paid_sections_for_owners', { p_company_ids: ids, p_section: section })
    if (error || !Array.isArray(data)) return out
    for (const row of data as Array<{ company_id?: unknown; open?: unknown }>) {
      if (typeof row.company_id === 'string' && typeof row.open === 'boolean') out.set(row.company_id, row.open)
    }
  } catch {
    /* unknown for all */
  }
  return out
}

/** Companies whose owner has the section CLOSED (unknown ones are not included). */
export async function companiesWithClosedSection(companyIds: readonly string[], section: PaidSection): Promise<Set<string>> {
  const open = await companiesOwnerSectionOpen(companyIds, section)
  return new Set(Array.from(open.entries()).filter(([, v]) => !v).map(([id]) => id))
}
