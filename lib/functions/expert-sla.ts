import { inngest } from '@/lib/inngest'

/**
 * SLA экспертов (R2-B, lib/expert-sla/run.ts): каждые 5 минут — синхронизация
 * задач эксперта, авто-назначение, пороги 24 ч (эскалация) и 48 ч (просрочка).
 * Не ИИ-агент: работает независимо от «Агентов по расписанию». Один проход за
 * раз (concurrency 1, проектное правило ≤ 2), без ретраев (проход идемпотентен
 * сам: пороги захватываются в базе, следующий запуск через 5 минут), бюджет
 * 30 с, как у «правила 30 минут» (lib/functions/comm.ts).
 */
export const expertSlaWatch = inngest.createFunction(
  {
    id: 'expert-sla-watch',
    retries: 0,
    concurrency: { limit: 1 },
    // BE-06 (lib/functions/limits.ts): start < the 5-minute period; the work has a 30 s budget.
    timeouts: { start: '4m', finish: '2m' },
    triggers: [{ cron: '*/5 * * * *' }],
  },
  // @ts-ignore -- handler inference is incomplete in this repository's Inngest setup.
  async () => {
    const { runExpertSla, SLA_RUN_BUDGET_MS } = await import('@/lib/expert-sla/run')
    const { createServiceClient } = await import('@/lib/supabase-service')
    return runExpertSla({ sb: createServiceClient(), budgetMs: SLA_RUN_BUDGET_MS })
  },
)
