/**
 * lib/ai/providers/overview.ts — «Кто отвечает сейчас» (GIGA, part A1): for
 * every capability (chat per tier) the target a call would use right now, the
 * next candidates, and the in-memory health of the first one. Health is per
 * server instance (health.ts) — another instance may know about other errors.
 * Never returns a key.
 */
import { modelForTier } from '@/lib/ai/gateway'
import { healthOf, isHealthy } from './health'
import { getProviderSnapshot, resolveCandidates } from './router'
import { CHAT_TIERS, type AiCapability, type ChatTier, type ProviderTarget } from './types'

export interface TargetView {
  providerKey: string
  providerName: string
  model: string
  /** 'db' = configured model; 'env' = built-in OpenRouter. */
  origin: 'db' | 'env'
  credentialLabel: string | null
  healthy: boolean
}

export interface SlotStatus {
  capability: AiCapability
  tier: ChatTier | null
  /** Who answers now (first candidate); null = nobody (see `problem`). */
  current: TargetView | null
  /** Next candidates, in failover order (at most 4). */
  next: TargetView[]
  /** Last error of the current target on this server instance. */
  lastError: string | null
  lastErrorAt: string | null
  unhealthyUntil: string | null
  /** Why nothing answers (no key / nothing configured). */
  problem: string | null
}

const iso = (ms: number | null) => (ms ? new Date(ms).toISOString() : null)

export async function routingStatus(): Promise<SlotStatus[]> {
  const snapshot = await getProviderSnapshot()
  const credLabel = (id: string | null) => (id ? snapshot.credentials.find((c) => c.id === id)?.label ?? null : null)
  const view = (t: ProviderTarget): TargetView => ({
    providerKey: t.providerKey, providerName: t.providerName, model: t.model, origin: t.origin,
    credentialLabel: credLabel(t.credentialId), healthy: isHealthy(t),
  })
  const slots: Array<{ capability: AiCapability; tier: ChatTier | null; fallbackModel?: string }> = [
    ...CHAT_TIERS.map((tier) => ({ capability: 'chat' as const, tier, fallbackModel: modelForTier(tier) })),
    { capability: 'embeddings', tier: null, fallbackModel: 'openai/text-embedding-3-small' },
    { capability: 'rerank', tier: null },
    { capability: 'ocr', tier: null },
    { capability: 'transcribe', tier: null },
  ]
  const out: SlotStatus[] = []
  for (const s of slots) {
    const r = await resolveCandidates(s.capability, { tier: s.tier, fallbackModel: s.fallbackModel, maxCandidates: 5 })
    if (!r.ok) {
      out.push({ capability: s.capability, tier: s.tier, current: null, next: [], lastError: null, lastErrorAt: null, unhealthyUntil: null, problem: r.message })
      continue
    }
    const [first, ...rest] = r.candidates
    const h = healthOf(first)
    out.push({
      capability: s.capability,
      tier: s.tier,
      current: view(first),
      next: rest.slice(0, 4).map(view),
      lastError: h?.lastError ?? null,
      lastErrorAt: iso(h?.lastErrorAt ?? null),
      unhealthyUntil: h && h.unhealthyUntil && h.unhealthyUntil > Date.now() ? iso(h.unhealthyUntil) : null,
      problem: null,
    })
  }
  return out
}
