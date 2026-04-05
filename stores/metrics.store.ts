'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { DataLayer } from '@/types/metrics'
import type { Period } from '@/types/periods'
import { DEFAULT_PERIOD } from '@/types/periods'
import { MAX_METRICS } from '@/types/metrics'

const DEFAULT_IDS = ['revenue', 'margin', 'clients', 'avg_check']
const NON_REMOVABLE = new Set(DEFAULT_IDS)

interface MetricsState {
  visibleMetricIds: string[]
  hiddenMetricIds: string[]
  activeMetricId: string | null
  selectedPeriod: Period
  activeLayers: DataLayer[]

  addMetric: (id: string) => void
  removeMetric: (id: string) => void
  hideMetric: (id: string) => void
  showMetric: (id: string) => void
  showAllMetrics: () => void
  setActiveMetric: (id: string | null) => void
  setPeriod: (period: Period) => void
  toggleLayer: (layer: DataLayer) => void
  reorderMetrics: (ids: string[]) => void
}

export const useMetricsStore = create<MetricsState>()(
  persist(
    (set) => ({
      visibleMetricIds: [...DEFAULT_IDS],
      hiddenMetricIds: [],
      activeMetricId: null,
      selectedPeriod: DEFAULT_PERIOD,
      activeLayers: ['fact'],

      addMetric: (id) =>
        set((s) => {
          const total = s.visibleMetricIds.length + s.hiddenMetricIds.length
          if (total >= MAX_METRICS) return s
          if (s.visibleMetricIds.includes(id) || s.hiddenMetricIds.includes(id)) return s
          return { visibleMetricIds: [...s.visibleMetricIds, id] }
        }),

      removeMetric: (id) =>
        set((s) => {
          if (NON_REMOVABLE.has(id)) return s
          return {
            visibleMetricIds: s.visibleMetricIds.filter((x) => x !== id),
            hiddenMetricIds: s.hiddenMetricIds.filter((x) => x !== id),
          }
        }),

      hideMetric: (id) =>
        set((s) => ({
          visibleMetricIds: s.visibleMetricIds.filter((x) => x !== id),
          hiddenMetricIds: s.hiddenMetricIds.includes(id)
            ? s.hiddenMetricIds
            : [...s.hiddenMetricIds, id],
        })),

      showMetric: (id) =>
        set((s) => ({
          hiddenMetricIds: s.hiddenMetricIds.filter((x) => x !== id),
          visibleMetricIds: s.visibleMetricIds.includes(id)
            ? s.visibleMetricIds
            : [...s.visibleMetricIds, id],
        })),

      showAllMetrics: () =>
        set((s) => ({
          visibleMetricIds: [...s.visibleMetricIds, ...s.hiddenMetricIds],
          hiddenMetricIds: [],
        })),

      setActiveMetric: (id) => set({ activeMetricId: id }),

      setPeriod: (period) => set({ selectedPeriod: period }),

      toggleLayer: (layer) =>
        set((s) => {
          if (layer === 'fact') return s
          const has = s.activeLayers.includes(layer)
          return {
            activeLayers: has
              ? s.activeLayers.filter((l) => l !== layer)
              : [...s.activeLayers, layer],
          }
        }),

      reorderMetrics: (ids) => set({ visibleMetricIds: ids }),
    }),
    {
      name: 'aistart360-metrics',
      partialize: (s) => ({
        visibleMetricIds: s.visibleMetricIds,
        hiddenMetricIds: s.hiddenMetricIds,
      }),
    }
  )
)
