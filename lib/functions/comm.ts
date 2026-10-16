import { inngest } from '@/lib/inngest'
import { COMM_BOT_REPLY_EVENT, type BotJob } from '@/lib/comm/bot-rules'

/**
 * Inngest wiring of platform ↔ user communication, phases 4–5
 * (docs/superpowers/specs/2026-10-16-user-communications-design.md §6.4–6.5).
 * inngest 4.x registers triggers only via `triggers: [...]`.
 */

/**
 * The 30-minute rule: every 5 minutes, one indexed query on the conversations
 * past their reply deadline (lib/comm/escalation.ts), a batch of ≤ 20, a 30 s
 * budget, no LLM. Runs regardless of «Агенты по расписанию (24/7)»: it is not
 * an AI agent, and with nothing overdue it is a single cheap SELECT.
 */
export const commEscalations = inngest.createFunction(
  {
    id: 'comm-escalations',
    retries: 0,
    concurrency: { limit: 1 },
    triggers: [{ cron: '*/5 * * * *' }],
  },
  // @ts-ignore -- handler inference is incomplete in this repository's Inngest setup.
  async () => {
    const { runEscalations } = await import('@/lib/comm/escalation')
    const { createServiceClient } = await import('@/lib/supabase-service')
    return runEscalations({ sb: createServiceClient(), budgetMs: 30_000, limit: 20 })
  },
)

/**
 * The client bot answers a message in «Авто» mode (lib/comm/bot.ts): check,
 * «печатает…» in Telegram, a human-like pause of 2–8 s (step.sleep — no
 * connection is held while waiting), then the answer or the handoff to an
 * expert. One reply at a time; retries off (a repeated run would answer twice
 * — the run itself is idempotent by reply_to_id, but the user must not wait
 * for a retry ladder).
 */
export const commBotReply = inngest.createFunction(
  {
    id: 'comm-bot-reply',
    retries: 0,
    concurrency: { limit: 1 },
    triggers: [{ event: COMM_BOT_REPLY_EVENT }],
  },
  // @ts-ignore -- handler inference is incomplete in this repository's Inngest setup.
  async ({ event, step }: {
    event: { data: Partial<BotJob> }
    step: { run: <T>(id: string, fn: () => Promise<T>) => Promise<T>; sleep: (id: string, ms: number) => Promise<void> }
  }) => {
    const d = event.data ?? {}
    if (typeof d.threadId !== 'string' || typeof d.messageId !== 'string') return { skipped: 'bad_event' }
    const job: BotJob = { threadId: d.threadId, messageId: d.messageId, notifyOnSkip: d.notifyOnSkip === true }

    const plan = await step.run('plan', async () => {
      const { planBotReply } = await import('@/lib/comm/bot')
      return planBotReply(job)
    })
    if (!plan.ok) {
      // Let runBotReply notify staff when the message stays unanswered (manual mode meanwhile, hourly cap).
      if (plan.notifyStaff && job.notifyOnSkip) {
        await step.run('skip', async () => {
          const { runBotReply } = await import('@/lib/comm/bot')
          return runBotReply(job)
        })
      }
      return { skipped: plan.reason }
    }
    if (plan.chatId) {
      const chatId = plan.chatId
      await step.run('typing', async () => {
        const { sendChatAction } = await import('@/lib/telegram/bots/registry')
        await sendChatAction('client', chatId, 'typing')
        return true
      })
    }
    await step.sleep('human-delay', plan.delayMs)
    return step.run('reply', async () => {
      if (plan.chatId) {
        const { sendChatAction } = await import('@/lib/telegram/bots/registry')
        void sendChatAction('client', plan.chatId, 'typing')
      }
      const { runBotReply } = await import('@/lib/comm/bot')
      return runBotReply(job)
    })
  },
)
