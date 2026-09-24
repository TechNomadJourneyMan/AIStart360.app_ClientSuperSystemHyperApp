import { createServiceClient } from '@/lib/supabase-service'
import type { UserFacts } from './visibility'

/** Facts for visibility rules (SQL user_segment_facts, migration 074). */
export async function getUserFacts(userId: string | null | undefined): Promise<UserFacts | null> {
  if (!userId) return null
  const { data, error } = await createServiceClient().rpc('user_segment_facts', { p_user: userId })
  if (error || !data) return null
  const d = data as Record<string, unknown>
  return {
    role: String(d.role ?? 'client'),
    status: String(d.status ?? 'pending_approval'),
    tier: String(d.tier ?? 'free'),
    vertical: String(d.vertical ?? 'generic'),
    created_at: d.created_at ? String(d.created_at) : null,
    survey_steps: Number(d.survey_steps ?? 0),
    survey_completed: d.survey_completed === true,
    gri_runs: Number(d.gri_runs ?? 0),
    is_staff: d.is_staff === true,
  }
}
