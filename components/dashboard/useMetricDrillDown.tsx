'use client'

// ============================================================
// useMetricDrillDown — the one-liner that makes a number clickable.
//
// The problem this solves: `MetricDrillDownModalV2` used to be mounted by
// exactly one screen (components/metrics/MetricsLiveCatalog.tsx), so every
// other tile that "opened a drill-down" opened nothing. On /point-a the tiles
// call `setActiveMetric(id)` on the metrics store and no modal listens.
//
// Usage — local (a screen that owns its own tiles):
//
//   const drill = useMetricDrillDown()
//   <button onClick={() => drill.open({ metricId: 'biz.finansy.vyruchka_god' })}>…</button>
//   {drill.modal}
//
// Usage — page-wide (tiles live deep in the tree, or already talk to the
// metrics store):
//
//   <MetricDrillDownProvider syncWithMetricsStore>{children}</MetricDrillDownProvider>
//
// Inside such a provider `useMetricDrillDown()` returns the shared instance
// and `drill.modal` is `null`, so rendering `{drill.modal}` is always safe:
// there is never more than one modal on screen.
// ============================================================

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import dynamic from 'next/dynamic'

import { useMetricsStore } from '@/stores/metrics.store'
import type {
  MetricDrillDownAction,
  MetricDrillDownDescription,
  MetricDrillDownModalV2Props,
} from './MetricDrillDownModalV2'
import type { DrillLayer, DrillProvenance } from './_drill-down-utils'
import type { Period } from '@/types/periods'

// recharts + the descriptions catalog live inside the modal — keep them out of
// every host page's first-load bundle.
const MetricDrillDownModalV2 = dynamic(() => import('./MetricDrillDownModalV2'), {
  ssr: false,
})

// ────────────────────────────────────────────────────────────────────────────
// What a caller has to know about a metric. Only `metricId` is required —
// everything else the modal resolves for itself from the registry and
// /api/v1/metrics/:id/value.
// ────────────────────────────────────────────────────────────────────────────

export interface MetricDrillDownTarget {
  metricId: string
  /** Falls back to the label from the registry when omitted. */
  metricLabel?: string
  unit?: string
  description?: MetricDrillDownDescription
  provenance?: DrillProvenance
  liveValue?: {
    value: number | string | null
    trend?: { direction: 'up' | 'down' | 'flat'; deltaPct: number }
  }
  namespace?: 'biz' | 'kpi' | 'gri' | 'goal'
  department?: string | null
  goalNumber?: string | null
  formula?: string | null
  confidence?: number | null
  computedAt?: string | null
  actions?: MetricDrillDownAction[]
  missingDataHint?: string
  initialPeriod?: Period
  initialLayers?: DrillLayer[]
}

export interface MetricDrillDownOptions {
  /**
   * Mirror `stores/metrics.store` — any existing `setActiveMetric(id)` call in
   * the tree opens the drill-down, and closing it clears the store. This is how
   * screens whose tiles already talk to the store come alive without touching
   * those tiles.
   */
  syncWithMetricsStore?: boolean
  /**
   * Turns a bare metric id into a full target (label, unit, value the screen
   * already has). Used for `open('some.id')` and for store-driven opens.
   */
  resolveTarget?: (metricId: string) => MetricDrillDownTarget | undefined
  /** Props merged into every target — e.g. screen-specific `actions`. */
  defaults?: Omit<Partial<MetricDrillDownTarget>, 'metricId'>
  onOpen?: (metricId: string) => void
  onClose?: (metricId: string) => void
}

export interface MetricDrillDownApi {
  /** Open the drill-down for a metric id or a fully described target. */
  open: (target: string | MetricDrillDownTarget) => void
  close: () => void
  isOpen: boolean
  activeMetricId: string | null
  /**
   * Render this once. It is `null` when a `MetricDrillDownProvider` above
   * already owns the modal, so `{drill.modal}` is safe in both cases.
   */
  modal: React.ReactNode
}

// ────────────────────────────────────────────────────────────────────────────

const MetricDrillDownContext = createContext<Omit<MetricDrillDownApi, 'modal'> | null>(null)

function toTarget(input: string | MetricDrillDownTarget): MetricDrillDownTarget {
  return typeof input === 'string' ? { metricId: input } : input
}

/**
 * Owns the state and the modal element. Not exported — reached through
 * `useMetricDrillDown()` or `MetricDrillDownProvider`.
 */
function useDrillDownInstance(options?: MetricDrillDownOptions, enabled = true): MetricDrillDownApi {
  const { syncWithMetricsStore, resolveTarget, defaults, onOpen, onClose } = options ?? {}

  const [target, setTarget] = useState<MetricDrillDownTarget | null>(null)
  const storeActiveId = useMetricsStore((s) => s.activeMetricId)
  const setActiveMetric = useMetricsStore((s) => s.setActiveMetric)

  const storeSync = enabled && !!syncWithMetricsStore

  const open = useCallback(
    (input: string | MetricDrillDownTarget) => {
      const explicit = toTarget(input)
      const resolved = resolveTarget?.(explicit.metricId)
      setTarget({
        ...defaults,
        ...resolved,
        ...explicit,
        // A resolver is allowed to rewrite a legacy slot id ("revenue") onto
        // the real registry id it stands for — otherwise the modal would query
        // an id the API does not know.
        metricId: resolved?.metricId ?? explicit.metricId,
      })
      onOpen?.(explicit.metricId)
    },
    [resolveTarget, defaults, onOpen],
  )

  const close = useCallback(() => {
    setTarget((prev) => {
      if (prev) onClose?.(prev.metricId)
      return null
    })
    if (storeSync) setActiveMetric(null)
  }, [onClose, storeSync, setActiveMetric])

  // Store → modal. `setActiveMetric(id)` anywhere in the tree opens the drill-down.
  useEffect(() => {
    if (!storeSync) return
    if (!storeActiveId) return
    setTarget((prev) => {
      const resolved = resolveTarget?.(storeActiveId)
      const metricId = resolved?.metricId ?? storeActiveId
      if (prev?.metricId === metricId) return prev
      return { ...defaults, ...resolved, metricId }
    })
    onOpen?.(storeActiveId)
    // `defaults`/`resolveTarget` are read, not tracked: re-running on their
    // identity would reopen the modal on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeSync, storeActiveId])

  const modal = useMemo(() => {
    if (!enabled || !target) return null
    const props: MetricDrillDownModalV2Props = {
      open: true,
      onClose: close,
      metricId: target.metricId,
      metricLabel: target.metricLabel ?? '',
      unit: target.unit,
      description: target.description,
      provenance: target.provenance,
      liveValue: target.liveValue,
      namespace: target.namespace,
      department: target.department,
      goalNumber: target.goalNumber,
      formula: target.formula,
      confidence: target.confidence,
      computedAt: target.computedAt,
      actions: target.actions,
      missingDataHint: target.missingDataHint,
      initialPeriod: target.initialPeriod,
      initialLayers: target.initialLayers,
    }
    return <MetricDrillDownModalV2 {...props} />
  }, [enabled, target, close])

  return {
    open,
    close,
    isOpen: !!target,
    activeMetricId: target?.metricId ?? null,
    modal,
  }
}

/**
 * Mounts one drill-down modal for a whole subtree.
 *
 *   <MetricDrillDownProvider syncWithMetricsStore>{children}</MetricDrillDownProvider>
 */
export function MetricDrillDownProvider({
  children,
  ...options
}: MetricDrillDownOptions & { children: React.ReactNode }) {
  const instance = useDrillDownInstance(options)
  const value = useMemo(
    () => ({
      open: instance.open,
      close: instance.close,
      isOpen: instance.isOpen,
      activeMetricId: instance.activeMetricId,
    }),
    [instance.open, instance.close, instance.isOpen, instance.activeMetricId],
  )

  return (
    <MetricDrillDownContext.Provider value={value}>
      {children}
      {instance.modal}
    </MetricDrillDownContext.Provider>
  )
}

/**
 * Returns the drill-down controls. Uses the nearest `MetricDrillDownProvider`
 * when there is one; otherwise creates a local instance whose `modal` the
 * caller renders.
 */
export function useMetricDrillDown(options?: MetricDrillDownOptions): MetricDrillDownApi {
  const ctx = useContext(MetricDrillDownContext)
  // Hooks must run unconditionally; the local instance stays inert (and its
  // `modal` stays null) whenever a provider is available.
  const local = useDrillDownInstance(options, !ctx)

  if (ctx) {
    return { ...ctx, modal: null }
  }
  return local
}

export default useMetricDrillDown
