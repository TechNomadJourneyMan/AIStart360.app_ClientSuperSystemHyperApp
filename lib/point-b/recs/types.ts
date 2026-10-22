/**
 * lib/point-b/recs/types.ts — vocabulary of the Point B recommendations (plan Ф6a «Контракты»,
 * spec §12). Types only: the store, the rules and the AI generation build on them.
 */

export type RecKind = 'lever' | 'risk' | 'action' | 'contradiction' | 'constraint'
/** `ai_generated` lives an instant: a record is created right away as `pending_review` with `generatedBy`. */
export type RecStatus = 'pending_review' | 'expert_verified' | 'expert_rejected' | 'stale'
export type RecSource = 'rule' | 'ai' | 'expert'

export interface RecSourceRef {
  type: 'metric' | 'model' | 'snapshot' | 'check' | 'scenario' | 'finmodel' | 'goal'
  ref: string
  label: string
}

export interface Recommendation {
  id: string
  companyId: string
  versionId: string | null
  kind: RecKind
  title: string
  essence: string
  reason: string
  expectedEffect: string | null
  resources: string | null
  confidence: 'low' | 'medium' | 'high'
  confidenceReason: string | null
  risks: string | null
  nextAction: string | null
  sourceRefs: RecSourceRef[]
  status: RecStatus
  generatedBy: RecSource
  inputsHash: string | null
  recVersion: number
  supersedesId: string | null
  reviewerName: string | null
  reviewerSpecialty: string | null
  reviewedAt: string | null
  scopeNote: string | null
  reviewComment: string | null
  createdAt: string
  updatedAt: string
}

export interface ClientRecommendationView {
  id: string
  kind: RecKind
  title: string
  essence: string
  reason: string
  expectedEffect: string | null
  resources: string | null
  confidence: Recommendation['confidence']
  confidenceReason: string | null
  risks: string | null
  nextAction: string | null
  sourceRefs: RecSourceRef[]
  state: 'verified' | 'stale'
  reviewerName: string | null
  reviewerSpecialty: string | null
  reviewedAt: string | null
  scopeNote: string | null
}
