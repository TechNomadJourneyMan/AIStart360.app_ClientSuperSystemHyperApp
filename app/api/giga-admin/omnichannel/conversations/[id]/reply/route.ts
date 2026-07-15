export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

import { createHash } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getGigaActor } from '@/lib/admin/giga-actor'
import { logAudit } from '@/lib/audit'
import {
  getDevelopmentManualReplyContext,
  persistDevelopmentManualReplySuccess,
  recordDevelopmentManualReplyUnknown,
  reserveDevelopmentManualReply,
  shouldUseDevelopmentAdminPostgres,
  type DevelopmentManualReplyContext,
} from '@/lib/omnichannel/development-admin-postgres'
import { getSendWindow } from '@/lib/omnichannel/guardrails'
import { humanTypingDelaySeconds } from '@/lib/omnichannel/human-reply-timing'
import {
  logOutboundMessage,
  reserveConversationForManualReply,
} from '@/lib/omnichannel/repository'
import {
  dispatchOmnichannelReply,
  isConfiguredOmnichannelSender,
  outboundTransportMetadata,
  type OmnichannelDispatchResult,
  type OmnichannelQueuedDispatch,
} from '@/lib/omnichannel/transport-dispatch'
import type { JsonObject } from '@/lib/omnichannel/types'
import { createServiceClient } from '@/lib/supabase-service'

const idSchema = z.string().uuid()
const bodySchema = z.object({ text: z.string().trim().min(1).max(1_000) })

function envFlag(value: string | undefined): boolean {
  return /^(?:1|true|yes|on)$/i.test(value?.trim() ?? '')
}

function isQueuedDispatch(
  result: OmnichannelDispatchResult,
): result is OmnichannelQueuedDispatch {
  return result.ok && (result as Partial<OmnichannelQueuedDispatch>).queued === true
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const actor = await getGigaActor(req)
  if (!actor) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!idSchema.safeParse(params.id).success) {
    return NextResponse.json({ error: 'Некорректный id диалога' }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Ответ должен содержать от 1 до 1000 символов' }, { status: 400 })
  }

  const useDevelopmentPostgres = shouldUseDevelopmentAdminPostgres()
  let sb: ReturnType<typeof createServiceClient> | null = null
  let conversation: DevelopmentManualReplyContext['conversation'] | null = null
  let contact: DevelopmentManualReplyContext['contact'] = null
  let latestInbound: DevelopmentManualReplyContext['latestInbound'] = null

  if (useDevelopmentPostgres) {
    try {
      const context = await getDevelopmentManualReplyContext(params.id)
      conversation = context?.conversation ?? null
      contact = context?.contact ?? null
      latestInbound = context?.latestInbound ?? null
    } catch {
      return NextResponse.json({ error: 'Не удалось загрузить диалог' }, { status: 500 })
    }
  } else {
    sb = createServiceClient()
    const conversationResult = await sb
      .from('omnichannel_conversations')
      .select('id, channel, account_external_id, external_id, contact_id, send_suppressed, suppression_reason')
      .eq('id', params.id)
      .maybeSingle()
    if (conversationResult.error) {
      return NextResponse.json({ error: 'Не удалось загрузить диалог' }, { status: 500 })
    }
    conversation = conversationResult.data as DevelopmentManualReplyContext['conversation'] | null
    if (conversation) {
      const [contactResult, latestInboundResult] = await Promise.all([
        sb
          .from('omnichannel_contacts')
          .select('external_id')
          .eq('id', conversation.contact_id)
          .maybeSingle(),
        sb
          .from('omnichannel_messages')
          .select('id, external_message_id, occurred_at, metadata')
          .eq('conversation_id', conversation.id)
          .eq('direction', 'in')
          .order('occurred_at', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ])
      if (contactResult.error || latestInboundResult.error) {
        return NextResponse.json({ error: 'Контакт диалога не найден' }, { status: 409 })
      }
      contact = contactResult.data as DevelopmentManualReplyContext['contact']
      latestInbound = latestInboundResult.data as DevelopmentManualReplyContext['latestInbound']
    }
  }

  if (!conversation) return NextResponse.json({ error: 'Диалог не найден' }, { status: 404 })
  if (conversation.send_suppressed) {
    return NextResponse.json(
      {
        error: 'Клиент отказался от сообщений. Сначала подтвердите явный re-opt-in.',
        code: conversation.suppression_reason ?? 'send_suppressed',
      },
      { status: 409 },
    )
  }
  if (!contact?.external_id) {
    return NextResponse.json({ error: 'Контакт диалога не найден' }, { status: 409 })
  }

  const inboundMetadata =
    latestInbound?.metadata !== null
    && typeof latestInbound?.metadata === 'object'
    && !Array.isArray(latestInbound.metadata)
      ? latestInbound.metadata as JsonObject
      : {}
  const trustedInboundTimestamp = inboundMetadata.providerTimestampTrusted === true
  if (!isConfiguredOmnichannelSender({
    channel: conversation.channel,
    metadata: inboundMetadata,
    accountExternalId: conversation.account_external_id,
  })) {
    return NextResponse.json(
      {
        error: 'Диалог принадлежит другому или ненастроенному transport; отправка заблокирована',
        code: 'account_configuration_mismatch',
      },
      { status: 409 },
    )
  }

  const window = getSendWindow({
    channel: conversation.channel,
    lastInboundAt: trustedInboundTimestamp ? latestInbound?.occurred_at ?? null : null,
    actor: 'manual',
    instagramHumanAgentEnabled: envFlag(process.env.INSTAGRAM_HUMAN_AGENT_ENABLED),
  })
  if (!window.allowed) {
    const error =
      window.mode === 'template_required'
        ? '24-часовое окно WhatsApp закрыто: нужен заранее одобренный template'
        : 'Разрешённое Meta окно ответа уже закрыто'
    return NextResponse.json({ error, code: window.reason }, { status: 409 })
  }

  const reservation = useDevelopmentPostgres
    ? await reserveDevelopmentManualReply(conversation.id)
    : await reserveConversationForManualReply(conversation.id, sb!)
  if (!reservation.reserved) {
    return NextResponse.json(
      { error: 'Ручная отправка заблокирована', code: reservation.reason },
      { status: 409 },
    )
  }

  const replyHash = createHash('sha256').update(parsed.data.text).digest('hex').slice(0, 24)
  const manualMetadata = {
    source: 'giga_admin_manual',
    actorId: actor.id,
    actorKind: actor.kind,
    sendWindow: window.mode,
    ...outboundTransportMetadata(conversation.channel, inboundMetadata),
  } satisfies JsonObject
  let result
  try {
    result = await dispatchOmnichannelReply({
      channel: conversation.channel,
      metadata: inboundMetadata,
      accountExternalId: conversation.account_external_id,
      conversationExternalId: conversation.external_id,
      contactExternalId: contact.external_id,
      text: parsed.data.text,
      actor: 'manual',
      useHumanAgent: window.mode === 'human_agent',
      replyToExternalId: latestInbound?.external_message_id ?? null,
      idempotencyKey: `omnichannel:manual:${conversation.id}:${latestInbound?.id ?? 'none'}:${replyHash}`,
      durableDelivery: {
        conversationId: conversation.id,
        sourceInboundMessageId: latestInbound?.id ?? null,
        aiGenerated: false,
        messageType: 'text',
        metadata: manualMetadata,
        finalization: { kind: 'manual', reason: 'manual_operator_reply' },
        typingDelayMs: humanTypingDelaySeconds(
          parsed.data.text,
          latestInbound?.id ?? conversation.id,
        ) * 1_000,
      },
    })
  } catch {
    return NextResponse.json(
      { error: 'Не удалось поставить ответ в очередь отправки', code: 'outbound_queue_unavailable' },
      { status: 503 },
    )
  }

  if (!result.ok) {
    const deliveryUnknown = result.status === null
      && (result.code === 'timeout' || result.code === 'network_error')
    if (deliveryUnknown) {
      if (useDevelopmentPostgres) {
        try {
          await recordDevelopmentManualReplyUnknown({
            conversationId: conversation.id,
            channel: conversation.channel,
            externalMessageId: `manual.unknown.${crypto.randomUUID()}`,
            text: parsed.data.text,
            latestInboundId: latestInbound?.id ?? null,
            replyToExternalId: latestInbound?.external_message_id ?? null,
            providerErrorCode: result.code,
            actorId: actor.id,
            actorKind: actor.kind,
          })
        } catch {
          // The provider outcome is still unknown. Returning 202 prevents an
          // operator retry even if the local warning record could not be saved.
        }
      } else {
        const now = new Date().toISOString()
        await sb!.from('omnichannel_messages').insert({
          conversation_id: conversation.id,
          channel: conversation.channel,
          external_message_id: `manual.unknown.${crypto.randomUUID()}`,
          direction: 'out',
          message_type: 'text',
          text: parsed.data.text,
          status: 'failed',
          reply_to_external_id: latestInbound?.external_message_id ?? null,
          ai_generated: false,
          occurred_at: now,
          processed_at: now,
          metadata: {
            source: 'giga_admin_manual',
            actorId: actor.id,
            actorKind: actor.kind,
            deliveryUnknown: true,
            providerErrorCode: result.code,
          },
        })
        if (latestInbound?.id) {
          await sb!
            .from('omnichannel_messages')
            .update({
              status: 'superseded',
              ai_reason: 'manual_reply_delivery_unknown',
              processed_at: now,
            })
            .eq('id', latestInbound.id)
        }
        await sb!
          .from('omnichannel_conversations')
          .update({ status: 'needs_human', auto_reply_override: false })
          .eq('id', conversation.id)
      }
      await logAudit({
        entityType: 'system',
        entityId: conversation.id,
        action: 'omnichannel.manual_reply_delivery_unknown',
        performedBy: actor.id,
        diff: { after: { channel: conversation.channel, providerCode: result.code } },
        ipAddress: req.headers.get('x-forwarded-for') ?? undefined,
      })
      return NextResponse.json(
        {
          sent: false,
          delivery_unknown: true,
          code: 'delivery_unknown',
          warning: 'Результат отправки неизвестен. Не отправляйте повторно, пока не проверите диалог.',
        },
        { status: 202 },
      )
    }
    return NextResponse.json(
      { error: result.message, code: result.code ?? 'provider_send_failed' },
      { status: 502 },
    )
  }

  if (isQueuedDispatch(result)) {
    await logAudit({
      entityType: 'system',
      entityId: conversation.id,
      action: 'omnichannel.manual_reply_queued',
      performedBy: actor.id,
      diff: {
        after: {
          channel: conversation.channel,
          deliveryId: result.deliveryId,
          deliveryStatus: result.deliveryStatus,
        },
      },
      ipAddress: req.headers.get('x-forwarded-for') ?? undefined,
    })
    return NextResponse.json(
      {
        sent: false,
        queued: true,
        delivery_id: result.deliveryId,
        delivery_status: result.deliveryStatus,
      },
      { status: 202 },
    )
  }

  // The provider already accepted the message. A persistence warning must not
  // turn this into a retryable UI error and accidentally send it twice.
  try {
    const persistenceInput = {
      conversationId: conversation.id,
      channel: conversation.channel,
      externalMessageId: result.externalMessageId,
      text: parsed.data.text,
      replyToExternalId: latestInbound?.external_message_id ?? null,
      metadata: {
        ...manualMetadata,
      } satisfies JsonObject,
    }
    if (useDevelopmentPostgres) {
      await persistDevelopmentManualReplySuccess({
        ...persistenceInput,
        latestInboundId: latestInbound?.id ?? null,
      })
    } else {
      if (latestInbound?.id) {
        await sb!
          .from('omnichannel_messages')
          .update({
            status: 'replied',
            ai_reason: 'manual_operator_reply',
            processed_at: new Date().toISOString(),
          })
          .eq('id', latestInbound.id)
          .eq('direction', 'in')
      }
      await logOutboundMessage(
        {
          ...persistenceInput,
          status: 'sent',
          aiGenerated: false,
        },
        sb!,
      )
    }
  } catch {
    await logAudit({
      entityType: 'system',
      entityId: conversation.id,
      action: 'omnichannel.manual_reply_persistence_warning',
      performedBy: actor.id,
      diff: { after: { channel: conversation.channel, acceptedByProvider: true } },
      ipAddress: req.headers.get('x-forwarded-for') ?? undefined,
    })
    return NextResponse.json({
      sent: true,
      persisted: false,
      external_message_id: result.externalMessageId,
      warning: 'Провайдер принял ответ, но локальный журнал нужно проверить',
    })
  }

  await logAudit({
    entityType: 'system',
    entityId: conversation.id,
    action: 'omnichannel.manual_reply_sent',
    performedBy: actor.id,
    diff: { after: { channel: conversation.channel, sendWindow: window.mode } },
    ipAddress: req.headers.get('x-forwarded-for') ?? undefined,
  })

  return NextResponse.json({
    sent: true,
    persisted: true,
    external_message_id: result.externalMessageId,
  })
}
