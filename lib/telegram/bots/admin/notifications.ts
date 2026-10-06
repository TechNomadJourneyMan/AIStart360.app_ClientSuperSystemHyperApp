/**
 * 🔔 Уведомления — the staff member's own Telegram level and mute
 * (dashboard.view, as GIGA «Уведомления» → «Мой Telegram»). Each change is
 * audited (actor kind 'telegram').
 */
import { LEVEL_LABELS } from '@/lib/notifications/levels'
import { LEVEL_CODES, muteUntil, readSettings, renderSettings, writeLevel, writeMute } from '../notify-settings'
import { auditFor, type AdminCtx, type AdminEntry } from './context'

export async function showNotifications(ctx: AdminCtx): Promise<void> {
  const s = await readSettings('staff', ctx.principal.userId)
  if (!s) return void (await ctx.show('Telegram не привязан. Привяжите его в GIGA → «Уведомления» → «Привязать Telegram».'))
  const { text, kb } = renderSettings(ctx, s, 'nt', 'Запросы на одобрение приходят всегда — тем, у кого есть право решать.')
  await ctx.show(text, kb)
}

export const notificationEntries: Record<string, AdminEntry> = {
  'nt.v': { perm: 'dashboard.view', run: (ctx) => showNotifications(ctx) },
  'nt.lv': {
    perm: 'dashboard.view',
    async run(ctx, [code]) {
      const level = LEVEL_CODES[code]
      if (!level) return
      await auditFor(ctx)({ action: 'staff.telegram.level', entityType: 'staff_telegram_link', entityId: ctx.principal.userId, newValue: { minLevel: level } }, { required: true })
      await writeLevel('staff', ctx.principal.userId, level)
      await ctx.toast(`Уровень: ${LEVEL_LABELS[level]}`)
      await showNotifications(ctx)
    },
  },
  'nt.mu': {
    perm: 'dashboard.view',
    async run(ctx, [h]) {
      const until = muteUntil(ctx.deps.now(), Number(h) || 0)
      await auditFor(ctx)({ action: 'staff.telegram.mute', entityType: 'staff_telegram_link', entityId: ctx.principal.userId, newValue: { mutedUntil: until?.toISOString() ?? null } }, { required: true })
      await writeMute('staff', ctx.principal.userId, until)
      await ctx.toast(until ? 'Без звука' : 'Звук включён')
      await showNotifications(ctx)
    },
  },
}
