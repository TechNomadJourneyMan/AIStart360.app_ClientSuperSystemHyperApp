/**
 * lib/assistant/validators/index.ts — runValidation() orchestrator.
 *
 * The single entry point used by API routes / completion. Composes the three
 * validation layers and returns a clean, deduped, severity-sorted issue list:
 *
 *   Layer 1  runDeterministicValidators()  — pure field checks (always sync)
 *   Layer 2  runRules()                    — configurable inconsistency rules (sync)
 *   Layer 3  llmSemanticChecks()           — optional OpenRouter contradiction /
 *                                            vagueness pass, ONLY when the caller
 *                                            opts in AND an OpenRouter key exists
 *
 * Anti-hallucination: Layer 3 reads the curated AssistantContext only (it is the
 * sole structure ever serialized into a prompt) and is skipped silently when no
 * key is configured — the deterministic layers always produce a useful result.
 */

import { hasOpenRouterKey } from '@/lib/ai/structured'
import type { AssistantContext, ValidationIssue } from '../types'
import { runDeterministicValidators } from './deterministic'
import { runRules } from './rules'

export { runDeterministicValidators } from './deterministic'
export { runRules, RULES, type DiagnosticRule } from './rules'

export interface RunValidationOptions {
  /** Opt in to the Layer-3 LLM semantic pass (off by default — it costs a call). */
  includeLlm?: boolean
}

// ─── Merge / dedupe / sort ──────────────────────────────────────────────────

const SEVERITY_ORDER: Record<ValidationIssue['severity'], number> = {
  error: 0,
  warning: 1,
  info: 2,
}

/**
 * Dedupe by issue id (a stable per-(section,field,code) key). When two layers
 * report the "same" id, the higher-severity copy wins (error > warning > info)
 * so an LLM "info" never downgrades a deterministic "error".
 */
function mergeIssues(...lists: ValidationIssue[][]): ValidationIssue[] {
  const byId = new Map<string, ValidationIssue>()
  for (const list of lists) {
    for (const it of list) {
      const existing = byId.get(it.id)
      if (!existing || SEVERITY_ORDER[it.severity] < SEVERITY_ORDER[existing.severity]) {
        byId.set(it.id, it)
      }
    }
  }
  return [...byId.values()].sort((a, b) => {
    const s = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
    if (s !== 0) return s
    // Stable secondary order: by section then id for deterministic output.
    if (a.section !== b.section) return a.section.localeCompare(b.section)
    return a.id.localeCompare(b.id)
  })
}

// ─── Layer 3 loader (soft dependency on lib/assistant/llm-analyzer.ts) ──────

/**
 * Lazily load llmSemanticChecks from the llm-analyzer module. That module is a
 * later task in the build order, so we resolve it dynamically and degrade to an
 * empty result if it isn't present yet — validation never hard-fails on it.
 */
async function loadLlmSemanticChecks(): Promise<
  ((ctx: AssistantContext) => Promise<ValidationIssue[]>) | null
> {
  try {
    const mod = (await import('../llm-analyzer')) as {
      llmSemanticChecks?: (ctx: AssistantContext) => Promise<ValidationIssue[]>
    }
    return typeof mod.llmSemanticChecks === 'function' ? mod.llmSemanticChecks : null
  } catch {
    // Module not built yet (or failed to import) — Layers 1+2 still stand.
    return null
  }
}

// ─── runValidation ──────────────────────────────────────────────────────────

/**
 * Run validation over the curated context. Layers 1+2 run synchronously and
 * always; Layer 3 runs only when `includeLlm` is true AND an OpenRouter key is
 * configured AND the llm-analyzer module exposes llmSemanticChecks.
 *
 * Returns the merged, deduped, severity-sorted ValidationIssue[].
 */
export async function runValidation(
  ctx: AssistantContext,
  opts: RunValidationOptions = {},
): Promise<ValidationIssue[]> {
  const deterministic = runDeterministicValidators(ctx)
  const rules = runRules(ctx)

  let llm: ValidationIssue[] = []
  if (opts.includeLlm && hasOpenRouterKey()) {
    const check = await loadLlmSemanticChecks()
    if (check) {
      try {
        llm = (await check(ctx)) ?? []
      } catch (err) {
        // Honest fallback: LLM failure never invalidates the deterministic result.
        console.error('[assistant/validators] llmSemanticChecks failed:', err)
        llm = []
      }
    }
  }

  return mergeIssues(deterministic, rules, llm)
}
