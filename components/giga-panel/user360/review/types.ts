/** Типы вкладки «Разбор» (User 360) — форма ответов /api/giga-admin/users/:id/review/**. */

export interface AiFlag { category: string; severity: 'info' | 'warning' | 'error' | string; note: string }

export interface DraftComment {
  id: string
  client_id: string
  author_id: string
  author_name?: string | null
  block_key: string | null
  block_label: string
  text: string
  status: 'draft' | 'published'
  source: 'expert' | 'ai'
  ai_flags: AiFlag[] | null
  review_id: string | null
  created_at: string
  updated_at: string
}

export interface ReviewInfo {
  id: string
  status: 'draft' | 'published'
  title: string | null
  summary: string | null
  published_at: string | null
  created_at: string
  author_name?: string | null
  comments_count?: number
}

export interface ReviewPayload {
  draft: ReviewInfo | null
  comments: DraftComment[]
  published: ReviewInfo[]
}

export interface ExpertTemplate {
  id: string
  block: string
  block_label?: string
  title: string
  body: string
  is_shared: boolean
  mine: boolean
  updated_at: string
}

export interface PointBVersion {
  id: string
  author_name: string | null
  expert_notes: string | null
  is_approved: boolean
  approved_at: string | null
  approved_by_name?: string | null
  created_at: string
}
