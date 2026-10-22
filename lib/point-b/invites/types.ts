/**
 * lib/point-b/invites/types.ts — vocabulary of the personal Point B invites (plan Ф6a «Контракты»,
 * spec §12.1). Types only.
 */
import type { RecSourceRef } from '../recs/types'

export type InviteStatus = 'new' | 'seen' | 'dismissed' | 'snoozed' | 'acted' | 'expired'

export interface InviteView {
  id: string
  kind: 'insight' | 'recommendation'
  title: string
  body: string
  href: string | null
  why: string
  sourceRefs: RecSourceRef[]
  display: 'card' | 'modal'
  createdAt: string
}
