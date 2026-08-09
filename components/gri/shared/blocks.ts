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
  /**
   * Откуда взялся avg:
   *  'criteria' — посчитан по ответам, разбор до критериев настоящий;
   *  'block'    — сохранён только средний по блоку (старая запись без scores),
   *               критерии показать неоткуда — UI обязан сказать это прямо;
   *  null       — данных нет вообще.
   */
  avgSource: 'criteria' | 'block' | null
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Разворачивает posted-scores ({sectionId: {criterionId: 1..10}}) в строки по
 * блокам. Непройденный блок получает avg === null, а НЕ 0 — иначе он рисуется
 * как «критический» балл, которого пользователь не ставил.
 *
 * `fallbackAvgs` — серверные section_avgs. Используются ТОЛЬКО когда по блоку
 * нет ни одного покритериального ответа: тогда балл честно помечается
 * avgSource:'block', и UI не выдаёт отсутствующий разбор за настоящий.
 */
export function buildBlockRows(
  scores: GriScoresMap | null | undefined,
  fallbackAvgs?: Record<string, unknown> | null,
): GriBlockRow[] {
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
    const blockOnly = num(fallbackAvgs?.[section.id])
    const hasCriteria = answeredScores.length > 0
    return {
      id: section.id,
      label: BLOCK_RU[section.id] ?? section.shortTitle,
      description: section.description,
      avg: hasCriteria
        ? answeredScores.reduce((a, b) => a + b, 0) / answeredScores.length
        : blockOnly,
      answered: answeredScores.length,
      total: criteria.length,
      criteria,
      avgSource: hasCriteria ? 'criteria' : blockOnly != null ? 'block' : null,
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

// ── Продолжение незавершённого опросника ──────────────────────────────────
// Место остановки не хранится отдельным полем: его выводим из самих ответов.
// Так оно переживает перезагрузку, смену вкладки и приход данных с сервера, и
// не может разъехаться с реальным прогрессом.

/** Все ли вопросы блока отвечены. */
export function isSectionAnswered(
  sectionId: string,
  scores: GriScoresMap | null | undefined,
): boolean {
  const section = GRI_SECTIONS.find((s) => s.id === sectionId)
  if (!section) return false
  const map = (scores?.[sectionId] ?? {}) as Record<string, unknown>
  return section.criteria.every((c) => num(map[c.id]) != null)
}

/** Первый неотвеченный вопрос блока; 0 — если блок пройден целиком. */
export function firstUnansweredCriterionIndex(
  sectionId: string,
  scores: GriScoresMap | null | undefined,
): number {
  const section = GRI_SECTIONS.find((s) => s.id === sectionId)
  if (!section) return 0
  const map = (scores?.[sectionId] ?? {}) as Record<string, unknown>
  const idx = section.criteria.findIndex((c) => num(map[c.id]) == null)
  return idx === -1 ? 0 : idx
}

/**
 * Блок считается пройденным, если он помечен завершённым ИЛИ отвечены все его
 * вопросы. Второе условие — страховка: у ранних сохранений блок мог остаться
 * непомеченным, хотя все ответы на месте.
 */
export function isSectionDone(
  sectionId: string,
  scores: GriScoresMap | null | undefined,
  completed?: Record<string, boolean> | null,
): boolean {
  return !!completed?.[sectionId] || isSectionAnswered(sectionId, scores)
}

/** Первый незавершённый блок — место, с которого продолжаем. -1 — пройдены все. */
export function firstUnfinishedSectionIndex(
  scores: GriScoresMap | null | undefined,
  completed?: Record<string, boolean> | null,
): number {
  return GRI_SECTIONS.findIndex((s) => !isSectionDone(s.id, scores, completed))
}

/** Сколько блоков пройдено. */
export function doneSectionsCount(
  scores: GriScoresMap | null | undefined,
  completed?: Record<string, boolean> | null,
): number {
  return GRI_SECTIONS.filter((s) => isSectionDone(s.id, scores, completed)).length
}
