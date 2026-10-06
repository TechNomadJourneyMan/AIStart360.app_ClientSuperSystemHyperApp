/**
 * Agent tool: tell the team (SEND_TELEGRAM). Agents choose the level and the
 * text; routing, quiet hours, cooldowns and recipients are decided by
 * lib/notifications (an agent cannot pick chat ids or bypass thresholds).
 */
import { z } from 'zod'
import { notifyStaff } from '@/lib/notifications/staff'
import { registerTool } from '../tools'

export const notifyStaffTool = registerTool({
  name: 'notify.staff',
  description: 'Отправить уведомление команде AIStart360 (лента GIGA, Telegram и email по правилам уровней).',
  permission: 'SEND_TELEGRAM',
  companyScoped: false,
  args: z.object({
    level: z.enum(['INFO', 'SUCCESS', 'WARNING', 'CRITICAL']),
    type: z.string().regex(/^[a-z][a-z0-9_.]{2,63}$/),
    title: z.string().min(1).max(200),
    lines: z.array(z.string().max(300)).max(12).default([]),
    dedupe_key: z.string().max(200).optional(),
    link: z.string().max(300).regex(/^\/[^/]/).optional(),
  }).strict(),
  handler: async (ctx, a) => {
    const res = await notifyStaff({
      level: a.level,
      type: a.type,
      title: a.title,
      lines: a.lines,
      companyId: ctx.companyId,
      agentKey: ctx.agentKey,
      entityType: 'agent_run',
      entityId: ctx.runId,
      dedupeKey: a.dedupe_key ? `${ctx.agentKey}:${a.dedupe_key}` : null,
      link: a.link ?? null,
    })
    return { duplicate: res.duplicate, sent: res.deliveries.filter((d) => d.status === 'sent').length }
  },
  summarize: (r: { duplicate: boolean; sent: number }) => (r.duplicate ? 'уже отправлено ранее' : `доставлено: ${r.sent}`),
})
