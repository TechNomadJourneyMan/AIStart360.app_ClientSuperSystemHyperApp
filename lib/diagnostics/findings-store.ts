/**
 * lib/diagnostics/findings-store.ts — diagnostic_findings and
 * diagnostic_recommendations (085) written by the pipeline agents.
 *
 * Replace semantics per producer: an agent writes its complete current set;
 * findings it produced earlier that are not in the new set become
 * `superseded` (kept for history), unchanged ones are updated in place
 * (same fingerprint ⇒ same row, so a staff review survives a re-run as long as
 * the content did not change). Rules enforced here, not by the caller:
 *   • AI_HYPOTHESIS is never visible to the client before a staff review
 *     (also a CHECK constraint in 085);
 *   • every finding carries evidence; a finding without any is rejected;
 *   • confidence is clamped to 0..1, model output to ≤ AI_MAX_CONFIDENCE.
 */
import { createHash } from 'node:crypto'
import { prisma } from '@/lib/db'
import { stableStringify } from '@/lib/agents/tools'

export type FindingKind = 'risk' | 'gap' | 'bottleneck' | 'opportunity' | 'strength' | 'data_gap' | 'anomaly' | 'inconsistency'
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info'
export type FindingProvenance = 'FACT' | 'CALCULATED' | 'INFERRED' | 'AI_HYPOTHESIS'

export interface Evidence {
  /** survey | document | metric | diagnostic | benchmark | finding | platform */
  type: string
  ref: string
  field?: string
  value?: string | number | null
  quote?: string
  [extra: string]: unknown
}

export interface FindingDraft {
  /** Stable key within the producer (e.g. "inconsistency:biz.finansy.vyruchka_god"). */
  key: string
  kind: FindingKind
  area: string
  title: string
  body?: string | null
  severity: Severity
  provenance: FindingProvenance
  confidence: number
  evidence: Evidence[]
}

export interface RecommendationDraft {
  key: string
  area: string
  title: string
  body?: string | null
  expectedImpact?: string | null
  effort?: 'low' | 'medium' | 'high' | null
  priority: 1 | 2 | 3 | 4 | 5
  horizonDays?: 30 | 90 | 180 | 365 | null
  provenance: 'CALCULATED' | 'INFERRED' | 'AI_HYPOTHESIS' | 'RECOMMENDATION'
  confidence: number
  findingIds?: string[]
  /** Engine output the client already sees elsewhere may be visible; model output never is. */
  visibleToClient: boolean
}

export interface WriteMeta {
  companyId: string
  sessionId: string | null
  producedBy: string
  agentRunId: string | null
  model?: string | null
  promptVersion?: string | null
}

/** Model output never claims more certainty than this. */
export const AI_MAX_CONFIDENCE = 0.7

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0)

export function fingerprintOf(producedBy: string, key: string): string {
  return createHash('sha256').update(producedBy).update('\u0000').update(key).digest('hex').slice(0, 32)
}

function contentHash(d: { title: string; body?: string | null; severity?: string; evidence?: unknown }): string {
  // Stable key order: jsonb read back from Postgres does not keep insertion order.
  return createHash('sha256').update(stableStringify([d.title, d.body ?? null, d.severity ?? null, d.evidence ?? null])).digest('hex').slice(0, 16)
}

export interface WriteFindingsResult {
  inserted: number
  updated: number
  superseded: number
  rejected: number
  /** Drafts a staff member dismissed before (same fingerprint) — not inserted again. */
  suppressed: number
  /** Active rows after the write that are new (inserted) and critical. */
  newCritical: Array<{ id: string; title: string; area: string }>
  ids: string[]
}

export async function replaceFindings(meta: WriteMeta, drafts: FindingDraft[]): Promise<WriteFindingsResult> {
  const res: WriteFindingsResult = { inserted: 0, updated: 0, superseded: 0, rejected: 0, suppressed: 0, newCritical: [], ids: [] }
  const seen = new Set<string>()
  const valid: Array<FindingDraft & { fingerprint: string }> = []
  for (const d of drafts) {
    const fp = fingerprintOf(meta.producedBy, d.key)
    if (seen.has(fp) || !d.title.trim() || d.evidence.length === 0) {
      res.rejected += 1
      continue
    }
    seen.add(fp)
    const confidence = d.provenance === 'AI_HYPOTHESIS' ? Math.min(clamp01(d.confidence), AI_MAX_CONFIDENCE) : clamp01(d.confidence)
    valid.push({ ...d, title: d.title.trim().slice(0, 300), confidence, fingerprint: fp })
  }

  await prisma.$transaction(async (tx) => {
    const fps = valid.map((v) => v.fingerprint)
    res.superseded = await tx.$executeRaw`
      UPDATE public.diagnostic_findings SET status = 'superseded'
      WHERE company_id = ${meta.companyId} AND produced_by = ${meta.producedBy} AND status = 'active'
        AND (fingerprint IS NULL OR NOT (fingerprint = ANY(${fps}::text[])))`

    for (const f of valid) {
      const hidden = f.provenance === 'AI_HYPOTHESIS'
      // Serialised once: what is stored is also what is compared (undefined fields dropped).
      const evidence = JSON.stringify(f.evidence)
      const existing = await tx.$queryRaw<Array<{ id: string; evidence: unknown; title: string; body: string | null; severity: string }>>`
        SELECT id, evidence, title, body, severity FROM public.diagnostic_findings
        WHERE company_id = ${meta.companyId} AND fingerprint = ${f.fingerprint} AND status = 'active'
        FOR UPDATE`
      if (existing[0]) {
        const old = existing[0]
        const changed = contentHash({ title: old.title, body: old.body, severity: old.severity, evidence: old.evidence }) !==
          contentHash({ title: f.title, body: f.body ?? null, severity: f.severity, evidence: JSON.parse(evidence) })
        // Changed content loses its review: staff must look again before a client sees it.
        await tx.$executeRaw`
          UPDATE public.diagnostic_findings SET
            session_id = ${meta.sessionId}::uuid, kind = ${f.kind}, area = ${f.area}, title = ${f.title},
            body = ${f.body ?? null}, severity = ${f.severity}, provenance_type = ${f.provenance},
            confidence = ${f.confidence.toFixed(2)}::text::numeric, evidence = ${evidence}::jsonb,
            agent_run_id = ${meta.agentRunId}::uuid, model = ${meta.model ?? null}, prompt_version = ${meta.promptVersion ?? null},
            reviewed_by = CASE WHEN ${changed} THEN NULL ELSE reviewed_by END,
            reviewed_at = CASE WHEN ${changed} THEN NULL ELSE reviewed_at END,
            visible_to_client = CASE WHEN ${hidden} AND ${changed} THEN FALSE
                                     WHEN ${hidden} THEN visible_to_client
                                     ELSE TRUE END
          WHERE id = ${old.id}::uuid`
        res.updated += 1
        res.ids.push(old.id)
      } else {
        // A staff member dismissed this finding before: it does not come back
        // as a new unreviewed row. A model hypothesis is matched by its
        // fingerprint alone (its key is its title; the wording of the body
        // changes on every run); a rule finding only while its content is the
        // same — new numbers deserve a new look.
        const dismissed = await tx.$queryRaw<Array<{ evidence: unknown; title: string; body: string | null; severity: string }>>`
          SELECT evidence, title, body, severity FROM public.diagnostic_findings
          WHERE company_id = ${meta.companyId} AND fingerprint = ${f.fingerprint} AND status = 'dismissed'
          ORDER BY updated_at DESC LIMIT 1`
        const d = dismissed[0]
        if (d && (hidden || contentHash({ title: d.title, body: d.body, severity: d.severity, evidence: d.evidence }) ===
          contentHash({ title: f.title, body: f.body ?? null, severity: f.severity, evidence: JSON.parse(evidence) }))) {
          res.suppressed += 1
          continue
        }
        const rows = await tx.$queryRaw<Array<{ id: string }>>`
          INSERT INTO public.diagnostic_findings
            (company_id, session_id, kind, area, title, body, severity, provenance_type, confidence, evidence,
             produced_by, agent_run_id, model, prompt_version, fingerprint, visible_to_client)
          VALUES (${meta.companyId}, ${meta.sessionId}::uuid, ${f.kind}, ${f.area}, ${f.title}, ${f.body ?? null},
                  ${f.severity}, ${f.provenance}, ${f.confidence.toFixed(2)}::text::numeric, ${evidence}::jsonb,
                  ${meta.producedBy}, ${meta.agentRunId}::uuid, ${meta.model ?? null}, ${meta.promptVersion ?? null},
                  ${f.fingerprint}, ${!hidden})
          RETURNING id`
        res.inserted += 1
        res.ids.push(rows[0].id)
        if (f.severity === 'critical') res.newCritical.push({ id: rows[0].id, title: f.title, area: f.area })
      }
    }
  })
  return res
}

export interface ActiveFindingRow {
  id: string
  kind: FindingKind
  area: string
  title: string
  body: string | null
  severity: Severity
  provenance_type: FindingProvenance | 'RECOMMENDATION'
  confidence: number
  evidence: Evidence[]
  produced_by: string
  visible_to_client: boolean
  reviewed_at: Date | null
}

export async function activeFindings(companyId: string): Promise<ActiveFindingRow[]> {
  const rows = await prisma.$queryRaw<ActiveFindingRow[]>`
    SELECT id, kind, area, title, body, severity, provenance_type, confidence, evidence, produced_by,
           visible_to_client, reviewed_at
    FROM public.diagnostic_findings
    WHERE company_id = ${companyId} AND status = 'active'
    ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
             created_at DESC, id
    LIMIT 200`
  return rows.map((r) => ({ ...r, confidence: Number(r.confidence) }))
}

export interface WriteRecommendationsResult {
  inserted: number
  superseded: number
  rejected: number
  /** Drafts that repeat an accepted, rejected or done recommendation (or each other) — not inserted. */
  suppressed: number
}

/** Title as compared for «the same action»: case, spacing and trailing punctuation ignored. */
export function normalizeRecommendationTitle(title: string): string {
  return title.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').replace(/[\s.!;:,…]+$/u, '').trim()
}

/**
 * Replace the producer's PROPOSED recommendations. Accepted, rejected or done
 * ones are decisions of people and are never touched — and a draft with the
 * same title as one of them is not proposed again (a rejected action does not
 * return to the review queue, an accepted one is not duplicated).
 */
export async function replaceRecommendations(meta: WriteMeta, drafts: RecommendationDraft[]): Promise<WriteRecommendationsResult> {
  const res: WriteRecommendationsResult = { inserted: 0, superseded: 0, rejected: 0, suppressed: 0 }
  const valid = drafts.filter((d) => {
    const ok = d.title.trim().length > 0
    if (!ok) res.rejected += 1
    return ok
  })
  await prisma.$transaction(async (tx) => {
    res.superseded = await tx.$executeRaw`
      UPDATE public.diagnostic_recommendations SET status = 'superseded'
      WHERE company_id = ${meta.companyId} AND produced_by = ${meta.producedBy} AND status = 'proposed'`
    const decided = await tx.$queryRaw<Array<{ title: string }>>`
      SELECT title FROM public.diagnostic_recommendations
      WHERE company_id = ${meta.companyId} AND status IN ('accepted', 'rejected', 'done')`
    const taken = new Set(decided.map((r) => normalizeRecommendationTitle(r.title)))
    for (const d of valid) {
      const norm = normalizeRecommendationTitle(d.title)
      if (taken.has(norm)) {
        res.suppressed += 1
        continue
      }
      taken.add(norm)
      const model = d.provenance === 'AI_HYPOTHESIS' || meta.model
      const visible = model ? false : d.visibleToClient
      const confidence = model ? Math.min(clamp01(d.confidence), AI_MAX_CONFIDENCE) : clamp01(d.confidence)
      await tx.$executeRaw`
        INSERT INTO public.diagnostic_recommendations
          (company_id, session_id, finding_ids, area, title, body, expected_impact, effort, priority, horizon_days,
           provenance_type, confidence, produced_by, agent_run_id, model, prompt_version, visible_to_client)
        VALUES (${meta.companyId}, ${meta.sessionId}::uuid, ${d.findingIds ?? []}::uuid[], ${d.area},
                ${d.title.trim().slice(0, 300)}, ${d.body ?? null}, ${d.expectedImpact ?? null}, ${d.effort ?? null},
                ${String(d.priority)}::text::smallint, ${d.horizonDays == null ? null : String(d.horizonDays)}::text::smallint, ${d.provenance},
                ${confidence.toFixed(2)}::text::numeric, ${meta.producedBy}, ${meta.agentRunId}::uuid,
                ${meta.model ?? null}, ${meta.promptVersion ?? null}, ${visible})`
      res.inserted += 1
    }
  })
  return res
}
