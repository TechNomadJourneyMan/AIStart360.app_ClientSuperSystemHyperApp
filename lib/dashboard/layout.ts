/**
 * Dashboard layout persistence helpers (DASH-01).
 *
 * A saved layout is an ordered list of widget instances `{ id, type }`. When it
 * comes back from storage (localStorage or the dashboard_layouts jsonb) it is
 * untrusted, and the widget catalog may have changed since it was saved, so we
 * reconcile it against the current registry before rendering.
 */
export interface WidgetInstance {
  id: string
  type: string
}

/**
 * Sanitize a raw saved layout against the set of currently-valid widget types:
 *   - non-array / empty result → `fallback` (the role default)
 *   - drop entries that aren't objects or whose `type` isn't in `validTypes`
 *     (a removed/renamed widget can never crash the grid)
 *   - dedup by id, preserving order; synthesise an id when one is missing
 */
export function sanitizeWidgetLayout(
  raw: unknown,
  validTypes: readonly string[],
  fallback: WidgetInstance[],
): WidgetInstance[] {
  if (!Array.isArray(raw)) return fallback

  const valid = new Set(validTypes)
  const seen = new Set<string>()
  const out: WidgetInstance[] = []

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const w = item as { id?: unknown; type?: unknown }
    if (typeof w.type !== 'string' || !valid.has(w.type)) continue

    const id = typeof w.id === 'string' && w.id.length > 0 ? w.id : `${w.type}-${out.length}`
    if (seen.has(id)) continue
    seen.add(id)
    out.push({ id, type: w.type })
  }

  return out.length > 0 ? out : fallback
}
