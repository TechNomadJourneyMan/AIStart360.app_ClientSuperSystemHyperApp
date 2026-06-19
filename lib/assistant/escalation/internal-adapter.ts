/**
 * lib/assistant/escalation/internal-adapter.ts — PRIMARY escalation channel.
 *
 * Always enabled. Two jobs, both fire-and-forget:
 *
 *   1. Persist the case to public.expert_cases via the SERVICE ROLE. The table's
 *      RLS only grants owners INSERT on their own rows; on prod the assistant may
 *      run in contexts where an owner-scoped insert silently no-ops (same hazard
 *      documented in app/api/v1/diagnostics/point-b/ai-generate/route.ts for
 *      point_b_analysis). Writing with the service-role key guarantees the insert
 *      regardless of RLS.
 *
 *   2. Notify staff by reusing the existing dispatcher:
 *      notifyAdmins('expert_case_created', { title, priority, triggerType,
 *      userMessage, caseId }, userId). caseId is included so the notifications
 *      rate-limit dedupe key differentiates one expert case from another (see
 *      rateLimitKey in lib/notifications.ts).
 *
 * Mirrors the lib/expert-auth.ts service-role pattern (srBase/key), but adds a
 * POST helper since expert-auth only exposes srGet.
 */

import type { ExpertCase } from '../types'
import type { EscalationAdapter } from './adapter'
import { notifyAdmins } from '@/lib/notifications'

// ─── Service-role REST (mirrors lib/expert-auth.ts srBase/srGet) ────────────

function srBase() {
  return {
    url: (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, ''),
    key: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
  }
}

/**
 * POST a single row via the service role and return the inserted representation.
 * Uses `Prefer: return=representation` so we can recover the DB-assigned UUID.
 * Returns null (and logs) on any failure — callers must tolerate a missing id.
 */
async function srPost<T = unknown>(
  path: string,
  body: Record<string, unknown>,
): Promise<T | null> {
  const { url, key } = srBase()
  if (!url || !key) {
    console.error('[escalation/internal] missing Supabase service-role env')
    return null
  }
  try {
    const res = await fetch(`${url}/rest/v1/${path}`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    })
    if (!res.ok) {
      console.error('[escalation/internal] srPost', res.status, path, await res.text().catch(() => ''))
      return null
    }
    return (await res.json().catch(() => null)) as T | null
  } catch (err) {
    console.error('[escalation/internal] srPost error:', err)
    return null
  }
}

// ─── Adapter ────────────────────────────────────────────────────────────────

interface InsertedRow {
  id?: string
}

export class InternalEscalationAdapter implements EscalationAdapter {
  readonly name = 'internal'

  /** Always on — this is the canonical persistence + admin-alert channel. */
  isEnabled(): boolean {
    return true
  }

  async notify(c: ExpertCase): Promise<void> {
    // 1. Persist via service role (bypasses owner-write RLS). The DB column
    //    names are snake_case (migration 032); map from the camelCase ExpertCase.
    //    Omit `id` so the table default (gen_random_uuid()) assigns a real UUID;
    //    the temp client-side id on `c` is never written.
    const row: Record<string, unknown> = {
      user_id: c.userId,
      company_id: c.companyId ?? null,
      diagnostic_id: c.diagnosticId ?? null,
      status: c.status,
      priority: c.priority,
      trigger_type: c.triggerType,
      title: c.title,
      summary: c.summary ?? null,
      detected_issues: c.detectedIssues ?? [],
      user_message: c.userMessage ?? null,
      assistant_recommendation: c.assistantRecommendation ?? null,
      expert_action_recommended: c.expertActionRecommended ?? null,
    }

    const inserted = await srPost<InsertedRow[]>('expert_cases', row)
    const caseId = Array.isArray(inserted) ? inserted[0]?.id : undefined

    // Reflect the canonical id back onto the in-memory case so the dispatcher's
    // caller (createExpertCase) returns the persisted UUID when available.
    if (caseId) c.id = caseId

    // 2. Notify staff. `caseId` differentiates the notifications rate-limit
    //    dedupe key so two distinct escalations for the same user both fire.
    //    notifyAdmins is itself fire-and-forget (logs, never throws).
    try {
      await notifyAdmins(
        'expert_case_created',
        {
          caseId: caseId ?? c.id,
          title: c.title,
          priority: c.priority,
          triggerType: c.triggerType,
          userMessage: c.userMessage,
          status: c.status,
        },
        c.userId,
      )
    } catch (err) {
      console.error('[escalation/internal] notifyAdmins failed:', err)
    }
  }
}
