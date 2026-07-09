// lib/gri/benchmarks.ts — бенчмарки «вы vs топ-20% отрасли» (v1).
//
// Хардкод-ориентиры по 6 отраслям СНГ для 7 блоков GRI. Это ЭКСПЕРТНЫЕ
// оценки (не живая база данных): median — типичный бизнес отрасли,
// top20 — граница верхних 20%. Значения 0..10, реалистичные:
// top20 обычно 7.0–8.5, median 4.5–6.0.
//
// Чистый модуль без I/O — тривиально тестируется.

import { GRI_SECTIONS, type SectionId } from '@/lib/gri-assessment/sections'

export type IndustryId =
  | 'retail'
  | 'services'
  | 'ecom'
  | 'production'
  | 'horeca'
  | 'universal'

export interface BenchmarkPair {
  /** Медиана отрасли (типичный бизнес), 0..10. */
  median: number
  /** Граница топ-20% отрасли, 0..10. */
  top20: number
}

export interface IndustryBenchmark {
  id: IndustryId
  labelRu: string
  blocks: Record<SectionId, BenchmarkPair>
}

export interface BenchmarkGap {
  blockId: SectionId
  blockLabelRu: string
  /** Ваш балл блока, клампится в 0..10. */
  you: number
  /** Медиана отрасли. */
  median: number
  /** Граница топ-20%. */
  top20: number
  /** top20 − you (положительный = отставание, отрицательный = вы выше). */
  gap: number
}

// Русские подписи 7 блоков GRI — как в GriDynamicsPanel.tsx (BLOCK_RU).
const BLOCK_RU: Record<string, string> = {
  'product-demand': 'Продукт и спрос',
  'trust-positioning': 'Доверие и позиционирование',
  'business-model': 'Бизнес-модель',
  'cash-stability': 'Денежная стабильность',
  operations: 'Операции',
  team: 'Команда',
  'owner-readiness': 'Готовность собственника',
}

export const INDUSTRY_BENCHMARKS: Record<IndustryId, IndustryBenchmark> = {
  retail: {
    id: 'retail',
    labelRu: 'Розничная торговля',
    blocks: {
      'product-demand': { median: 5.4, top20: 7.8 },
      'trust-positioning': { median: 5.0, top20: 7.4 },
      'business-model': { median: 5.2, top20: 7.6 },
      'cash-stability': { median: 4.8, top20: 7.2 },
      operations: { median: 5.6, top20: 8.1 },
      team: { median: 5.0, top20: 7.5 },
      'owner-readiness': { median: 5.2, top20: 7.6 },
    },
  },
  services: {
    id: 'services',
    labelRu: 'Услуги',
    blocks: {
      'product-demand': { median: 5.8, top20: 8.2 },
      'trust-positioning': { median: 5.6, top20: 8.0 },
      'business-model': { median: 5.0, top20: 7.4 },
      'cash-stability': { median: 4.6, top20: 7.0 },
      operations: { median: 4.9, top20: 7.3 },
      team: { median: 5.2, top20: 7.6 },
      'owner-readiness': { median: 5.6, top20: 8.0 },
    },
  },
  ecom: {
    id: 'ecom',
    labelRu: 'E-commerce',
    blocks: {
      'product-demand': { median: 5.6, top20: 8.0 },
      'trust-positioning': { median: 4.8, top20: 7.2 },
      'business-model': { median: 5.4, top20: 7.9 },
      'cash-stability': { median: 5.0, top20: 7.5 },
      operations: { median: 5.8, top20: 8.3 },
      team: { median: 4.7, top20: 7.1 },
      'owner-readiness': { median: 5.3, top20: 7.7 },
    },
  },
  production: {
    id: 'production',
    labelRu: 'Производство',
    blocks: {
      'product-demand': { median: 5.2, top20: 7.5 },
      'trust-positioning': { median: 5.4, top20: 7.7 },
      'business-model': { median: 5.6, top20: 8.0 },
      'cash-stability': { median: 5.2, top20: 7.8 },
      operations: { median: 5.5, top20: 8.0 },
      team: { median: 5.3, top20: 7.6 },
      'owner-readiness': { median: 5.0, top20: 7.3 },
    },
  },
  horeca: {
    id: 'horeca',
    labelRu: 'HoReCa',
    blocks: {
      'product-demand': { median: 5.5, top20: 7.9 },
      'trust-positioning': { median: 5.3, top20: 7.7 },
      'business-model': { median: 4.7, top20: 7.1 },
      'cash-stability': { median: 4.5, top20: 7.0 },
      operations: { median: 5.4, top20: 7.8 },
      team: { median: 4.8, top20: 7.2 },
      'owner-readiness': { median: 5.1, top20: 7.4 },
    },
  },
  universal: {
    id: 'universal',
    labelRu: 'Универсальный (все отрасли)',
    blocks: {
      'product-demand': { median: 5.5, top20: 7.9 },
      'trust-positioning': { median: 5.2, top20: 7.6 },
      'business-model': { median: 5.2, top20: 7.7 },
      'cash-stability': { median: 4.8, top20: 7.3 },
      operations: { median: 5.4, top20: 7.9 },
      team: { median: 5.0, top20: 7.4 },
      'owner-readiness': { median: 5.2, top20: 7.6 },
    },
  },
}

const FALLBACK_INDUSTRY: IndustryId = 'universal'

/** Список отраслей для селекта (universal — последним, как «прочее»). */
export function listIndustries(): { id: IndustryId; labelRu: string }[] {
  const order: IndustryId[] = ['retail', 'services', 'ecom', 'production', 'horeca', 'universal']
  return order.map((id) => ({ id, labelRu: INDUSTRY_BENCHMARKS[id].labelRu }))
}

function clamp01to10(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return 0
  return Math.min(10, Math.max(0, n))
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

/**
 * Разрывы «вы vs топ-20%» по 7 блокам GRI (в порядке GRI_SECTIONS).
 * Неизвестная отрасль → universal; ваши баллы клампятся в 0..10.
 */
export function computeGaps(
  sectionAvgs: Record<string, number> | null | undefined,
  industryId: string,
): BenchmarkGap[] {
  const industry =
    INDUSTRY_BENCHMARKS[industryId as IndustryId] ?? INDUSTRY_BENCHMARKS[FALLBACK_INDUSTRY]
  const avgs = sectionAvgs && typeof sectionAvgs === 'object' ? sectionAvgs : {}

  return GRI_SECTIONS.map((s) => {
    const bench = industry.blocks[s.id]
    const you = round1(clamp01to10(avgs[s.id]))
    return {
      blockId: s.id,
      blockLabelRu: BLOCK_RU[s.id] ?? s.shortTitle,
      you,
      median: bench.median,
      top20: bench.top20,
      gap: round1(bench.top20 - you),
    }
  })
}
