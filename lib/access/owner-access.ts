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
