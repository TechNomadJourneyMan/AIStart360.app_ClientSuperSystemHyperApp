/**
 * lib/ai/personas/types.ts — Named AI-Agent (persona) shape.
 *
 * A persona is a *mode of thinking* for ГРИ, orthogonal to the visual character
 * skin (lib/assistant/mascot/characters.ts). It changes tone, focus and the
 * required answer structure — never the facts or the risk assessment. See
 * docs/SPEC-2026-07-09-AI-FEATURES/06-named-agents.md.
 */

export type PersonaLevel = 'low' | 'medium' | 'high'
export type PersonaTier = 'free' | 'pro'

export interface GriPersona {
  id: string
  name: string
  emoji: string
  /** 1–2 sentence description shown in the UI persona picker. */
  shortDescription: string
  /** Internal note on motivation/thinking (not user-facing). */
  psychology: string
  strengths: string[]
  weaknesses: string[]
  businessSkills: string[]
  communicationStyle: string
  riskAppetite: PersonaLevel
  analytical: PersonaLevel
  empathy: PersonaLevel
  directness: PersonaLevel
  creativity: PersonaLevel
  useWhen: string[]
  avoidWhen: string[]
  /** Deltas on top of the shared safety rules. */
  safetyRules: string[]
  /** System-prompt fragment injected for this mode. */
  promptBlock: string
  /** Short interface description. */
  userFacing: string
  /** What the validator additionally checks for this persona. */
  intakeRules: string[]
  /** Tariff gate: free = MVP personas, pro = full roster. */
  tier: PersonaTier
}
