import type { OmnichannelChannel } from './types'

export interface OmnichannelAutoReplyReadinessInput {
  channel: OmnichannelChannel
  enabled: boolean
  mode: 'off' | 'draft' | 'auto'
  businessContext: string | null | undefined
  metaConfigured: boolean
  whatsAppWebConfigured?: boolean
}

export interface OmnichannelAutoReplyReadiness {
  ready: boolean
  missing: Array<'business_context' | 'provider_configuration'>
}

/** Presence-only preflight; secrets never leave the server. */
export function getOmnichannelAutoReplyReadiness(
  input: OmnichannelAutoReplyReadinessInput,
): OmnichannelAutoReplyReadiness {
  const missing: OmnichannelAutoReplyReadiness['missing'] = []
  if (!input.businessContext?.trim()) missing.push('business_context')
  const providerConfigured = input.metaConfigured
    || (input.channel === 'whatsapp' && input.whatsAppWebConfigured === true)
  if (!providerConfigured) missing.push('provider_configuration')
  return { ready: missing.length === 0, missing }
}
