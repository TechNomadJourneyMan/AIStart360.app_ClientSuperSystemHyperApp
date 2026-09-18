/** Current `gri_assessments` row as returned by GET /api/v1/gri/assessment. */
export interface AssessmentCurrent {
  gri_index: number
  section_avgs: Record<string, number>
  top_5_limits: unknown
  action_plan_90d: unknown
  created_at: string
}

/** Work-in-progress state of the full GRI test (browser + server draft). */
export interface GriDraftState {
  onboarding: Record<string, unknown>
  scores: Record<string, Record<string, number>>
  completedSections: Record<string, boolean>
}
