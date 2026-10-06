/**
 * 💸 Расходы и лимиты — lib/ai/providers/service.ts spendSummary / getBudgets /
 * setBudgets only.
 *   spend by provider / model / feature / company, budgets view   agents.view (service: reads)
 *   budget change                                                 settings.manage (service: mutations)
 *                                                                 + confirmation
 */
import { prisma } from '@/lib/db'
import { getBudgets, setBudgets, spendSummary, ProviderServiceError } from '@/lib/ai/providers/service'
import { cut, esc, usd } from '../ui'
import { can, type AdminCtx, type AdminEntry, type AdminStep } from './context'
import { providerActor } from './providers'

const GROUPS: Record<string, { by: 'provider' | 'model' | 'feature' | 'company'; label: string }> = {
  p: { by: 'provider', label: 'провайдерам' },
  m: { by: 'model', label: 'моделям' },
  f: { by: 'feature', label: 'функциям' },
  c: { by: 'company', label: 'компаниям' },
}
const PERIODS: Record<string, { days: number; label: string }> = {
  '1': { days: 1, label: 'сутки' },
  '7': { days: 7, label: '7 дней' },
  '30': { days: 30, label: '30 дней' },
}

async function companyNames(ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map()
  const rows = await prisma.$queryRaw<Array<{ id: string; name: string }>>`SELECT id, name FROM public.companies WHERE id = ANY(${ids}::text[])`
  return new Map(rows.map((r) => [r.id, r.name]))
}

export async function showSpend(ctx: AdminCtx, period = '1', group = 'p'): Promise<void> {
  const p = PERIODS[period] ?? PERIODS['1']
  const g = GROUPS[group] ?? GROUPS.p
  let text: string
  try {
    const s = await spendSummary({ days: p.days, groupBy: g.by })
    const names = g.by === 'company' ? await companyNames(s.rows.map((r) => r.key).filter((k): k is string => Boolean(k))) : new Map<string, string>()
    const lines = [`💸 <b>Расход ИИ за ${p.label}: ${usd(s.totalUsd)}</b> — по ${g.label}`, '']
    for (const r of s.rows.slice(0, 12)) {
      const label = r.key ? names.get(r.key) ?? r.key : '— (не указано)'
      lines.push(`• ${esc(cut(label, 48))}: <b>${usd(r.costUsd)}</b> · вызовов ${r.calls} · токенов ${r.tokensIn + r.tokensOut}`)
    }
    if (!s.rows.length) lines.push('Расходов нет.')
    text = lines.join('\n')
  } catch (err) {
    text = err instanceof ProviderServiceError ? `⚠️ ${esc(err.message)}` : '⚠️ Расходы недоступны (применена ли миграция 094?)'
  }
  await ctx.show(text, [
    Object.entries(PERIODS).map(([k, v]) => ctx.button(`${k === period ? '• ' : ''}${v.label}`, 'sp.v', k, group)),
    Object.entries(GROUPS).map(([k, v]) => ctx.button(`${k === group ? '• ' : ''}${v.label}`, 'sp.v', period, k)),
    [ctx.button('🎚 Бюджеты', 'bg.v')],
  ])
}

export async function showBudgets(ctx: AdminCtx): Promise<void> {
  try {
    const b = await getBudgets()
    const src = (s: 'db' | 'env') => (s === 'db' ? 'задан в панели' : 'из env')
    const lines = [
      '🎚 <b>Дневные бюджеты ИИ</b>',
      `Платформа: <b>${usd(b.platform.dailyUsd)}</b> (${src(b.platform.source)})`,
      `Компания: <b>${usd(b.company.dailyUsd)}</b> (${src(b.company.source)})`,
      '',
      ...b.providers.map((p) => `• ${esc(p.name)}: потрачено сегодня ${usd(p.spentTodayUsd)}${p.dailyBudgetUsd != null ? ` из ${usd(p.dailyBudgetUsd)}` : ' (без своего лимита)'}`),
    ]
    const edit = can(ctx, 'settings.manage')
    await ctx.show(lines.join('\n'), [
      edit ? [ctx.button('✏️ Платформа', 'bg.e', 'p'), ctx.button('✏️ Компания', 'bg.e', 'c')] : [],
      ...(edit ? b.providers.slice(0, 8).map((p) => [ctx.button(`✏️ ${cut(p.name, 30)}`, 'bg.e', 'v', p.key)]) : []),
      [ctx.button('‹ Расходы', 'sp.v', '1', 'p')],
    ])
  } catch (err) {
    await ctx.show(err instanceof ProviderServiceError ? `⚠️ ${esc(err.message)}` : '⚠️ Бюджеты недоступны (применена ли миграция 094?)')
  }
}

function targetLabel(kind: string, key?: string): string {
  return kind === 'p' ? 'платформы' : kind === 'c' ? 'компании' : `провайдера ${key ?? ''}`
}

export const spendSteps: Record<string, AdminStep> = {
  budget_value: {
    perm: 'settings.manage',
    async run(ctx, state) {
      const raw = ctx.text.trim().replace(',', '.').replace(/^\$/, '')
      const value = raw === '-' ? null : Number(raw)
      if (value !== null && (!Number.isFinite(value) || value < 0 || value > 100_000)) {
        return void (await ctx.reply('Нужно число от 0 до 100000 (USD в день) или «-», чтобы снять лимит. Ещё раз или /cancel.'))
      }
      const kind = String(state.kind)
      const key = state.key ? String(state.key) : ''
      await ctx.confirm(`🎚 Установить дневной бюджет ${esc(targetLabel(kind, key))}: <b>${value === null ? 'сбросить' : usd(value)}</b>?`, 'bg.set', [kind, key, value === null ? '-' : String(value)])
    },
  },
}

export const spendEntries: Record<string, AdminEntry> = {
  'sp.v': { perm: 'agents.view', run: (ctx, [period, group]) => showSpend(ctx, period ?? '1', group ?? 'p') },
  'bg.v': { perm: 'agents.view', run: (ctx) => showBudgets(ctx) },
  'bg.e': {
    perm: 'settings.manage',
    async run(ctx, [kind, key]) {
      if (!['p', 'c', 'v'].includes(kind) || (kind === 'v' && !key)) return
      await ctx.setState({ step: 'budget_value', kind, key: key ?? null })
      await ctx.reply(`🎚 Новый дневной бюджет ${esc(targetLabel(kind, key))} в USD (например 25) или «-», чтобы ${kind === 'v' ? 'снять лимит' : 'вернуть значение из env'}. /cancel — отмена.`)
    },
  },
}

export const spendConfirmed: Record<string, AdminEntry> = {
  'bg.set': {
    perm: 'settings.manage',
    async run(ctx, [kind, key, raw]) {
      const value = raw === '-' ? null : Number(raw)
      try {
        await setBudgets(providerActor(ctx), kind === 'p' ? { platformDailyUsd: value } : kind === 'c' ? { companyDailyUsd: value } : { providers: { [key]: value } })
        await ctx.toast('Бюджет сохранён')
        await showBudgets(ctx)
      } catch (err) {
        await ctx.show(err instanceof ProviderServiceError ? `⚠️ ${esc(err.message)}` : '⚠️ Не удалось сохранить бюджет.')
      }
    },
  },
}
