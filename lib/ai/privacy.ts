/**
 * OpenRouter provider preferences for client data (shared by the gateway and
 * the legacy chat client). AI_PRIVACY_MODE:
 *   deny   (default) providers may not store or train on prompts
 *   strict deny + zero-data-retention providers only
 *   off    no restriction
 */
export function privacyProvider(): Record<string, unknown> | undefined {
  const mode = (process.env.AI_PRIVACY_MODE ?? 'deny').toLowerCase()
  if (mode === 'off') return undefined
  if (mode === 'strict') return { data_collection: 'deny', zdr: true }
  return { data_collection: 'deny' }
}
