'use client'

import { useEffect, useState } from 'react'

export interface VisibleSection { key: string; title: string; description: string | null; icon: string | null; href: string }

type Payload = { sections: VisibleSection[]; hiddenPaths: string[] }
const TTL_MS = 60_000
const STORE_KEY = 'aistart360_sections'

// Survives page loads within the tab, so a hidden item does not flash in the
// menu before the request returns. Not sensitive: it only lists menu paths
// (the server enforces access on its own).
function readStore(): { at: number; data: Payload } | null {
  try {
    const raw = window.sessionStorage.getItem(STORE_KEY)
    return raw ? (JSON.parse(raw) as { at: number; data: Payload }) : null
  } catch {
    return null
  }
}

let cached: { at: number; data: Payload } | null = null

/** Sections of the cabinet visible to the current user (managed in GIGA-CRM). */
export function usePlatformSections(): { sections: VisibleSection[] | null; hiddenPaths: string[] } {
  // Same first render on server and client (no hydration mismatch); the tab
  // cache is applied right after mount.
  const [data, setData] = useState<Payload | null>(null)
  useEffect(() => {
    if (!cached) cached = readStore()
    if (cached) setData(cached.data)
    if (cached && Date.now() - cached.at < TTL_MS) return
    let alive = true
    fetch('/api/v1/platform/sections', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!alive || !j?.ok) return
        cached = { at: Date.now(), data: j.data }
        try { window.sessionStorage.setItem(STORE_KEY, JSON.stringify(cached)) } catch {}
        setData(j.data)
      })
      .catch(() => {})
    return () => { alive = false }
  }, [])
  return { sections: data?.sections ?? null, hiddenPaths: data?.hiddenPaths ?? [] }
}

export function useHiddenSectionPaths(): string[] {
  return usePlatformSections().hiddenPaths
}

export function isHiddenByPlatform(href: string, hiddenPaths: readonly string[]): boolean {
  return hiddenPaths.some((p) => href === p || href.startsWith(`${p}/`))
}
