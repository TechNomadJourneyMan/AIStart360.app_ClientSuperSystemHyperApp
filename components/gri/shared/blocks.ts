// components/gri/shared/blocks.ts — единый словарь и хелперы 7 блоков GRI.
//
// Раньше карта русских подписей была скопирована в GRIAssessment,
// GriResultPanel и GriDynamicsPanel, а «эталон» жил тремя литералами
// (8 в радаре, 8.5 в hero, TARGET_GRI в калькуляторе). Здесь — одна карта и
// одна цель (TARGET_GRI из lib/gri-calculator/gri-data).

import { GRI_SECTIONS, type SectionId } from '@/lib/gri-assessment/sections'
import { TARGET_GRI } from '@/lib/gri-calculator/gri-data'

/** Русские подписи 7 блоков GRI (sections.ts хранит английские shortTitle). */
export const BLOCK_RU: Record<SectionId, string> = {
  'product-demand': 'Продукт и спрос',
  'trust-positioning': 'Доверие и позиционирование',
  'business-model': 'Бизнес-модель',
  'cash-stability': 'Денежная стабильность',
  operations: 'Операции',
  team: 'Команда',
  'owner-readiness': 'Готовность собственника',
}

/** Единая цель GRI на весь раздел — никаких литералов «8» / «8.5» в JSX. */
export const GRI_TARGET = TARGET_GRI

export function blockLabel(id: string): string {
  return (
    BLOCK_RU[id as SectionId] ??
    GRI_SECTIONS.find((s) => s.id === id)?.shortTitle ??
    id
  )
}

/** Тон полосы для среднего 0–10 (≥8 — норма, ≥6 — риск, иначе критично). */
export function avgBarTone(v: number): string {
  return v >= 8 ? 'bg-primary' : v >= 6 ? 'bg-amber-400' : 'bg-red-400'
}

export type GriScoresMap = Record<string, Record<string, number>>

export interface GriCriterionRow {
  id: string
  text: string
  description: string
  whatToImprove: string
  businessLoss: string
  /** null — на критерий не отвечали. */
  score: number | null
}

export interface GriBlockRow {
  id: SectionId
  label: string
  description: string
  /** null — блок не проходили ни разу (нет ни одного ответа). Не 0! */
  avg: number | null
  answered: number
  total: number
  criteria: GriCriterionRow[]
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Разворачивает posted-scores ({sectionId: {criterionId: 1..10}}) в строки по
 * блокам. Непройденный блок получает avg === null, а НЕ 0 — иначе он рисуется
 * как «критический» балл, которого пользователь не ставил.
 */
export function buildBlockRows(scores: GriScoresMap | null | undefined): GriBlockRow[] {
  return GRI_SECTIONS.map((section) => {
    const map = (scores?.[section.id] ?? {}) as Record<string, unknown>
    const criteria: GriCriterionRow[] = section.criteria.map((c) => ({
      id: c.id,
      text: c.text,
      description: c.description,
      whatToImprove: c.whatToImprove,
      businessLoss: c.businessLoss,
      score: num(map[c.id]),
    }))
    const answeredScores = criteria
      .map((c) => c.score)
      .filter((v): v is number => v != null)
    return {
      id: section.id,
      label: BLOCK_RU[section.id] ?? section.shortTitle,
      description: section.description,
      avg:
        answeredScores.length === 0
          ? null
          : answeredScores.reduce((a, b) => a + b, 0) / answeredScores.length,
      answered: answeredScores.length,
      total: criteria.length,
      criteria,
    }
  })
}

/**
 * Индекс = среднее по блокам, где есть хоть один ответ. Блоки без данных не
 * тянут индекс вниз нулём.
 */
export function computeIndexFromRows(rows: GriBlockRow[]): number {
  const vals = rows.map((r) => r.avg).filter((v): v is number => v != null)
  if (vals.length === 0) return 0
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100
}

/** Индекс блока в GRI_SECTIONS (для перехода «пройти блок»). */
export function sectionIndexOf(id: string): number {
  return GRI_SECTIONS.findIndex((s) => s.id === id)
}
