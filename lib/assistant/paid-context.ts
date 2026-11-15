/**
 * lib/assistant/paid-context.ts — the assistant / chats and the paid sections
 * (R2-A, ревью H-2).
 *
 * Every assistant surface (mascot «Гри» answers, «чат по отчёту», screen
 * insight, LLM analysis, NBA, the personal Telegram account, …) reads ONE
 * curated snapshot — lib/assistant/context.ts buildAssistantContext(). The data
 * of a paid section closed for the account is removed there, in one place, so
 * it never reaches an LLM prompt or an answer:
 *   • Точка А  — overall / health / stage, block scores, weakest blocks, risks,
 *                quick wins (data gaps of the questionnaire stay: they are survey facts);
 *   • Точка Б  — gap, realism, data sufficiency, levers, GRI-derived limits
 *                (the goals themselves are the client's own survey answers and stay);
 *   • полный GRI — index and top-5 limits.
 * `paidLocked` tells the answer layer which sections are closed, so it says
 * «в платном доступе» (with the way to the request) instead of «нет данных».
 *
 * This module changes data only — never the mascot's look or behaviour.
 */
import type { AssistantContext } from './types'
import type { PaidSection } from '@/lib/access/entitlements'
import type { Locale } from '@/lib/i18n/locale'

export type SectionAccess = Record<PaidSection, boolean>

export const ALL_SECTIONS_OPEN: SectionAccess = { point_a: true, point_b: true, market: true, gri_full: true }
export const ALL_SECTIONS_CLOSED: SectionAccess = { point_a: false, point_b: false, market: false, gri_full: false }

const LABEL: Record<PaidSection, string> = { point_a: 'Точка А', point_b: 'Точка Б', market: 'Рынок', gri_full: 'Полный GRI' }
const LABEL_EN: Record<PaidSection, string> = { point_a: 'Point A', point_b: 'Point B', market: 'Market', gri_full: 'Full GRI' }
/** Where the paywall (with «Оставить заявку на доступ») of each section lives. */
export const PAYWALL_HREF: Record<PaidSection, string> = { point_a: '/client/point-a', point_b: '/client/point-b', market: '/market', gri_full: '/gri' }

export function closedSections(access: SectionAccess): PaidSection[] {
  return (Object.keys(access) as PaidSection[]).filter((k) => !access[k])
}

/** Pure: the snapshot without the data of the closed sections (+ `paidLocked`). */
export function scrubAssistantContext(ctx: AssistantContext, access: SectionAccess): AssistantContext {
  const closed = closedSections(access)
  if (closed.length === 0) return ctx
  const out: AssistantContext = { ...ctx, paidLocked: closed }
  if (!access.point_a) {
    out.pointA = {
      has_diagnostic: ctx.pointA.has_diagnostic,
      overall_score: null,
      health_index: null,
      stage: null,
      blocks: [],
      weakest_blocks: [],
      blocks_without_data: [],
      assessment: ctx.pointA.assessment,
      risks: [],
      data_gaps: ctx.pointA.data_gaps,
      quick_wins: [],
    }
  }
  if (!access.point_b) {
    const b = ctx.pointB
    out.pointB = {
      has_goal: b.has_goal,
      current_revenue_year: b.current_revenue_year,
      goal_12m_revenue_year: b.goal_12m_revenue_year,
      goal_3y_revenue_year: b.goal_3y_revenue_year,
      gap: { multiplier: null, required_cagr: null, required_mom_growth: null, data_complete: false },
      realism: { level: 'locked', score: 0, rationale: [], weak_blocks: [] },
      data_sufficiency: { sufficient: false, confidence: 0, missing: [], have: [] },
      levers: [],
      top5_limits: [],
    }
  }
  if (!access.gri_full) {
    out.gri = { has_assessment: ctx.gri.has_assessment, gri_index: null, top_5_limits: [] }
  }
  // An LLM analysis is built from the full snapshot — never carried for a closed account.
  out.llm_analysis = null
  return out
}

/** A line for the LLM prompt: what is closed and what to say about it. Empty when nothing is closed. */
export function paidLockedPromptNote(ctx: AssistantContext, locale: Locale): string {
  const closed = ctx.paidLocked ?? []
  if (closed.length === 0) return ''
  if (locale === 'en') {
    return `PAID ACCESS: the sections ${closed.map((k) => LABEL_EN[k]).join(', ')} are closed for this user (free plan) — their data is NOT in the snapshot. If asked about them, say the details are available with paid access and suggest leaving an access request on the section's page. Never say there is no data and never guess numbers.\n\n`
  }
  return `ПЛАТНЫЙ ДОСТУП: разделы ${closed.map((k) => LABEL[k]).join(', ')} у пользователя закрыты (бесплатный тариф) — их данных в снимке НЕТ. Если спрашивают о них — скажи, что подробности доступны в платном доступе, и предложи оставить заявку на доступ на странице раздела. Не говори «данных нет» и не придумывай цифры.\n\n`
}

/**
 * Ready-made mascot answers (lib/assistant/chat-scripts.ts) that are about a
 * paid section. `whole`: the answer IS the section — closed → the paywall
 * answer instead. Otherwise the answer is kept (on the scrubbed snapshot) and a
 * note about paid access is added.
 */
export const PAID_SCRIPT_SECTIONS: Record<string, { sections: PaidSection[]; whole: boolean }> = {
  '7.1': { sections: ['point_a'], whole: false },
  '7.2': { sections: ['point_a'], whole: false },
  '7.5': { sections: ['point_a'], whole: true },
  '7.6': { sections: ['point_b'], whole: true },
  '7.7': { sections: ['gri_full'], whole: true },
  '7.9': { sections: ['gri_full', 'point_b'], whole: true },
  '7.11': { sections: ['point_b'], whole: false },
}

export interface PaidScriptOutcome {
  /** Replace the answer with this text (the whole answer is a closed section). */
  replace: string | null
  /** Append this note to the hydrated answer (part of it is a closed section). */
  note: string | null
  /** The first closed section of the script — its paywall. */
  paywall: { feature: PaidSection; href: string } | null
}

export function paidScriptOutcome(scriptId: string, access: SectionAccess, locale: Locale): PaidScriptOutcome {
  const def = PAID_SCRIPT_SECTIONS[scriptId]
  const closed = def ? def.sections.filter((s) => !access[s]) : []
  if (!def || closed.length === 0) return { replace: null, note: null, paywall: null }
  const en = locale === 'en'
  const names = closed.map((k) => (en ? LABEL_EN[k] : `«${LABEL[k]}»`)).join(en ? ', ' : ' и ')
  const paywall = { feature: closed[0], href: PAYWALL_HREF[closed[0]] }
  const text = en
    ? `${names} is available with paid access. Open the section and leave an access request — a manager will contact you (online payment is not connected yet).`
    : `Раздел ${names} — в платном доступе. Откройте раздел и оставьте заявку на доступ — менеджер свяжется с вами (онлайн-оплата пока не подключена).`
  const allClosed = closed.length === def.sections.length
  if (def.whole && allClosed) return { replace: text, note: null, paywall }
  return {
    replace: null,
    note: en ? `Details of ${names} are available with paid access.` : `Подробности по разделу ${names} — в платном доступе.`,
    paywall,
  }
}

/** The access the snapshot was built with (everything open but `ctx.paidLocked`). */
export function accessOfContext(ctx: AssistantContext): SectionAccess {
  const closed = new Set(ctx.paidLocked ?? [])
  return { point_a: !closed.has('point_a'), point_b: !closed.has('point_b'), market: !closed.has('market'), gri_full: !closed.has('gri_full') }
}
