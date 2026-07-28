export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { start } from 'workflow/api'
import { getGigaActor } from '@/lib/admin/giga-actor'
import { OMNICHANNEL_BACKFILL_REQUESTED_EVENT } from '@/lib/omnichannel/events'
import { inngest } from '@/lib/inngest'
import { logAudit } from '@/lib/audit'
import {
  listImportedWhatsAppHistoryForDraft,
} from '@/lib/omnichannel/repository'
import { shouldUseOmnichannelPostgres } from '@/lib/omnichannel/postgres-runtime'
import {
  enqueueOmnichannelProcessingJobsViaPostgres,
  type OmnichannelProcessingJobStatus,
} from '@/lib/omnichannel/processing-jobs'
import { backfillInstagramHistoryWorkflow } from '@/workflows/backfill-instagram-history'
import { backfillWhatsAppHistoryWorkflow } from '@/workflows/backfill-whatsapp-history'
import { getMetaConfigurationHealth } from '@/lib/omnichannel/meta-client'

const schema = z.object({ channel: z.enum(['instagram', 'whatsapp']) })
const WHATSAPP_HISTORY_ANALYSIS_LIMIT = 100

function countJobStatuses(statuses: OmnichannelProcessingJobStatus[]) {
  return statuses.reduce(
    (counts, status) => {
      counts[status] += 1
      return counts
    },
    { queued: 0, leased: 0, succeeded: 0, dead: 0 },
  )
}

function shouldUseWorkflowBackend(): boolean {
  return process.env.OMNICHANNEL_PROCESSING_BACKEND?.trim().toLowerCase() === 'workflow'
}

export async function POST(req: NextRequest) {
  const actor = await getGigaActor(req)
  if (!actor) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Неизвестный канал' }, { status: 400 })
  }
  const { channel } = parsed.data

  try {
    const requestedAt = new Date().toISOString()

    if (shouldUseWorkflowBackend()) {
      if (channel === 'instagram' && !getMetaConfigurationHealth().instagram.configured) {
        return NextResponse.json({
          error: 'Сначала подключите Instagram и проверьте токен аккаунта',
          code: 'instagram_not_configured',
        }, { status: 409 })
      }
      const workflowInput = { requestedBy: actor.id, requestedAt }
      const run = channel === 'instagram'
        ? await start(backfillInstagramHistoryWorkflow, [workflowInput])
        : await start(backfillWhatsAppHistoryWorkflow, [workflowInput])
      await logAudit({
        entityType: 'system',
        entityId: `omnichannel:${channel}`,
        action: 'omnichannel.backfill_requested',
        performedBy: actor.id,
        diff: {
          after: {
            channel,
            backend: 'workflow',
            workflowRunId: run.runId,
            forceDraft: true,
            ...(channel === 'whatsapp'
              ? {
                  source: 'already_ingested_whatsapp_web_history',
                  cloudApiHistoryFetched: false,
                }
              : {}),
          },
          actorKind: actor.kind,
        },
        ipAddress: req.headers.get('x-forwarded-for') ?? undefined,
      }).catch(() => undefined)
      return NextResponse.json({
        queued: true,
        channel,
        backend: 'workflow',
        workflow_run_id: run.runId,
        force_draft: true,
        ...(channel === 'whatsapp'
          ? {
              source: 'already_ingested_whatsapp_web_history',
              cloud_api_history_fetched: false,
            }
          : {}),
      }, { status: 202 })
    }

    if (channel === 'whatsapp' && shouldUseOmnichannelPostgres()) {
      const candidates = await listImportedWhatsAppHistoryForDraft(
        WHATSAPP_HISTORY_ANALYSIS_LIMIT,
      )
      const jobs = await enqueueOmnichannelProcessingJobsViaPostgres(
        candidates.map((candidate) => ({
          messageId: candidate.messageId,
          // This is intentionally hard-coded. Historical rows must never
          // inherit the channel's auto-send mode.
          forceDraft: true,
        })),
      )
      const forceDraftConflicts = jobs.filter((job) => !job.forceDraft).length
      const statuses = countJobStatuses(
        jobs.filter((job) => job.forceDraft).map((job) => job.status),
      )
      const pending = statuses.queued + statuses.leased
      const failed = statuses.dead + forceDraftConflicts

      await logAudit({
        entityType: 'system',
        entityId: 'omnichannel:whatsapp',
        action: 'omnichannel.history_analysis_enqueued',
        performedBy: actor.id,
        diff: {
          after: {
            channel,
            source: 'already_ingested_whatsapp_web_history',
            candidates: candidates.length,
            jobsRecorded: jobs.length,
            jobsQueued: statuses.queued,
            jobsInProgress: statuses.leased,
            jobsCompleted: statuses.succeeded,
            jobsDead: statuses.dead,
            forceDraftConflicts,
            failed,
            forceDraft: true,
          },
          actorKind: actor.kind,
        },
        ipAddress: req.headers.get('x-forwarded-for') ?? undefined,
      }).catch(() => undefined)
      return NextResponse.json({
        queued: pending > 0,
        channel,
        source: 'already_ingested_whatsapp_web_history',
        candidates_found: candidates.length,
        jobs_recorded: jobs.length,
        jobs_queued: statuses.queued,
        jobs_in_progress: statuses.leased,
        jobs_completed: statuses.succeeded,
        jobs_dead: statuses.dead,
        force_draft_conflicts: forceDraftConflicts,
        // Compatibility aliases used by the current admin toast.
        completed: statuses.succeeded,
        failed,
        force_draft: true,
        cloud_api_history_fetched: false,
      }, { status: 202 })
    }

    const result = await inngest.send({
      name: OMNICHANNEL_BACKFILL_REQUESTED_EVENT,
      data: {
        channel,
        requested_by: actor.id,
        requested_at: requestedAt,
      },
    })
    await logAudit({
      entityType: 'system',
      entityId: `omnichannel:${channel}`,
      action: 'omnichannel.backfill_requested',
      performedBy: actor.id,
      diff: {
        after: {
          channel,
          ...(channel === 'whatsapp'
            ? {
                source: 'already_ingested_whatsapp_web_history',
                forceDraft: true,
                cloudApiHistoryFetched: false,
              }
            : {}),
        },
        actorKind: actor.kind,
      },
      ipAddress: req.headers.get('x-forwarded-for') ?? undefined,
    }).catch(() => undefined)
    return NextResponse.json({
      queued: true,
      channel,
      event_ids: result.ids,
      ...(channel === 'whatsapp'
        ? {
            source: 'already_ingested_whatsapp_web_history',
            force_draft: true,
            cloud_api_history_fetched: false,
          }
        : {}),
    }, { status: 202 })
  } catch {
    return NextResponse.json(
      {
        error: channel === 'whatsapp'
          ? 'Не удалось запустить AI-разбор уже загруженной истории WhatsApp'
          : 'Не удалось поставить импорт Instagram в очередь',
      },
      { status: 503 },
    )
  }
}
