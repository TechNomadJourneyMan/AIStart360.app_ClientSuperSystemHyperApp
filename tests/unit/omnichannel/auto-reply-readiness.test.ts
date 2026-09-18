import { describe, expect, it } from 'vitest'
import { getOmnichannelAutoReplyReadiness } from '@/lib/omnichannel/auto-reply-readiness'

describe('omnichannel auto-reply readiness', () => {
  it('requires both provider configuration and verified business context', () => {
    expect(getOmnichannelAutoReplyReadiness({
      channel: 'instagram',
      enabled: true,
      mode: 'auto',
      businessContext: '',
      metaConfigured: false,
    })).toEqual({
      ready: false,
      missing: ['business_context', 'provider_configuration'],
    })
  })

  it('accepts official Meta configuration for either channel', () => {
    expect(getOmnichannelAutoReplyReadiness({
      channel: 'instagram',
      enabled: true,
      mode: 'auto',
      businessContext: 'Honor Group facts',
      metaConfigured: true,
    }).ready).toBe(true)
  })

  it('accepts a configured QR bridge as the WhatsApp transport', () => {
    expect(getOmnichannelAutoReplyReadiness({
      channel: 'whatsapp',
      enabled: true,
      mode: 'auto',
      businessContext: 'Honor Group facts',
      metaConfigured: false,
      whatsAppWebConfigured: true,
    }).ready).toBe(true)
  })
})
