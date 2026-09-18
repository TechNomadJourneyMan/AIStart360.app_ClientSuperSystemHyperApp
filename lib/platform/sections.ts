import { createServiceClient } from '@/lib/supabase-service'
import { getUserFacts } from './facts'
import { isVisible } from './visibility'

export interface PlatformSection {
  key: string
  title: string
  description: string | null
  icon: string | null
  nav_href: string
  paths: string[]
  enabled: boolean
  visibility: unknown
  sort_order: number
  updated_by: string | null
  updated_at: string
}

export async function loadSections(): Promise<PlatformSection[]> {
  const { data, error } = await createServiceClient()
    .from('platform_sections')
    .select('key, title, description, icon, nav_href, paths, enabled, visibility, sort_order, updated_by, updated_at')
    .order('sort_order', { ascending: true })
  if (error) return []
  return (data ?? []) as PlatformSection[]
}

/** Sections the user may open, in display order. Unknown table → everything (fail open for navigation only). */
export async function visibleSectionsFor(userId: string | null | undefined): Promise<{ sections: PlatformSection[]; hiddenPaths: string[] }> {
  const [all, facts] = await Promise.all([loadSections(), getUserFacts(userId)])
  const now = Date.now()
  const visible = all.filter((s) => s.enabled && isVisible(s.visibility, facts, now))
  const hiddenPaths = all.filter((s) => !visible.includes(s)).flatMap((s) => s.paths)
  return { sections: visible, hiddenPaths }
}

export function pathIsHidden(pathname: string, hiddenPaths: readonly string[]): boolean {
  return hiddenPaths.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

/** Keys of the sections a user may open — for server-rendered page blocks. */
export async function visibleSectionKeysFor(userId: string | null | undefined): Promise<Set<string>> {
  const { sections } = await visibleSectionsFor(userId)
  return new Set(sections.map((s) => s.key))
}

/** Section key that owns a cabinet path, or null when the path is not gated. */
export async function sectionKeyForPath(pathname: string): Promise<string | null> {
  const all = await loadSections()
  return all.find((s) => s.paths.some((p) => pathname === p || pathname.startsWith(`${p}/`)))?.key ?? null
}
