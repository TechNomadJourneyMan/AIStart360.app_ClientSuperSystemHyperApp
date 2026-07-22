import {
  createMetaClient,
  type MetaSendResult,
  type SendWhatsAppTemplateInput,
} from '@/lib/omnichannel/meta-client'
import {
  authorizeMyHonorOrderNotification,
  claimMyHonorOrderNotification,
  finishMyHonorOrderNotification,
  type ClaimedMyHonorNotification,
} from './order-notification-repository'
import {
  buildMyHonorTemplateRequest,
  getMyHonorOrderNotificationConfiguration,
  type MyHonorOrderNotificationConfiguration,
} from './order-notifications'

export interface ProcessMyHonorOrderNotificationInput {
  notificationId: string
  ownerToken: string
}

export type ProcessMyHonorOrderNotificationResult =
  | { action: 'accepted'; providerMessageId: string }
  | { action: 'retry'; runAt: string; reason: string }
  | { action: 'failed'; reason: string }
  | { action: 'delivery_unknown'; reason: string }
  | { action: 'skipped'; reason: string }

interface ProcessDependencies {
  configuration?: MyHonorOrderNotificationConfiguration
  claim?: typeof claimMyHonorOrderNotification
  authorize?: typeof authorizeMyHonorOrderNotification
  finish?: typeof finishMyHonorOrderNotification
  sendTemplate?: (
    input: SendWhatsAppTemplateInput,
  ) => Promise<MetaSendResult>
}

const RETRY_DELAYS_SECONDS = [5, 15, 45, 120, 300] as const

function machineCode(value: string | null | undefined, fallback: string): string {
  const normalized = value
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, '_')
    .replace(/^[^a-z0-9]+/, '')
    .slice(0, 120)
  return normalized && /^[a-z0-9]/.test(normalized) ? normalized : fallback
}

function retryDelaySeconds(attempts: number): number {
  return RETRY_DELAYS_SECONDS[
    Math.min(RETRY_DELAYS_SECONDS.length - 1, Math.max(0, attempts - 1))
  ]
}

function templateInput(
  claimed: ClaimedMyHonorNotification,
  configuration: MyHonorOrderNotificationConfiguration,
): SendWhatsAppTemplateInput | null {
  const template = buildMyHonorTemplateRequest({
    status: claimed.orderStatus,
    order_number: claimed.orderNumber,
    recipient: {
      phone_e164: claimed.recipientPhoneE164,
      name: claimed.recipientName,
    },
    details: claimed.details,
  }, configuration)
  if (!template) return null
  return {
    recipientId: template.recipientId,
    templateName: template.templateName,
    languageCode: template.languageCode,
    bodyParameters: template.bodyParameters,
    accountExternalId: configuration.whatsappPhoneNumberId ?? undefined,
  }
}

export async function processMyHonorOrderNotificationDirect(
  input: ProcessMyHonorOrderNotificationInput,
  dependencies: ProcessDependencies = {},
): Promise<ProcessMyHonorOrderNotificationResult> {
  const claim = dependencies.claim ?? claimMyHonorOrderNotification
  const authorize = dependencies.authorize ?? authorizeMyHonorOrderNotification
  const finish = dependencies.finish ?? finishMyHonorOrderNotification
  const configuration = dependencies.configuration
    ?? getMyHonorOrderNotificationConfiguration()
  const sendTemplate = dependencies.sendTemplate
    ?? ((message: SendWhatsAppTemplateInput) =>
      createMetaClient().sendWhatsAppTemplate(message))

  const claimed = await claim({
    notificationId: input.notificationId,
    ownerToken: input.ownerToken,
  })
  if (!claimed) {
    return { action: 'skipped', reason: 'notification_not_claimable' }
  }

  if (!configuration.ready) {
    const outcome = await finish({
      notificationId: claimed.id,
      leaseToken: claimed.leaseToken,
      ownerToken: input.ownerToken,
      outcome: 'failed',
      errorCode: 'integration_configuration_missing',
    })
    return outcome.accepted
      ? { action: 'failed', reason: 'integration_configuration_missing' }
      : { action: 'skipped', reason: 'configuration_failure_fence_rejected' }
  }

  const message = templateInput(claimed, configuration)
  if (!message) {
    const outcome = await finish({
      notificationId: claimed.id,
      leaseToken: claimed.leaseToken,
      ownerToken: input.ownerToken,
      outcome: 'failed',
      errorCode: 'template_configuration_invalid',
    })
    return outcome.accepted
      ? { action: 'failed', reason: 'template_configuration_invalid' }
      : { action: 'skipped', reason: 'template_failure_fence_rejected' }
  }

  const authorization = await authorize({
    notificationId: claimed.id,
    leaseToken: claimed.leaseToken,
    ownerToken: input.ownerToken,
  })
  if (!authorization.authorized) {
    return { action: 'skipped', reason: authorization.reason }
  }

  let providerResult: MetaSendResult
  try {
    providerResult = await sendTemplate(message)
  } catch {
    const outcome = await finish({
      notificationId: claimed.id,
      leaseToken: claimed.leaseToken,
      ownerToken: input.ownerToken,
      outcome: 'delivery_unknown',
      errorCode: 'provider_call_threw',
    })
    return outcome.accepted
      ? { action: 'delivery_unknown', reason: 'provider_call_threw' }
      : { action: 'skipped', reason: 'provider_exception_fence_rejected' }
  }

  if (providerResult.ok) {
    const outcome = await finish({
      notificationId: claimed.id,
      leaseToken: claimed.leaseToken,
      ownerToken: input.ownerToken,
      outcome: 'accepted',
      providerMessageId: providerResult.externalMessageId,
    })
    return outcome.accepted
      ? {
          action: 'accepted',
          providerMessageId: providerResult.externalMessageId,
        }
      : { action: 'skipped', reason: 'provider_success_fence_rejected' }
  }

  const errorCode = `meta.${machineCode(
    providerResult.code,
    providerResult.status ? `http_${providerResult.status}` : 'provider_error',
  )}`
  const ambiguous = providerResult.status === null
    || (providerResult.status >= 200 && providerResult.status < 300)
  if (ambiguous) {
    const outcome = await finish({
      notificationId: claimed.id,
      leaseToken: claimed.leaseToken,
      ownerToken: input.ownerToken,
      outcome: 'delivery_unknown',
      errorCode,
    })
    return outcome.accepted
      ? { action: 'delivery_unknown', reason: errorCode }
      : { action: 'skipped', reason: 'delivery_unknown_fence_rejected' }
  }

  const outcome = await finish({
    notificationId: claimed.id,
    leaseToken: claimed.leaseToken,
    ownerToken: input.ownerToken,
    outcome: 'failed',
    errorCode,
    retryable: providerResult.retryable,
    retryAfterSeconds: retryDelaySeconds(claimed.attempts),
  })
  if (!outcome.accepted) {
    return { action: 'skipped', reason: 'provider_failure_fence_rejected' }
  }
  if (outcome.state === 'queued' && outcome.runAt) {
    return { action: 'retry', runAt: outcome.runAt, reason: errorCode }
  }
  return { action: 'failed', reason: errorCode }
}
