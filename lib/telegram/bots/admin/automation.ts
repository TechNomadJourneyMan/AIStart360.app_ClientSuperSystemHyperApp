/**
 * 🤖 Агенты → ⚙️ Автоматизация — the agent automation switches
 * (lib/agents/automation.ts, the same system_settings rows as GIGA
 * «Настройки» → «Автоматизация агентов»).
 *
 *   view            agents.view
 *   switch / minutes settings.manage + confirmation; audited before the write
 *                   (settings.changed, actor kind 'telegram')
 */
import {
  AUTOMATION_TOGGLES, automationSnapshot, setAutomationSetting, type AutomationToggle,
} from '@/lib/agents/automation'
import { SETTINGS } from '@/lib/settings/registry'
import { esc } from '../ui'
import { auditFor, can, type AdminCtx, type AdminEntry } from './context'

/** Short codes for callback data (64-byte limit). */
export const TOGGLE_CODES: Record<string, AutomationToggle> = {
  n: 'agents_notify_lifecycle',
  r: 'agents_auto_retry',
  d: 'agents_auto_diagnostic',
  g: 'agents_daily_digest',
  s: 'agents_stuck_alerts',
}
const CODE_OF = Object.fromEntries(Object.entries(TOGGLE_CODES).map(([c, k]) => [k, c])) as Record<AutomationToggle, string>

const SHORT: Record<AutomationToggle, string> = {
  agents_notify_lifecycle: 'Уведомления',
  agents_auto_retry: 'Авто-повтор',
  agents_auto_diagnostic: 'Авто-диагностика',
  agents_daily_digest: 'Сводка 09:00',
  agents_stuck_alerts: 'Зависшие задачи',
}

export const STUCK_MINUTE_CHOICES = [10, 20, 30, 60] as const

export async function showAutomation(ctx: AdminCtx): Promise<void> {
  const v = await automationSnapshot()
  const lines = ['⚙️ <b>Автоматизация агентов</b>', '']
  for (const k of AUTOMATION_TOGGLES) lines.push(`${v[k] ? '🟢' : '⏸'} ${esc(SETTINGS[k].label)}`)
  lines.push(`⏱ ${esc(SETTINGS.agents_stuck_minutes.label)}: <b>${v.agents_stuck_minutes}</b>`)
  lines.push('', 'Сбои после всех попыток и зависшие задачи приходят всегда — как критичные.')
  const manage = can(ctx, 'settings.manage')
  if (!manage) lines.push('<i>Менять может роль с правом «Системные настройки».</i>')
  const rows = manage
    ? [
        ...AUTOMATION_TOGGLES.map((k) => [ctx.button(`${v[k] ? '⏸ Выключить' : '▶️ Включить'}: ${SHORT[k]}`, 'au.t', CODE_OF[k], v[k] ? 0 : 1)]),
        STUCK_MINUTE_CHOICES.map((m) => ctx.button(`${m === v.agents_stuck_minutes ? '• ' : ''}${m} мин`, 'au.m', m)),
      ]
    : []
  rows.push([ctx.button('🔄 Обновить', 'au.v'), ctx.button('‹ К агентам', 'ag.l', 0)])
  await ctx.show(lines.join('\n'), rows)
}

function parseToggle(code: string | undefined, flag: string | undefined): { key: AutomationToggle; on: boolean } | null {
  const key = code ? TOGGLE_CODES[code] : undefined
  if (!key || (flag !== '0' && flag !== '1')) return null
  return { key, on: flag === '1' }
}

function parseMinutes(raw: string | undefined): number | null {
  const m = Number(raw)
  return (STUCK_MINUTE_CHOICES as readonly number[]).includes(m) ? m : null
}

export const automationEntries: Record<string, AdminEntry> = {
  'au.v': { perm: 'agents.view', run: (ctx) => showAutomation(ctx) },
  'au.t': {
    perm: 'settings.manage',
    async run(ctx, [code, flag]) {
      const t = parseToggle(code, flag)
      if (!t) return
      await ctx.confirm(
        `${t.on ? '▶️ Включить' : '⏸ Выключить'} «${esc(SETTINGS[t.key].label)}»?\n\n${esc(SETTINGS[t.key].help)}`,
        'au.t', [code, flag],
      )
    },
  },
  'au.m': {
    perm: 'settings.manage',
    async run(ctx, [raw]) {
      const m = parseMinutes(raw)
      if (m === null) return
      await ctx.confirm(`⏱ Считать задачу зависшей, если нет прогресса <b>${m} мин</b>?`, 'au.m', [String(m)])
    },
  },
}

/** Reached only through the confirmation button. */
export const automationConfirmed: Record<string, AdminEntry> = {
  'au.t': {
    perm: 'settings.manage',
    async run(ctx, [code, flag]) {
      const t = parseToggle(code, flag)
      if (!t) return
      const res = await setAutomationSetting({ key: t.key, value: t.on, actorId: ctx.principal.userId, audit: auditFor(ctx) })
      await ctx.toast(res.ok ? (res.changed ? (t.on ? 'Включено' : 'Выключено') : 'Без изменений') : res.error, !res.ok)
      await showAutomation(ctx)
    },
  },
  'au.m': {
    perm: 'settings.manage',
    async run(ctx, [raw]) {
      const m = parseMinutes(raw)
      if (m === null) return
      const res = await setAutomationSetting({ key: 'agents_stuck_minutes', value: m, actorId: ctx.principal.userId, audit: auditFor(ctx) })
      await ctx.toast(res.ok ? (res.changed ? `Порог: ${m} мин` : 'Без изменений') : res.error, !res.ok)
      await showAutomation(ctx)
    },
  },
}
