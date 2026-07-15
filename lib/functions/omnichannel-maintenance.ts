import { inngest } from '@/lib/inngest'
import { OMNICHANNEL_MESSAGE_RECEIVED_EVENT } from '@/lib/omnichannel/events'
import { createOmnichannelAdminClient } from '@/lib/omnichannel/repository'

function retentionDays(): number {
  const parsed = Number.parseInt(process.env.OMNICHANNEL_RETENTION_DAYS ?? '180', 10)
  return Number.isFinite(parsed) ? Math.min(730, Math.max(30, parsed)) : 180
}

/**
 * Independent fence reaper. Claim-time recovery remains in place, but this
 * schedule also resolves expired authorized leases while the bridge host is
 * offline, where retrying could duplicate a customer-visible send.
 */
export const omnichannelOutboundDeliveryMaintenance = inngest.createFunction(
  {
    id: 'omnichannel-outbound-delivery-maintenance',
    retries: 1,
    triggers: [{ cron: '*/5 * * * *' }],
  },
  // @ts-ignore -- handler inference is incomplete in this repository's Inngest setup.
  async ({ step }: any) => {
    const result = await step.run('reap-expired-outbound-deliveries', async () => {
      const sb = createOmnichannelAdminClient()
      const { data, error } = await sb.rpc('reap_omnichannel_outbound_deliveries', {
        p_session_id: null,
        p_limit: 500,
      })
      if (error) throw new Error('failed to reap outbound delivery fences')
      const row = Array.isArray(data) ? data[0] : data
      return {
        requeued: Number(row?.requeued ?? 0),
        delivery_unknown: Number(row?.delivery_unknown ?? 0),
        dead: Number(row?.dead ?? 0),
      }
    })
    return result
  },
)

export const omnichannelMaintenance = inngest.createFunction(
  {
    id: 'omnichannel-maintenance',
    retries: 1,
    triggers: [{ cron: 'TZ=Asia/Almaty 15 4 * * *' }],
  },
  // @ts-ignore -- handler inference is incomplete in this repository's Inngest setup.
  async ({ step }: any) => {
    const sb = createOmnichannelAdminClient()
    const now = Date.now()
    const pendingCutoff = new Date(now - 10 * 60 * 1000).toISOString()
    const activeCutoff = new Date(now - 30 * 60 * 1000).toISOString()

    const pending = await step.run('find-stale-unqueued-messages', async () => {
      const { data, error } = await sb
        .from('omnichannel_messages')
        .select('id, conversation_id, status')
        .eq('direction', 'in')
        .in('status', ['received', 'imported'])
        .lt('updated_at', pendingCutoff)
        .order('updated_at', { ascending: true })
        .limit(100)
      if (error) throw new Error('failed to find stale omnichannel pending messages')
      return data ?? []
    })

    if (pending.length > 0) {
      await step.sendEvent(
        'requeue-stale-omnichannel-messages',
        pending.map((message: { id: string; conversation_id: string; status: string }) => ({
          name: OMNICHANNEL_MESSAGE_RECEIVED_EVENT,
          data: {
            message_id: message.id,
            conversation_id: message.conversation_id,
            force_draft: message.status === 'imported',
          },
        })),
      )
    }

    const escalated = await step.run('escalate-stale-active-messages', async () => {
      const { data, error } = await sb
        .from('omnichannel_messages')
        .select('id, conversation_id, status')
        .eq('direction', 'in')
        .in('status', ['processing', 'sending'])
        .lt('updated_at', activeCutoff)
        .limit(100)
      if (error) throw new Error('failed to find stale omnichannel active messages')
      const rows = data ?? []
      if (rows.length === 0) return 0

      const ids = rows.map((row) => row.id)
      const conversationIds = [...new Set(rows.map((row) => row.conversation_id))]
      const messageResult = await sb
        .from('omnichannel_messages')
        .update({
          status: 'needs_human',
          ai_reason: 'stale_processing_or_delivery_unknown',
          processed_at: new Date().toISOString(),
        })
        .in('id', ids)
      if (messageResult.error) throw new Error('failed to escalate stale omnichannel messages')
      const conversationResult = await sb
        .from('omnichannel_conversations')
        .update({ status: 'needs_human', auto_reply_override: false })
        .in('id', conversationIds)
      if (conversationResult.error) throw new Error('failed to pause stale omnichannel conversations')
      return rows.length
    })

    const retention = await step.run('purge-expired-omnichannel-data', async () => {
      const messageCutoff = new Date(now - retentionDays() * 24 * 60 * 60 * 1000).toISOString()
      const auditCutoff = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString()

      const { data: oldConversations, error: oldConversationError } = await sb
        .from('omnichannel_conversations')
        .select('id, contact_id')
        .eq('send_suppressed', false)
        .lt('last_message_at', messageCutoff)
        .limit(500)
      if (oldConversationError) throw new Error('failed to select expired omnichannel conversations')

      const expiredConversationIds = (oldConversations ?? []).map((row) => row.id)
      const candidateContactIds = [...new Set((oldConversations ?? []).map((row) => row.contact_id))]

      const messagesResult = await sb
        .from('omnichannel_messages')
        .delete({ count: 'exact' })
        .lt('occurred_at', messageCutoff)
      if (messagesResult.error) throw new Error('failed to purge expired omnichannel messages')

      if (expiredConversationIds.length > 0) {
        const conversationsResult = await sb
          .from('omnichannel_conversations')
          .delete()
          .in('id', expiredConversationIds)
        if (conversationsResult.error) throw new Error('failed to purge expired omnichannel conversations')
      }

      if (candidateContactIds.length > 0) {
        const { data: stillUsed, error: stillUsedError } = await sb
          .from('omnichannel_conversations')
          .select('contact_id')
          .in('contact_id', candidateContactIds)
        if (stillUsedError) throw new Error('failed to protect active omnichannel contacts')
        const used = new Set((stillUsed ?? []).map((row) => row.contact_id))
        const orphanIds = candidateContactIds.filter((id) => !used.has(id))
        if (orphanIds.length > 0) {
          const contactsResult = await sb
            .from('omnichannel_contacts')
            .delete()
            .in('id', orphanIds)
          if (contactsResult.error) throw new Error('failed to purge orphan omnichannel contacts')
        }
      }

      const auditResult = await sb
        .from('omnichannel_webhook_events')
        .delete({ count: 'exact' })
        .lt('received_at', auditCutoff)
      if (auditResult.error) throw new Error('failed to purge omnichannel webhook audit rows')

      return {
        retention_days: retentionDays(),
        messages_deleted: messagesResult.count ?? 0,
        webhook_events_deleted: auditResult.count ?? 0,
        conversations_deleted: expiredConversationIds.length,
      }
    })

    return {
      pending_requeued: pending.length,
      stale_escalated: escalated,
      retention,
    }
  },
)
