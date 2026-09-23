import type { Journey } from '@/lib/admin/journey'
import type { StaffRole } from '@/lib/admin/rbac'

export interface User360Profile {
  profile: {
    id: string; email: string | null; full_name: string | null; role: string; status: string; organization: string | null
    position: string | null; phone: string | null; tier: string | null; feature_flags: Record<string, boolean> | null
    vertical: string | null; widget_config: unknown; created_at: string; approved_at: string | null; last_seen_at: string | null; avatar_url: string | null
  }
  staffRole: StaffRole | null
  company: { id: string; name: string; industry: string | null; business_model: string | null; employee_count: number | null; regions: string[] | null } | null
  survey: {
    percent: number; startedSteps: number; totalSteps: number; missingSteps: number[]; startedAt: string | null; updatedAt: string | null
    hero: Record<string, string>
    sections: Array<{ id: string; title: string; icon: string; filled: number; total: number }>
  }
  diagnostics: { id: string; overall_score: number | null; health_index: number | null; stage: string | null; calculated_at: string; runs: number } | null
  gri: { current: { id: string; index: number; sectionAvgs: Record<string, number>; assessedAt: string } | null; runs: number; draftUpdatedAt: string | null }
  journey: Journey
  counters: { documents: number; events: number; legacyAudit: number }
  impersonationActive: boolean
  can: {
    manage: boolean; archive: boolean; purge: boolean; editSurvey: boolean; viewSurvey: boolean; editGri: boolean; deleteGri: boolean
    impersonate: boolean; impersonateEdit: boolean; activity: boolean; audit: boolean; roles: boolean; sensitive: boolean
  }
}
