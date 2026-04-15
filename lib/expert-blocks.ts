// Shared helpers for expert comment blocks
// Used by ExpertCommentThread (editable) and ExpertCommentsSection (read-only)

export type BlockKey = 'finance' | 'sales' | 'operations' | 'marketing' | 'strategy'

export const BLOCK_ORDER: BlockKey[] = ['finance', 'sales', 'operations', 'marketing', 'strategy']

export const BLOCK_LABELS: Record<BlockKey, string> = {
  finance: 'Финансы',
  sales: 'Продажи',
  operations: 'Операции',
  marketing: 'Маркетинг',
  strategy: 'Стратегия',
}

// Label for any block key (null = general feed)
export function blockLabel(key: string | null | undefined): string {
  if (!key) return 'Общее'
  if (key in BLOCK_LABELS) return BLOCK_LABELS[key as BlockKey]
  return 'Общее'
}

// Color palette per block for chips and group headers
export const BLOCK_CHIP: Record<BlockKey | 'general', string> = {
  general: 'bg-white/[0.05] text-on-surface-variant border-white/[0.08]',
  finance: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
  sales: 'bg-blue-500/10 text-blue-300 border-blue-500/20',
  operations: 'bg-violet-500/10 text-violet-300 border-violet-500/20',
  marketing: 'bg-amber-500/10 text-amber-300 border-amber-500/20',
  strategy: 'bg-pink-500/10 text-pink-300 border-pink-500/20',
}

export function blockChipClass(key: string | null | undefined): string {
  if (!key) return BLOCK_CHIP.general
  if (key in BLOCK_CHIP) return BLOCK_CHIP[key as BlockKey]
  return BLOCK_CHIP.general
}

// For grouping in ExpertCommentsSection: general (null) first, then BLOCK_ORDER
export const GROUP_ORDER: Array<BlockKey | null> = [null, ...BLOCK_ORDER]

const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

// "15 апр, 18:45"
export function formatCommentDate(iso: string): string {
  try {
    const d = new Date(iso)
    const parts = dateFormatter.formatToParts(d)
    const day = parts.find((p) => p.type === 'day')?.value ?? ''
    const month = parts.find((p) => p.type === 'month')?.value ?? ''
    const hour = parts.find((p) => p.type === 'hour')?.value ?? ''
    const minute = parts.find((p) => p.type === 'minute')?.value ?? ''
    return `${day} ${month}, ${hour}:${minute}`
  } catch {
    return iso
  }
}

// Initials from a full name (up to 2 chars)
export function getInitials(name: string | null | undefined): string {
  if (!name) return 'ЭК'
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

// Deterministic avatar background color based on user id or name
const AVATAR_BG = [
  'from-blue-500/30 to-violet-500/30',
  'from-emerald-500/30 to-teal-500/30',
  'from-amber-500/30 to-orange-500/30',
  'from-pink-500/30 to-rose-500/30',
  'from-violet-500/30 to-purple-500/30',
  'from-cyan-500/30 to-blue-500/30',
]

export function getAvatarGradient(seed: string | null | undefined): string {
  if (!seed) return AVATAR_BG[0]
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  }
  return AVATAR_BG[hash % AVATAR_BG.length]
}

export interface ExpertComment {
  id: string
  clientId: string
  authorId: string
  authorName: string | null
  authorTitle: string | null
  authorAvatarUrl: string | null
  authorRole: string | null
  blockKey: string | null
  text: string
  createdAt: string
  updatedAt: string
}
