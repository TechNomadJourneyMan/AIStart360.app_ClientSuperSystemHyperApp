/**
 * lib/point-a/template-impact.ts — which companies a change of an industry
 * template of Point A touches (GIGA-CRM «Шаблоны Точки А», spec 2026-10-12
 * §2.2 / §9 row 6).
 *
 * A company uses a template either explicitly (pa_company_config.template_key,
 * chosen by an expert) or by its industry (pickTemplate over the template
 * list). After a template is created, edited or deleted, a company must be
 * recalculated when:
 *   - it names the template explicitly;
 *   - it has no explicit template and its industry resolved to the template
 *     before or after the change, or now resolves to another template.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { pickTemplate, type BlockTemplate } from './v4/config'
import { asTemplate } from './v4/store'
import { requestPointARecalc } from './recalc-queue'

export interface CompanyTemplateRow {
  id: string
  industry: string | null
  /** pa_company_config.template_key (null / absent = by industry). */
  templateKey: string | null
}

/** Max companies one template change enqueues (the rest catch up on their next event). */
export const TEMPLATE_RECALC_CAP = 500

export function companiesAffectedByTemplate(
  companies: readonly CompanyTemplateRow[],
  key: string,
  before: readonly BlockTemplate[],
  after: readonly BlockTemplate[],
): string[] {
  const out: string[] = []
  for (const c of companies) {
    if (c.templateKey) {
      // An explicit template that is gone (deleted, or never existed) falls back to the industry one.
      const explicitBefore = before.some((t) => t.key === c.templateKey)
      const explicitAfter = after.some((t) => t.key === c.templateKey)
      if (c.templateKey === key) { out.push(c.id); continue }
      if (explicitBefore && explicitAfter) continue
    }
    const b = pickTemplate(c.industry, before).key
    const a = pickTemplate(c.industry, after).key
    if (b === key || a === key || a !== b) out.push(c.id)
  }
  return out
}

/** How many companies use each template: explicitly, and by industry. */
export function templateUsage(companies: readonly CompanyTemplateRow[], templates: readonly BlockTemplate[]): Record<string, { explicit: number; auto: number }> {
  const out: Record<string, { explicit: number; auto: number }> = {}
  for (const t of templates) out[t.key] = { explicit: 0, auto: 0 }
  for (const c of companies) {
    if (c.templateKey && out[c.templateKey]) { out[c.templateKey].explicit++; continue }
    const k = pickTemplate(c.industry, templates).key
    if (out[k]) out[k].auto++
  }
  return out
}

/** The templates as the engine reads them (lib/point-a/v4/store.ts). */
export async function loadTemplates(sb: SupabaseClient): Promise<BlockTemplate[]> {
  const { data, error } = await sb.from('pa_templates').select('key, title, industries, blocks, version').order('key', { ascending: true })
  if (error) throw new Error(`pa_templates read failed (${error.code ?? 'unknown'})`)
  return ((data ?? []) as Array<Record<string, unknown>>).map(asTemplate).filter((x): x is BlockTemplate => x !== null)
}

/** Every company with its industry and explicit template. */
export async function loadCompanyTemplates(sb: SupabaseClient): Promise<CompanyTemplateRow[]> {
  const [companies, configs] = await Promise.all([
    sb.from('companies').select('id, industry').limit(20000),
    sb.from('pa_company_config').select('company_id, template_key').limit(20000),
  ])
  if (companies.error) throw new Error(`companies read failed (${companies.error.code ?? 'unknown'})`)
  if (configs.error) throw new Error(`pa_company_config read failed (${configs.error.code ?? 'unknown'})`)
  const explicit = new Map<string, string | null>()
  for (const r of (configs.data ?? []) as Array<{ company_id: string; template_key: string | null }>) explicit.set(r.company_id, r.template_key ?? null)
  return ((companies.data ?? []) as Array<{ id: string; industry: string | null }>).map((c) => ({
    id: c.id, industry: c.industry ?? null, templateKey: explicit.get(c.id) ?? null,
  }))
}

/**
 * Queue the recalculation of every affected company (capped). Never throws:
 * the template is already saved, a failed enqueue is logged.
 */
export async function enqueueTemplateRecalc(companies: readonly CompanyTemplateRow[], key: string, before: readonly BlockTemplate[], after: readonly BlockTemplate[]): Promise<{ affected: number; queued: number; capped: boolean }> {
  const ids = companiesAffectedByTemplate(companies, key, before, after)
  const batch = ids.slice(0, TEMPLATE_RECALC_CAP)
  if (ids.length > batch.length) {
    console.warn(`[point-a/templates] ${key}: ${ids.length} companies affected, recalculating the first ${TEMPLATE_RECALC_CAP}`)
  }
  let queued = 0
  for (let i = 0; i < batch.length; i += 25) {
    const res = await Promise.all(batch.slice(i, i + 25).map((id) => requestPointARecalc(id, 'template_changed')))
    queued += res.filter(Boolean).length
  }
  return { affected: ids.length, queued, capped: ids.length > batch.length }
}
