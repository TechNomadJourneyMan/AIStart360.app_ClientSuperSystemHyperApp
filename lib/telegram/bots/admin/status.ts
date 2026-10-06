/**
 * 📊 Статус — what the GIGA overview, «Система» and «ИИ-агенты» show, in one
 * message. Each block appears only for a role holding the permission of the
 * GIGA screen it comes from:
 *   database + env completeness (counts only)  settings.manage  (system/health)
 *   queue, AI spend vs budget, monitoring,
 *   pending approvals, last failures           agents.view
 *   pending registrations                      users.view
 */
import { prisma } from '@/lib/db'
import { envCompleteness } from '@/lib/admin/system-health'
import { platformHealthSnapshot } from '@/lib/agents/definitions/monitoring'
import { spendToday } from '@/lib/agents/store'
import { lastFailures, statusCounts } from '../data'
import { dt, esc, usd } from '../ui'
import { can, type AdminCtx, type AdminEntry } from './context'

async function dbPing(): Promise<{ ok: boolean; ms: number }> {
  const t0 = Date.now()
  try {
    await prisma.$queryRaw`SELECT 1`
    return { ok: true, ms: Date.now() - t0 }
  } catch {
    return { ok: false, ms: Date.now() - t0 }
  }
}

export async function renderStatus(ctx: AdminCtx): Promise<string> {
  const lines: string[] = [`📊 <b>Статус платформы</b> — ${dt(ctx.deps.now())}`]

  if (can(ctx, 'settings.manage')) {
    const db = await dbPing()
    const env = envCompleteness()
    lines.push('', `База данных: ${db.ok ? `✅ доступна (${db.ms} мс)` : '🚨 недоступна'}`)
    lines.push(`Окружение: обязательных ${env.requiredSet}/${env.required}, всего ${env.set}/${env.total}${env.requiredSet < env.required ? ' ⚠️' : ''}`)
  }

  if (can(ctx, 'agents.view') || can(ctx, 'users.view')) {
    let counts
    try {
      counts = await statusCounts()
    } catch {
      counts = null
    }
    if (!counts) {
      lines.push('', '⚠️ Очередь недоступна (применены ли миграции 086–087?)')
    } else {
      if (can(ctx, 'agents.view')) {
        lines.push('', '<b>Очередь агентов</b>',
          `в очереди ${counts.queued} · выполняются ${counts.running} · ждут одобрения ${counts.awaitingApproval} · dead-letter за 24 ч ${counts.dead24h}${counts.dead24h ? ' ⚠️' : ''}`)
        const budget = Number(process.env.AGENT_PLATFORM_DAILY_BUDGET_USD ?? 50)
        const spent = await spendToday().catch(() => null)
        if (spent !== null) {
          const share = budget > 0 ? Math.round((spent / budget) * 100) : 0
          lines.push(`Расход ИИ сегодня: <b>${usd(spent)}</b> из ${usd(budget)} (${share}%)${share >= 100 ? ' 🚨' : share >= 80 ? ' ⚠️' : ''}`)
        }
        lines.push(`Одобрения ждут решения: <b>${counts.pendingApprovals}</b>`)
      }
      if (can(ctx, 'users.view')) lines.push(`Заявки на доступ: <b>${counts.pendingRegistrations}</b>`)
    }
  }

  if (can(ctx, 'agents.view')) {
    const checks = await platformHealthSnapshot().catch(() => null)
    const bad = (checks ?? []).filter((c) => c.status !== 'ok')
    if (checks) {
      lines.push('', bad.length ? '<b>Мониторинг</b>' : 'Мониторинг: ✅ все проверки в норме')
      for (const c of bad.slice(0, 6)) lines.push(`${c.status === 'critical' ? '🚨' : '⚠️'} ${esc(c.label)}: ${c.value} — ${esc(c.detail)}`)
    }
    const fails = await lastFailures(5).catch(() => [])
    if (fails.length) {
      lines.push('', '<b>Последние сбои</b>')
      for (const f of fails) {
        lines.push(`• ${esc(f.agent_key)}${f.company_name ? ` · ${esc(f.company_name)}` : ''} · ${esc(f.last_error_code ?? f.status)} · ${dt(f.finished_at)}`)
      }
    }
  }
  return lines.join('\n')
}

export const statusEntries: Record<string, AdminEntry> = {
  'st.r': {
    perm: 'dashboard.view',
    async run(ctx) {
      await ctx.show(await renderStatus(ctx), [[ctx.button('🔄 Обновить', 'st.r')]])
    },
  },
}
