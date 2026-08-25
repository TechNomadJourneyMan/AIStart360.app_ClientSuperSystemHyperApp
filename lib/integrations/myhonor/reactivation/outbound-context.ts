import { ingestNormalizedMessage } from '@/lib/omnichannel/repository'
import type { NormalizedOmnichannelMessage } from '@/lib/omnichannel/types'
import { decryptContactValue } from './identity'
import {
  getMyHonorReactivationOutboundContext,
  type MyHonorReactivationOutboundContext,
} from './repository'
import {
  getMyHonorReactivationConfiguration,
  type MyHonorReactivationConfiguration,
  type MyHonorReactivationSegment,
} from './types'
import { renderMyHonorTemplateBody } from './templates'

function summaryText(
  segment: MyHonorReactivationSegment,
  parameters: readonly string[],
): string {
  const rendered = renderMyHonorTemplateBody(segment, 'ru', parameters)
  if (!rendered) throw new Error('invalid reactivation template context')
  return rendered
}

function templateParameters(ciphertext: string, masterKey: string): string[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(decryptContactValue(ciphertext, masterKey)) as unknown
  } catch {
    throw new Error('invalid encrypted reactivation context')
  }
  if (
    !Array.isArray(parsed)
    || parsed.length > 20
    || parsed.some((item) =>
      typeof item !== 'string'
      || item !== item.trim()
      || item.length < 1
      || item.length > 1_024,
    )
  ) {
    throw new Error('invalid reactivation context parameters')
  }
  return parsed as string[]
}

interface InboundContextDependencies {
  configuration?: MyHonorReactivationConfiguration
  getContext?: typeof getMyHonorReactivationOutboundContext
  ingest?: typeof ingestNormalizedMessage
}

/**
 * Restores the exact accepted offer into the unified inbox only after the
 * customer has replied. The inbound message has already created the legacy
 * WhatsApp identity, so proactive-only contacts are never copied into that
 * plaintext store. This is audit context, never a second provider send.
 */
export async function recordMyHonorReactivationInboundContext(
  input: {
    event: NormalizedOmnichannelMessage
    recipientId: string
  },
  dependencies: InboundContextDependencies = {},
): Promise<boolean> {
  if (input.event.channel !== 'whatsapp' || input.event.direction !== 'in') {
    return false
  }
  const configuration = dependencies.configuration
    ?? getMyHonorReactivationConfiguration()
  if (!configuration.masterKey) return false
  const context = await (dependencies.getContext
    ?? getMyHonorReactivationOutboundContext)({
    recipientId: input.recipientId,
    configuration,
  })
  if (!context) return false
  const parameters = templateParameters(
    context.templateParametersCiphertext,
    configuration.masterKey,
  )
  await (dependencies.ingest ?? ingestNormalizedMessage)({
    eventType: 'message',
    channel: 'whatsapp',
    accountExternalId: input.event.accountExternalId,
    conversationExternalId: input.event.conversationExternalId,
    contactExternalId: input.event.contactExternalId,
    contactName: null,
    contactPhone: input.event.contactPhone,
    externalMessageId: `myhonor-reactivation-context:${context.recipientId}`,
    direction: 'out',
    messageType: 'text',
    text: summaryText(context.segment, parameters),
    status: 'sent',
    replyToExternalId: null,
    occurredAt: context.providerAcceptedAt,
    metadata: {
      transport: 'whatsapp_cloud',
      source: 'myhonor_reactivation',
      campaignId: context.campaignId,
      recipientId: context.recipientId,
      segment: context.segment,
      templateName: context.templateName,
      contextRestoredAfterInbound: true,
    },
  })
  return true
}

export type { MyHonorReactivationOutboundContext }
