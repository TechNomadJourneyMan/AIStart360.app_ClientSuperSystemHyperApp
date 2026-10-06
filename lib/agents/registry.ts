/**
 * lib/agents/registry.ts — the set of agent definitions known to the runtime.
 *
 * Definitions are code (reviewed in PRs). Admin overrides live in
 * agent_configs / agent_permission_grants and never add tools or loosen a
 * permission past its ceiling.
 */
import type { PlatformEventName } from '@/lib/events/platform-names'
import type { AgentDefinition } from './types'

const definitions = new Map<string, AgentDefinition<any>>()
let loaded = false

export function registerAgent(def: AgentDefinition<any>): void {
  if (!/^[a-z][a-z0-9_]{2,63}$/.test(def.key)) throw new Error(`bad agent key ${def.key}`)
  definitions.set(def.key, def)
}

/**
 * Built-in agents register themselves on first use. A lazy require breaks the
 * registry ↔ definitions import cycle (definitions call registerAgent).
 */
function ensureLoaded(): void {
  if (loaded) return
  loaded = true
  require('./definitions')
}

export function getAgent(key: string): AgentDefinition<any> | undefined {
  ensureLoaded()
  return definitions.get(key)
}

export function listAgents(): AgentDefinition<any>[] {
  ensureLoaded()
  return [...definitions.values()].sort((a, b) => a.key.localeCompare(b.key))
}

export function agentsSubscribedTo(event: PlatformEventName): AgentDefinition<any>[] {
  return listAgents().filter((a) => a.triggers?.events?.includes(event))
}

/** Tests register their own agents without loading the built-ins. */
export function __useTestAgents(defs: AgentDefinition<any>[]): void {
  definitions.clear()
  loaded = true
  for (const d of defs) registerAgent(d)
}
