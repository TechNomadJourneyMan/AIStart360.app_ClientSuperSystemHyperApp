'use client'

/**
 * Agent runtime settings (agents.manage): kill switch, tier / model override,
 * schedule (platform agents), budgets and output cap. Sends only the fields
 * that change (PATCH /api/giga-admin/agents/:key); the server validates again
 * and its message is shown as is.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { CalendarClock, RotateCcw } from 'lucide-react'
import { Button, Panel, cx, fmtDateTime, gigaFetch, inputClass } from '../kit'
import {
  LIMIT_RANGES, TIERS, TIER_HINTS, buildConfigPatch, fmtUsd, initialConfigDraft, isValidCron, nextCronRuns, tierLabel,
  type ConfigCurrent, type ConfigDraft, type Tier,
} from './model'
import type { AgentOverview } from './types'
import { NoRightHint, Toggle } from './ui'

function Row({ label, hint, error, children, htmlFor }: { label: string; hint?: ReactNode; error?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="grid gap-2 border-b border-white/[0.05] py-3 last:border-0 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] md:gap-6">
      <div>
        <label htmlFor={htmlFor} className="text-xs font-medium text-slate-200">{label}</label>
        {hint && <div className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{hint}</div>}
      </div>
      <div className="min-w-0">
        {children}
        {error && <p role="alert" className="mt-1 text-[11px] text-red-300">{error}</p>}
      </div>
    </div>
  )
}

export function AgentSettingsForm({ agent, canManage, onSaved, onToggleEnabled, toggling }: {
  agent: AgentOverview
  canManage: boolean
  /** Reload the agent; the form waits for it so the draft is not reset under the user's hands. */
  onSaved: () => Promise<unknown> | void
  onToggleEnabled: (next: boolean) => void
  toggling: boolean
}) {
  const cur: ConfigCurrent = useMemo(() => ({
    scope: agent.scope, tier: agent.tier, model: agent.model, cron: agent.triggers.cron, limits: agent.limits,
  }), [agent])
  const [d, setD] = useState<ConfigDraft>(() => initialConfigDraft(cur))
  const [saving, setSaving] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  useEffect(() => { setD(initialConfigDraft(cur)); setServerError(null) }, [cur])

  const { patch, errors } = buildConfigPatch(d, cur)
  const changes = Object.keys(patch).length
  const hasErrors = Object.keys(errors).length > 0
  const disabled = !canManage || saving
  const cronPreview = useMemo(() => {
    const expr = d.cron.trim() || cur.cron || ''
    return expr && isValidCron(expr) ? nextCronRuns(expr, new Date(), 5) : []
  }, [d.cron, cur.cron])

  const save = async () => {
    if (!changes || hasErrors) return
    setSaving(true)
    setServerError(null)
    try {
      await gigaFetch(`/api/giga-admin/agents/${encodeURIComponent(agent.key)}`, { method: 'PATCH', json: patch })
      await onSaved()
      toast.success('Настройки агента сохранены')
    } catch (e) {
      setServerError(e instanceof Error ? e.message : 'Не удалось сохранить')
    } finally {
      setSaving(false)
    }
  }

  const resetBtn = (key: keyof ConfigDraft['reset'], label: string) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => setD((x) => ({ ...x, reset: { ...x.reset, [key]: !x.reset[key] } }))}
      aria-pressed={d.reset[key]}
      title={`Вернуть ${label} из определения агента`}
      className={cx(
        'inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:opacity-50',
        d.reset[key] ? 'bg-blue-500/15 text-blue-200' : 'text-slate-500 hover:text-slate-300',
      )}
    >
      <RotateCcw size={11} /> {d.reset[key] ? 'будет по умолчанию' : 'по умолчанию'}
    </button>
  )

  const numberInput = (key: 'perRun' | 'daily' | 'maxTokens', suffix: string, step: string) => (
    <div className="flex flex-wrap items-center gap-2">
      <input
        id={`agent-${key}`}
        type="number"
        inputMode="decimal"
        step={step}
        min={LIMIT_RANGES[key].min}
        max={LIMIT_RANGES[key].max}
        value={d[key]}
        disabled={disabled || d.reset[key]}
        onChange={(e) => setD((x) => ({ ...x, [key]: e.target.value }))}
        aria-invalid={!!errors[key]}
        className={cx(inputClass, 'max-w-[8rem] py-1.5 text-right font-mono', errors[key] && 'border-red-500/50')}
      />
      <span className="text-[11px] text-slate-500">{suffix}</span>
      {resetBtn(key, 'значение')}
    </div>
  )

  return (
    <Panel
      title="Настройки агента"
      description="Изменения применяются к следующим запускам и пишутся в журнал аудита."
      actions={canManage ? (
        <>
          {(changes > 0 || hasErrors) && <Button size="sm" variant="ghost" disabled={saving} onClick={() => { setD(initialConfigDraft(cur)); setServerError(null) }}>Отменить</Button>}
          <Button size="sm" variant="primary" disabled={!changes || hasErrors} loading={saving} onClick={() => void save()}>
            {changes ? `Сохранить (${changes})` : 'Сохранить'}
          </Button>
        </>
      ) : undefined}
    >
      {!canManage && <div className="mb-2"><NoRightHint>Менять настройки может роль с правом «ИИ-агенты: управление». Ниже — текущие значения.</NoRightHint></div>}
      {serverError && <p role="alert" className="mb-2 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">{serverError}</p>}

      <Row label="Агент включён" hint="Выключенный агент не получает новых задач — ни по событиям, ни по расписанию, ни вручную. Уже поставленные задачи не отменяются.">
        <div className="flex items-center gap-3">
          <Toggle checked={agent.enabled} disabled={!canManage || toggling} onChange={onToggleEnabled} label={agent.enabled ? 'Выключить агента' : 'Включить агента'} />
          <span className="text-xs text-slate-300">{agent.enabled ? 'Включён' : 'Выключен'}</span>
        </div>
      </Row>

      <Row
        label="Уровень модели (tier)"
        htmlFor="agent-tier"
        hint={agent.tier === 'none' ? 'Агент детерминированный и не вызывает языковую модель — tier на него не влияет.' : `Сейчас: ${tierLabel(agent.tier)}.`}
      >
        <select
          id="agent-tier"
          value={d.tier}
          disabled={disabled}
          onChange={(e) => setD((x) => ({ ...x, tier: e.target.value as ConfigDraft['tier'] }))}
          className={cx(inputClass, 'max-w-sm bg-[#0b1128] py-1.5 text-xs')}
        >
          <option value="">Без изменений (сейчас {tierLabel(agent.tier)})</option>
          <option value="reset">Как в определении агента</option>
          {TIERS.map((t: Tier) => <option key={t} value={t}>{tierLabel(t)} — {TIER_HINTS[t]}</option>)}
        </select>
      </Row>

      <Row
        label="Модель (override)"
        htmlFor="agent-model"
        error={errors.model}
        hint="Точный id модели OpenRouter. Пусто — модель берётся по tier."
      >
        <input
          id="agent-model"
          value={d.model}
          disabled={disabled}
          placeholder="по tier, например anthropic/claude-sonnet-4.5"
          onChange={(e) => setD((x) => ({ ...x, model: e.target.value }))}
          aria-invalid={!!errors.model}
          spellCheck={false}
          className={cx(inputClass, 'max-w-sm py-1.5 font-mono text-xs', errors.model && 'border-red-500/50')}
        />
      </Row>

      <Row
        label="Расписание (cron, UTC)"
        htmlFor="agent-cron"
        error={errors.cron}
        hint={agent.scope === 'platform'
          ? '5 полей: минута час день месяц день-недели. Пусто — расписание из определения агента. Чтобы остановить запуски, выключите агента.'
          : 'Расписание доступно только платформенным агентам: агенты компаний запускаются событиями и вручную.'}
      >
        <input
          id="agent-cron"
          value={d.cron}
          disabled={disabled || agent.scope !== 'platform'}
          placeholder={agent.scope === 'platform' ? '*/15 * * * *' : 'недоступно'}
          onChange={(e) => setD((x) => ({ ...x, cron: e.target.value }))}
          aria-invalid={!!errors.cron}
          spellCheck={false}
          className={cx(inputClass, 'max-w-xs py-1.5 font-mono text-xs', errors.cron && 'border-red-500/50')}
        />
        {agent.scope === 'platform' && !errors.cron && (
          <div className="mt-2 text-[11px] text-slate-500">
            {cronPreview.length ? (
              <>
                <p className="mb-1 flex items-center gap-1"><CalendarClock size={11} /> {agent.enabled ? 'Ближайшие запуски:' : 'Ближайшие запуски (после включения агента):'}</p>
                <ul className="space-y-0.5 font-mono text-[10px] text-slate-400">
                  {cronPreview.map((t) => (
                    <li key={t.toISOString()}>{t.toISOString().slice(0, 16).replace('T', ' ')} UTC · {fmtDateTime(t.toISOString())} по вашему времени</li>
                  ))}
                </ul>
              </>
            ) : (d.cron.trim() || cur.cron) ? 'В ближайшие 8 дней запусков по этому расписанию нет.' : 'Расписания нет — агент запускается событиями и вручную.'}
          </div>
        )}
      </Row>

      <Row label="Бюджет на запуск" htmlFor="agent-perRun" error={errors.perRun} hint={`Запуск дороже — прерывается с BUDGET_EXCEEDED. Сейчас ${fmtUsd(agent.limits.perRunBudgetUsd)}. 0 — вызовы LLM запрещены.`}>
        {numberInput('perRun', '$', '0.01')}
      </Row>
      <Row label="Бюджет агента в сутки" htmlFor="agent-daily" error={errors.daily} hint={`Запуск, который превысил бы суточный расход агента, останавливается с BUDGET_EXCEEDED. Сейчас ${fmtUsd(agent.limits.dailyBudgetUsd)}.`}>
        {numberInput('daily', '$ / сутки', '0.1')}
      </Row>
      <Row label="Макс. токенов ответа" htmlFor="agent-maxTokens" error={errors.maxTokens} hint={`Ограничение на один вызов модели. Сейчас ${agent.limits.maxOutputTokens.toLocaleString('ru-RU')}.`}>
        {numberInput('maxTokens', 'токенов', '1')}
      </Row>
      <Row label="Попыток на задачу" hint="Задаётся в определении агента (код).">
        <span className="font-mono text-xs text-slate-300">{agent.limits.maxAttempts}</span>
      </Row>
    </Panel>
  )
}
