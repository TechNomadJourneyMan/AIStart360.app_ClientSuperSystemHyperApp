/**
 * Which GRI sections became completed with this draft save (for
 * GRI_SECTION_COMPLETED events). Only known section ids, each at most once.
 */
import { GRI_SECTIONS } from './sections'

const KNOWN = new Set(GRI_SECTIONS.map((s) => s.id as string))

export function newlyCompletedSections(before: unknown, after: Record<string, boolean> | null | undefined): string[] {
  const prev = before && typeof before === 'object' && !Array.isArray(before) ? (before as Record<string, unknown>) : {}
  return Object.entries(after ?? {})
    .filter(([id, done]) => done === true && prev[id] !== true && KNOWN.has(id))
    .map(([id]) => id)
}
