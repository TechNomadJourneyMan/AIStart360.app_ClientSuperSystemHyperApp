/**
 * lib/point-a/v4/store.ts — the block configuration of a company from
 * public.pa_templates / public.pa_company_config (migration 111). Before the
 * migration (or on a template that is gone) the code templates of
 * lib/point-a/v4/config.ts are used, so Point A always has a configuration.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { hashOf } from '../snapshot-diff'
import {
  BLOCK_KEYS,
  CODE_TEMPLATES,
  configFingerprint,
  configVersion,
  effectiveBlocks,
  isBlockKey,
  pickTemplate,
  type BlockTemplate,
  type CompanyBlockConfig,
  type EffectiveBlock,
  type TemplateBlock,
} from './config'

export interface LoadedBlockConfig {
  template: BlockTemplate
  company: CompanyBlockConfig
  blocks: EffectiveBlock[]
  version: string
}

function missing(e: { code?: string } | null): boolean {
  return !!e && (e.code === '42P01' || e.code === 'PGRST205')
}

/** A row of public.pa_templates → BlockTemplate (null when it has no valid blocks). */
export function asTemplate(r: Record<string, unknown>): BlockTemplate | null {
  const blocks = Array.isArray(r.blocks)
    ? (r.blocks as Array<Record<string, unknown>>)
        .filter((b) => isBlockKey(b.key))
        .map((b): TemplateBlock => ({ key: b.key as TemplateBlock['key'], weight: Number(b.weight) || 0, enabled: b.enabled !== false }))
    : []
  if (!blocks.length || typeof r.key !== 'string') return null
  return {
    key: r.key,
    title: String(r.title ?? r.key),
    industries: Array.isArray(r.industries) ? (r.industries as string[]) : [],
    blocks,
    version: Number(r.version) || 1,
  }
}

export async function loadBlockConfig(client: SupabaseClient, companyId: string, industry: string | null): Promise<LoadedBlockConfig> {
  let templates: readonly BlockTemplate[] = CODE_TEMPLATES
  // Both reads at once (one round trip instead of two).
  const [tq, cq] = await Promise.all([
    client.from('pa_templates').select('key, title, industries, blocks, version').order('key', { ascending: true }),
    client.from('pa_company_config').select('template_key, expert_overrides, client_view, version').eq('company_id', companyId).maybeSingle(),
  ])
  if (!tq.error) {
    const fromDb = ((tq.data ?? []) as Array<Record<string, unknown>>).map(asTemplate).filter((x): x is BlockTemplate => x !== null)
    if (fromDb.length) templates = fromDb
  } else if (!missing(tq.error)) {
    throw new Error(`point-a: templates read failed (${tq.error.code ?? 'unknown'})`)
  }

  let company: CompanyBlockConfig = {}
  if (cq.error && !missing(cq.error)) throw new Error(`point-a: block config read failed (${cq.error.code ?? 'unknown'})`)
  if (cq.data) {
    const d = cq.data as Record<string, unknown>
    company = {
      templateKey: (d.template_key as string | null) ?? null,
      expertOverrides: (d.expert_overrides as CompanyBlockConfig['expertOverrides']) ?? {},
      clientView: (d.client_view as CompanyBlockConfig['clientView']) ?? {},
      version: Number(d.version) || 1,
    }
  }

  const template = (company.templateKey && templates.find((t) => t.key === company.templateKey)) || pickTemplate(industry, templates)
  return {
    template, company, blocks: effectiveBlocks(template, company),
    version: `${configVersion(template, company)}#${hashOf(configFingerprint(template, company), 10)}`,
  }
}

export { BLOCK_KEYS }
