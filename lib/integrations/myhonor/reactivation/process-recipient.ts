import {
  createMetaClient,
  type MetaSendResult,
  type SendWhatsAppTemplateInput,
} from '@/lib/omnichannel/meta-client'
import { decryptContactValue, normalizeE164 } from './identity'
import {
  authorizeMyHonorReactivationRecipient,
  claimMyHonorReactivationRecipient,
  finishMyHonorReactivationRecipient,
  myHonorSnapshotHash,
  newMyHonorReactivationOwnerToken,
  type ClaimedMyHonorReactivationRecipient,
} from './repository'
import {
  getMyHonorReactivationConfiguration,
  type MyHonorReactivationConfiguration,
} from './types'

export interface ProcessMyHonorReactivationRecipientInput {
  recipientId: string
  ownerToken?: string
}

export type ProcessMyHonorReactivationRecipientResult =
  | { action: 'accepted'; providerMessageId: string }
  | { action: 'retry'; runAt: string; reason: string }
  | { action: 'failed'; reason: string }
  | { action: 'delivery_unknown'; reason: string }
  | { action: 'skipped'; reason: string }

interface ProcessDependencies {
  configuration?: MyHonorReactivationConfiguration
  claim?: typeof claimMyHonorReactivationRecipient
  authorize?: typeof authorizeMyHonorReactivationRecipient
  finish?: typeof finishMyHonorReactivationRecipient
  sendTemplate?: (input: SendWhatsAppTemplateInput) => Promise<MetaSendResult>
}

const RETRY_DELAYS_SECONDS = [15, 60, 180, 600, 1_800] as const

function retryDelaySeconds(attempts: number): number {
  return RETRY_DELAYS_SECONDS[
    Math.min(RETRY_DELAYS_SECONDS.length - 1, Math.max(0, attempts - 1))
  ]
}

function machineCode(value: string | null | undefined, fallback: string): string {
  const normalized = value
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, '_')
    .replace(/^[^a-z0-9]+/, '')
    .slice(0, 120)
  return normalized && /^[a-z0-9]/.test(normalized) ? normalized : fallback
}

function decryptTemplateParameters(value: string, masterKey: string): string[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(decryptContactValue(value, masterKey)) as unknown
  } catch {
    throw new Error('invalid encrypted template parameters')
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
    throw new Error('invalid encrypted template parameters')
  }
  return parsed as string[]
}

function templateInput(
  claimed: ClaimedMyHonorReactivationRecipient,
  configuration: MyHonorReactivationConfiguration,
): SendWhatsAppTemplateInput | null {
  if (!configuration.masterKey || !configuration.whatsappPhoneNumberId) return null
  const expectedTemplate = configuration.templates[claimed.segment]
  if (
    !expectedTemplate
    || claimed.templateName !== expectedTemplate
    || claimed.templateLanguage !== configuration.templateLanguage
    || claimed.locale !== configuration.templateLanguage
  ) return null

  const phone = normalizeE164(
    decryptContactValue(claimed.phoneCiphertext, configuration.masterKey),
  )
  const bodyParameters = decryptTemplateParameters(
    claimed.templateParametersCiphertext,
    configuration.masterKey,
  )
  if (myHonorSnapshotHash(bodyParameters) !== claimed.templateParametersHash) return null

  return {
    recipientId: phone.slice(1),
    templateName: claimed.templateName,
    languageCode: claimed.templateLanguage,
    bodyParameters,
    accountExternalId: configuration.whatsappPhoneNumberId,
  }
}

export async function processMyHonorReactivationRecipientDirect(
  input: ProcessMyHonorReactivationRecipientInput,
  dependencies: ProcessDependencies = {},
): Promise<ProcessMyHonorReactivationRecipientResult> {
  const configuration = dependencies.configuration
    ?? getMyHonorReactivationConfiguration()
  const claim = dependencies.claim ?? claimMyHonorReactivationRecipient
  const authorize = dependencies.authorize ?? authorizeMyHonorReactivationRecipient
  const finish = dependencies.finish ?? finishMyHonorReactivationRecipient
  const sendTemplate = dependencies.sendTemplate
    ?? ((message: SendWhatsAppTemplateInput) =>
      createMetaClient().sendWhatsAppTemplate(message))
  const ownerToken = input.ownerToken ?? newMyHonorReactivationOwnerToken()

  const claimed = await claim({
    recipientId: input.recipientId,
    ownerToken,
  })
  if (!claimed) return { action: 'skipped', reason: 'recipient_not_claimable' }

  if (!configuration.sendEnabled || !configuration.sendReady) {
    const outcome = await finish({
      recipientId: claimed.id,
      leaseToken: claimed.leaseToken,
      ownerToken,
      outcome: 'failed',
      errorCode: 'provider_not_ready',
      retryable: false,
    })
    return outcome.accepted
      ? { action: 'failed', reason: 'provider_not_ready' }
      : { action: 'skipped', reason: 'recipient_lease_lost' }
  }

  let message: SendWhatsAppTemplateInput | null = null
  try {
    message = templateInput(claimed, configuration)
  } catch {
    message = null
  }
  if (!message) {
    const outcome = await finish({
      recipientId: claimed.id,
      leaseToken: claimed.leaseToken,
      ownerToken,
      outcome: 'failed',
      errorCode: 'invalid_recipient_snapshot',
      retryable: false,
    })
    return outcome.accepted
      ? { action: 'failed', reason: 'invalid_recipient_snapshot' }
      : { action: 'skipped', reason: 'recipient_lease_lost' }
  }

  const authorization = await authorize({
    recipientId: claimed.id,
    leaseToken: claimed.leaseToken,
    ownerToken,
  })
  if (!authorization.authorized) {
    const reason = machineCode(authorization.reason, 'authorization_denied')
    if (authorization.nextRunAt) {
      const retryAt = new Date(authorization.nextRunAt)
      if (Number.isFinite(retryAt.getTime()) && retryAt.getTime() > Date.now()) {
        return { action: 'retry', runAt: retryAt.toISOString(), reason }
      }
    }
    return { action: 'skipped', reason }
  }

  let providerResult: MetaSendResult
  try {
    providerResult = await sendTemplate(message)
  } catch {
    const outcome = await finish({
      recipientId: claimed.id,
      leaseToken: claimed.leaseToken,
      ownerToken,
      outcome: 'delivery_unknown',
      errorCode: 'provider_call_interrupted',
      retryable: false,
    })
    return outcome.accepted
      ? { action: 'delivery_unknown', reason: 'provider_call_interrupted' }
      : { action: 'skipped', reason: 'recipient_lease_lost' }
  }

  if (!providerResult.ok && providerResult.deliveryUnknown === true) {
    const errorCode = machineCode(
      providerResult.code,
      'provider_ack_missing_message_id',
    )
    const outcome = await finish({
      recipientId: claimed.id,
      leaseToken: claimed.leaseToken,
      ownerToken,
      outcome: 'delivery_unknown',
      errorCode,
      retryable: false,
    })
    return outcome.accepted
      ? { action: 'delivery_unknown', reason: errorCode }
      : { action: 'skipped', reason: 'recipient_lease_lost' }
  }

  if (providerResult.ok) {
    const outcome = await finish({
      recipientId: claimed.id,
      leaseToken: claimed.leaseToken,
      ownerToken,
      outcome: 'accepted',
      providerMessageId: providerResult.externalMessageId,
    })
    return outcome.accepted
      ? { action: 'accepted', providerMessageId: providerResult.externalMessageId }
      : { action: 'delivery_unknown', reason: 'provider_accepted_but_lease_lost' }
  }

  const errorCode = machineCode(providerResult.code, 'provider_rejected')
  // 131049 is Meta's per-user marketing limit. Immediate retries worsen quality;
  // a future campaign may reconsider the contact after a long cooldown.
  const retryable = providerResult.retryable
    && errorCode !== '131049'
    && claimed.attempts < claimed.maxAttempts
  const outcome = await finish({
    recipientId: claimed.id,
    leaseToken: claimed.leaseToken,
    ownerToken,
    outcome: 'failed',
    errorCode: errorCode === '131049' ? 'meta_marketing_limit_131049' : errorCode,
    retryable,
    retryAfterSeconds: retryDelaySeconds(claimed.attempts),
  })
  if (!outcome.accepted) return { action: 'skipped', reason: 'recipient_lease_lost' }
  if (retryable && outcome.state === 'queued' && outcome.runAt) {
    return { action: 'retry', runAt: outcome.runAt, reason: errorCode }
  }
  return { action: 'failed', reason: errorCode }
}
