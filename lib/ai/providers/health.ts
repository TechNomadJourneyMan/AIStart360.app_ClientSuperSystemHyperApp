/**
 * lib/ai/providers/health.ts — in-memory health of call targets (circuit
 * breaker, part A1 of docs/superpowers/specs/2026-10-08-ai-providers-automation-bot-brain-design.md).
 *
 * A target (provider + model + key) that failed with a failover-worthy error
 * (401/403/404/408/429/5xx, timeout, network) is "unhealthy" for
 * UNHEALTHY_FOR_MS: the router moves it behind healthy candidates. A success
 * clears it. Per server instance, never persisted — a cold instance simply
 * starts with everything healthy. The last error is kept for the GIGA
 * «Кто отвечает сейчас» block (sanitised text only, never a key).
 */
import type { ProviderTarget } from './types'

export const UNHEALTHY_FOR_MS = 5 * 60_000

export interface TargetHealth {
  /** Unhealthy until this time (ms since epoch); null = healthy. */
  unhealthyUntil: number | null
  lastError: string | null
  lastErrorAt: number | null
  lastSuccessAt: number | null
  failures: number
}

const state = new Map<string, TargetHealth>()

type TargetRef = Pick<ProviderTarget, 'providerKey' | 'model' | 'credentialId'>

export function healthKey(t: TargetRef): string {
  return `${t.providerKey}\u0000${t.model}\u0000${t.credentialId ?? 'env'}`
}

function entry(t: TargetRef): TargetHealth {
  const k = healthKey(t)
  let e = state.get(k)
  if (!e) {
    e = { unhealthyUntil: null, lastError: null, lastErrorAt: null, lastSuccessAt: null, failures: 0 }
    state.set(k, e)
  }
  return e
}

export function markFailure(t: TargetRef, error: string, now = Date.now()): void {
  const e = entry(t)
  e.unhealthyUntil = now + UNHEALTHY_FOR_MS
  e.lastError = error.slice(0, 300)
  e.lastErrorAt = now
  e.failures += 1
}

export function markSuccess(t: TargetRef, now = Date.now()): void {
  const e = entry(t)
  e.unhealthyUntil = null
  e.lastSuccessAt = now
  e.failures = 0
}

export function isHealthy(t: TargetRef, now = Date.now()): boolean {
  const e = state.get(healthKey(t))
  return !e || e.unhealthyUntil === null || e.unhealthyUntil <= now
}

/** Health snapshot of one target (null = never called on this instance). */
export function healthOf(t: TargetRef): TargetHealth | null {
  const e = state.get(healthKey(t))
  return e ? { ...e } : null
}

/** Tests only. */
export function resetHealth(): void {
  state.clear()
}
