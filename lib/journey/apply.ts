/**
 * applyEnvelope — merges one AI turn (JourneyEnvelope) into JourneyState.
 * Pure function: returns a new state, never mutates. Client-side.
 *
 * Merge rules:
 *  - widgets: appended, id/createdAt generated, spawn priority respected;
 *    duplicates by (kind + title) are skipped so the AI re-sending the
 *    same suggestion doesn't stack copies.
 *  - point_a / point_b nodes: upsert by id. Missing x/y → auto-layout in
 *    the side band (A left, B right), stacked by index.
 *  - milestones: upsert by id, sorted by t. Exactly one active: the first
 *    not-done one (AI's explicit active flags are respected if present).
 *  - profile: fills companyName/industry when provided.
 */

import type { JourneyEnvelope } from './ai'
import type { JourneyMilestone, JourneyNode, JourneyState, Widget } from './state'

let counter = 0
function genId(prefix: string): string {
  counter += 1
  return `${prefix}-${Date.now().toString(36)}-${counter}`
}

function autoPosition(existing: JourneyNode[], side: 'a' | 'b', index: number): { x: number; y: number } {
  const usedYs = existing.map((n) => n.y)
  const bandX = side === 'a' ? [7, 18] : [82, 92]
  const x = bandX[0] + ((index * 7) % (bandX[1] - bandX[0]))
  // Stack down from 18% with 18% gaps, skip occupied slots
  let y = 18 + index * 18
  while (usedYs.some((u) => Math.abs(u - y) < 8) && y < 82) y += 9
  return { x, y: Math.min(82, y) }
}

export function applyEnvelope(state: JourneyState, env: JourneyEnvelope): JourneyState {
  // ── widgets ──
  const existingKeys = new Set(state.widgets.map((w) => `${w.kind}|${w.title.toLowerCase()}`))
  const newWidgets: Widget[] = []
  for (const spawn of env.widgets ?? []) {
    const key = `${spawn.kind}|${spawn.title.toLowerCase()}`
    if (existingKeys.has(key)) continue
    existingKeys.add(key)
    newWidgets.push({
      ...(spawn as object),
      id: genId('w'),
      createdAt: new Date().toISOString(),
      collapsed: false,
      priority: spawn.priority ?? 50,
    } as Widget)
  }

  // ── nodes ──
  const mergeNodes = (current: JourneyNode[], patches: JourneyEnvelope['point_a'], side: 'a' | 'b'): JourneyNode[] => {
    if (!patches?.length) return current
    const map = new Map(current.map((n) => [n.id, n]))
    let addIndex = current.length
    for (const p of patches) {
      const prev = map.get(p.id)
      if (prev) {
        map.set(p.id, {
          ...prev,
          label: p.label || prev.label,
          block: p.block ?? prev.block,
          facts: p.facts?.length ? p.facts : prev.facts,
          status: p.status ?? prev.status,
          x: p.x ?? prev.x,
          y: p.y ?? prev.y,
        })
      } else {
        const pos = (p.x != null && p.y != null)
          ? { x: p.x, y: p.y }
          : autoPosition([...map.values()], side, addIndex)
        addIndex += 1
        map.set(p.id, {
          id: p.id,
          label: p.label,
          block: p.block,
          facts: p.facts ?? [],
          status: p.status,
          ...pos,
        })
      }
    }
    return [...map.values()]
  }

  // ── milestones ──
  const mergeMilestones = (current: JourneyMilestone[], patches: JourneyEnvelope['milestones']): JourneyMilestone[] => {
    if (!patches?.length) return current
    const map = new Map(current.map((m) => [m.id, m]))
    for (const p of patches) {
      const prev = map.get(p.id)
      map.set(p.id, {
        id: p.id,
        t: p.t,
        label: p.label,
        daysFromStart: p.daysFromStart,
        description: p.description,
        metric: p.metric,
        done: p.done ?? prev?.done ?? false,
        active: p.active ?? false,
      })
    }
    const sorted = [...map.values()].sort((x, y) => x.t - y.t)
    // Normalize: single active = first not-done (unless AI explicitly set one)
    if (!sorted.some((m) => m.active && !m.done)) {
      const firstOpen = sorted.find((m) => !m.done)
      for (const m of sorted) m.active = m === firstOpen
    }
    return sorted
  }

  return {
    ...state,
    companyName: env.profile?.company_name?.trim() || state.companyName,
    industry: env.profile?.industry?.trim() || state.industry,
    pointA: mergeNodes(state.pointA, env.point_a, 'a'),
    pointB: mergeNodes(state.pointB, env.point_b, 'b'),
    milestones: mergeMilestones(state.milestones, env.milestones),
    widgets: [...state.widgets, ...newWidgets],
    updatedAt: new Date().toISOString(),
  }
}
