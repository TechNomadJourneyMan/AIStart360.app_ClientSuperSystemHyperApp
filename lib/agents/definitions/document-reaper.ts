/**
 * document_reaper — recovers documents that fell out of the pipeline.
 *
 * Every 10 minutes: documents in flight (parsing / extracting / binding) or
 * waiting in the queue (validated / uploaded) for more than 30 minutes with no
 * live document_intelligence task go back to the queue with a fresh task
 * (worker killed mid-run, lost event, dead-lettered task). After
 * MAX_DOCUMENT_ATTEMPTS processing runs a document is failed with an
 * explanation instead of looping. Deterministic, no model.
 */
import { z } from 'zod'
import { STALE_MINUTES, type StuckDocument } from '@/lib/documents/repository'
import { findStuckTool, requeueTool } from '../document-tools'
import type { AgentDefinition } from '../types'

export const MAX_DOCUMENT_ATTEMPTS = 5

export const documentReaperAgent: AgentDefinition<Record<string, never>> = {
  key: 'document_reaper',
  name: 'Document Reaper',
  description: 'Возвращает в очередь документы, зависшие в обработке дольше 30 минут.',
  version: '1.0.0',
  scope: 'platform',
  tier: 'none',
  permissions: { READ_FILES: 'ALLOW', PROCESS_FILES: 'ALLOW' },
  tools: [findStuckTool.name, requeueTool.name],
  triggers: { cron: '*/10 * * * *' },
  limits: { maxAttempts: 2, leaseSeconds: 120, perRunBudgetUsd: 0, dailyBudgetUsd: 0, maxLlmCalls: 0, maxOutputTokens: 256 },
  inputSchema: z.object({}).passthrough() as unknown as z.ZodType<Record<string, never>>,

  async run(ctx) {
    const stuck = await ctx.tool<StuckDocument[]>('documents.find_stuck', { stale_minutes: STALE_MINUTES, limit: 50 })
    let requeued = 0
    let failed = 0
    for (const d of stuck) {
      const giveUp = d.attempts >= MAX_DOCUMENT_ATTEMPTS
      const res = await ctx.tool<{ requeued: boolean; failed: boolean }>('documents.requeue', {
        document_id: d.id,
        seen_updated_at: new Date(d.updated_at).toISOString(),
        give_up: giveUp,
      })
      if (res.requeued) requeued += 1
      if (res.failed) failed += 1
    }
    if (requeued || failed) {
      await ctx.log('warn', 'documents.reaped', `документов возвращено в очередь: ${requeued}, завершено с ошибкой: ${failed}`, {
        requeued, failed,
      })
    }
    return {
      summary: stuck.length ? `зависших: ${stuck.length}, в очередь: ${requeued}, ошибка: ${failed}` : 'зависших документов нет',
      result: { found: stuck.length, requeued, failed },
    }
  },
}
