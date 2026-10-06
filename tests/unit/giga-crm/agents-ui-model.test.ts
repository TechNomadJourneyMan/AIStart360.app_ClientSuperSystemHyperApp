/**
 * «ИИ-агенты» in GIGA: the pure view model behind the pages — Russian status
 * labels, cost / token / duration formatting, the permission matrix (code
 * ceiling can never be loosened from the UI), the settings form patch, cron
 * preview, the cost series and notification links.
 */
import { describe, expect, it } from 'vitest'
import {
  CANCELLABLE, CEILING_NOTE, LIVE_TASK_STATUSES, RETRYABLE, TASK_STATUSES,
  approvalStatusMeta, budgetUsage, buildConfigPatch, buildPermissionMatrix, decidedViaLabel, decisionOptions, explainOutcome,
  fillDailySeries, fmtCountdown, fmtDuration, fmtPercent, fmtTokens, fmtUsd, grantsPayload, initialConfigDraft, nextCronRuns,
  notificationHref, notificationLevelMeta, parseRunInput, shareOf, shortActor, spendOn, summarizeAgents, taskStatusMeta,
  toolCallStatusMeta, totalsOf, triggerLabel,
  type CatalogEntry, type ConfigCurrent,
} from '@/components/giga-panel/agents/model'
import { PERMISSIONS, PERMISSION_CEILING, PERMISSION_LABELS } from '@/lib/agents/permissions'

const CYRILLIC = /[а-яё]/i

describe('статусы — по-русски и с понятным тоном', () => {
  it('у каждого статуса задачи есть русская подпись', () => {
    for (const s of TASK_STATUSES) expect(taskStatusMeta(s).label, s).toMatch(CYRILLIC)
    expect(taskStatusMeta('awaiting_approval').label).toBe('Ждёт одобрения')
    expect(taskStatusMeta('dead').tone).toBe('red')
    expect(taskStatusMeta('succeeded').tone).toBe('green')
  })

  it('неизвестный статус не ломает страницу', () => {
    expect(taskStatusMeta('weird')).toEqual({ label: 'weird', tone: 'neutral' })
    expect(taskStatusMeta(null).label).toBe('—')
  })

  it('отмена и повтор доступны ровно в тех статусах, что принимает сервер', () => {
    expect([...CANCELLABLE].sort()).toEqual(['awaiting_approval', 'failed', 'queued'])
    expect([...RETRYABLE].sort()).toEqual(['cancelled', 'dead', 'failed'])
    expect(LIVE_TASK_STATUSES.has('running')).toBe(true)
    expect(LIVE_TASK_STATUSES.has('succeeded')).toBe(false)
  })

  it('одобрения, вызовы инструментов, уровни уведомлений и триггеры', () => {
    expect(approvalStatusMeta('pending').label).toBe('Ожидает решения')
    expect(approvalStatusMeta('executed').label).toBe('Исполнено')
    expect(decidedViaLabel('telegram')).toBe('в Telegram')
    expect(decidedViaLabel('admin')).toBe('в GIGA')
    expect(toolCallStatusMeta('pending_approval').tone).toBe('amber')
    expect(notificationLevelMeta('CRITICAL')).toEqual({ label: 'Критично', tone: 'red' })
    expect(notificationLevelMeta('APPROVAL_REQUIRED').label).toBe('Нужно одобрение')
    for (const l of ['INFO', 'SUCCESS', 'WARNING', 'CRITICAL', 'APPROVAL_REQUIRED']) expect(notificationLevelMeta(l).label).toMatch(CYRILLIC)
    expect(triggerLabel('schedule')).toBe('Расписание')
    expect(triggerLabel('manual')).toBe('Вручную')
  })
})

describe('форматирование', () => {
  it('стоимость: доли цента видны, пустое — прочерк', () => {
    expect(fmtUsd(0)).toBe('$0')
    expect(fmtUsd(0.0042)).toBe('$0.0042')
    expect(fmtUsd(0.00001)).toBe('<$0.0001')
    expect(fmtUsd(1.234)).toBe('$1.23')
    expect(fmtUsd(50)).toBe('$50.00')
    expect(fmtUsd(null)).toBe('—')
    expect(fmtUsd(Number.NaN)).toBe('—')
  })

  it('токены', () => {
    expect(fmtTokens(950)).toBe('950')
    expect(fmtTokens(1000)).toBe('1 тыс.')
    expect(fmtTokens(12_300)).toBe('12,3 тыс.')
    expect(fmtTokens(2_500_000)).toBe('2,5 млн')
    expect(fmtTokens(undefined)).toBe('—')
  })

  it('длительность', () => {
    expect(fmtDuration(850)).toBe('850 мс')
    expect(fmtDuration(12_400)).toBe('12,4 с')
    expect(fmtDuration(120_000)).toBe('2 мин')
    expect(fmtDuration(185_000)).toBe('3 мин 5 с')
    expect(fmtDuration(3_720_000)).toBe('1 ч 2 мин')
    expect(fmtDuration(null)).toBe('—')
  })

  it('проценты: нет запусков — прочерк, а не 0 %', () => {
    expect(fmtPercent(null)).toBe('—')
    expect(fmtPercent(0.875)).toBe('88%')
  })

  it('обратный отсчёт до истечения одобрения', () => {
    const now = new Date('2026-10-06T10:00:00Z')
    expect(fmtCountdown('2026-10-06T09:59:00Z', now)).toMatchObject({ expired: true })
    expect(fmtCountdown('2026-10-06T10:00:30Z', now)).toMatchObject({ text: 'меньше минуты', urgent: true })
    expect(fmtCountdown('2026-10-06T10:45:00Z', now)).toMatchObject({ text: 'через 45 мин', urgent: true })
    expect(fmtCountdown('2026-10-06T13:12:00Z', now)).toMatchObject({ text: 'через 3 ч 12 мин', urgent: false })
    expect(fmtCountdown('2026-10-06T12:00:00Z', now).text).toBe('через 2 ч')
  })

  it('кто решил — без выдуманных имён', () => {
    expect(shortActor('giga:super_admin')).toContain('общий пароль')
    expect(shortActor('agent:monitoring')).toBe('агент monitoring')
    expect(shortActor('system')).toBe('система')
    expect(shortActor('0b7c5a2e-1111-4222-8333-444455556666')).toBe('сотрудник 0b7c5a2e')
    expect(shortActor(null)).toBe('—')
  })
})

const CATALOG: CatalogEntry[] = PERMISSIONS.map((p) => ({ key: p, label: PERMISSION_LABELS[p], ceiling: PERMISSION_CEILING[p] }))

describe('матрица прав агента', () => {
  it('выше потолка выбрать нельзя — и это объяснено', () => {
    const opts = decisionOptions('REQUIRE_APPROVAL')
    const allow = opts.find((o) => o.value === 'ALLOW')!
    expect(allow.disabled).toBe(true)
    expect(allow.reason).toBe(CEILING_NOTE)
    expect(CEILING_NOTE).toBe('Потолок безопасности: это действие всегда требует человека')
    expect(opts.filter((o) => !o.disabled).map((o) => o.value)).toEqual(['REQUIRE_APPROVAL', 'DENY'])
    expect(decisionOptions('ALLOW').every((o) => !o.disabled)).toBe(true)
  })

  it('строки: итог из API, потолок из каталога, инструменты по праву, правки', () => {
    const rows = buildPermissionMatrix(
      CATALOG,
      { READ_CLIENT_DATA: 'ALLOW', SEND_TELEGRAM: 'ALLOW', SEND_EMAIL: 'REQUIRE_APPROVAL' },
      [{ name: 'platform.health_snapshot', permission: 'READ_CLIENT_DATA' }, { name: 'notify.staff', permission: 'SEND_TELEGRAM' }],
      { SEND_TELEGRAM: 'DENY', DELETE_DATA: null },
    )
    expect(rows).toHaveLength(PERMISSIONS.length)
    const read = rows.find((r) => r.key === 'READ_CLIENT_DATA')!
    expect(read).toMatchObject({ effective: 'ALLOW', ceiling: 'ALLOW', ceilingLocked: false, tools: ['platform.health_snapshot'], dirty: false, selected: 'ALLOW' })
    const tg = rows.find((r) => r.key === 'SEND_TELEGRAM')!
    expect(tg).toMatchObject({ effective: 'ALLOW', selected: 'DENY', dirty: true, reset: false })
    const del = rows.find((r) => r.key === 'DELETE_DATA')!
    expect(del).toMatchObject({ effective: 'DENY', ceilingLocked: true, dirty: true, reset: true, selected: 'DENY' })
    // Not returned by the API → treated as DENY, never as allowed.
    expect(rows.find((r) => r.key === 'MODIFY_SYSTEM')!.effective).toBe('DENY')
  })

  it('в PUT уходят только правки, и никогда не мягче потолка', () => {
    const body = grantsPayload({ SEND_EMAIL: 'ALLOW', CALL_LLM: 'DENY', DELETE_DATA: null, BOGUS: 'ALLOW' }, CATALOG)
    expect(body).toEqual({ SEND_EMAIL: 'REQUIRE_APPROVAL', CALL_LLM: 'DENY', DELETE_DATA: null })
  })

  it('объясняет, почему итог строже выбранного', () => {
    expect(explainOutcome('ALLOW', 'REQUIRE_APPROVAL', 'REQUIRE_APPROVAL', true)).toContain(CEILING_NOTE)
    expect(explainOutcome('ALLOW', 'DENY', 'ALLOW')).toContain('не объявляет')
    expect(explainOutcome('DENY', 'DENY', 'ALLOW')).toBeNull()
    expect(explainOutcome(null, 'ALLOW', 'ALLOW')).toBeNull()
  })
})

const CUR: ConfigCurrent = {
  scope: 'platform', tier: 'standard', model: null, cron: '*/15 * * * *',
  limits: { perRunBudgetUsd: 0.3, dailyBudgetUsd: 20, maxOutputTokens: 4000 },
}

describe('настройки агента → PATCH', () => {
  it('без правок ничего не отправляется', () => {
    expect(buildConfigPatch(initialConfigDraft(CUR), CUR)).toEqual({ patch: {}, errors: {} })
  })

  it('отправляются только изменённые поля; пусто и «по умолчанию» — null', () => {
    const d = initialConfigDraft(CUR)
    const { patch, errors } = buildConfigPatch({
      ...d, tier: 'reset', model: 'anthropic/claude-haiku-4.5', cron: '0  6 * * 1', perRun: '0,5', reset: { perRun: false, daily: true, maxTokens: false },
    }, CUR)
    expect(errors).toEqual({})
    expect(patch).toEqual({ tierOverride: null, modelOverride: 'anthropic/claude-haiku-4.5', scheduleCron: '0 6 * * 1', perRunBudgetUsd: 0.5, dailyBudgetUsd: null })
  })

  it('ошибки формата и диапазона — по-русски, и тогда PATCH не нужен', () => {
    const d = initialConfigDraft(CUR)
    const { errors } = buildConfigPatch({ ...d, model: 'Claude Sonnet', cron: '* * *', perRun: '60', daily: '-1', maxTokens: '100.5' }, CUR)
    expect(Object.keys(errors).sort()).toEqual(['cron', 'daily', 'maxTokens', 'model', 'perRun'])
    expect(errors.model).toContain('provider/model')
    expect(errors.cron).toContain('5 полей')
    expect(errors.maxTokens).toContain('Целое число')
  })

  it('расписание у агента компании не отправляется', () => {
    const company: ConfigCurrent = { ...CUR, scope: 'company', cron: null }
    expect(buildConfigPatch({ ...initialConfigDraft(company), cron: '0 * * * *' }, company).patch).toEqual({})
  })

  it('ручной запуск: JSON-вход — только объект', () => {
    expect(parseRunInput('')).toEqual({ ok: true, value: undefined })
    expect(parseRunInput('{"refresh": true}')).toEqual({ ok: true, value: { refresh: true } })
    expect(parseRunInput('[1]')).toMatchObject({ ok: false })
    expect(parseRunInput('{oops')).toMatchObject({ ok: false, error: 'Неверный JSON' })
  })
})

describe('расписание: ближайшие запуски (UTC)', () => {
  it('*/15 после 10:07:30 → 10:15, 10:30, 10:45', () => {
    const runs = nextCronRuns('*/15 * * * *', new Date('2026-10-06T10:07:30Z'), 3)
    expect(runs.map((d) => d.toISOString())).toEqual(['2026-10-06T10:15:00.000Z', '2026-10-06T10:30:00.000Z', '2026-10-06T10:45:00.000Z'])
  })
  it('неверное выражение — пусто', () => {
    expect(nextCronRuns('every 5 minutes', new Date())).toEqual([])
  })
})

describe('стоимость', () => {
  const today = new Date('2026-10-06T15:00:00Z')

  it('ряд по дням с нулями для дней без запусков', () => {
    const s = fillDailySeries([
      { day: '2026-10-04T00:00:00.000Z', cost: 0.5, runs: 2, tin: 1000, tout: 200 },
      { day: '2026-10-06T00:00:00.000Z', cost: '1.25', runs: 3, tin: 10, tout: 5 },
    ], 3, today)
    expect(s.map((p) => [p.day, p.cost, p.runs])).toEqual([['2026-10-04', 0.5, 2], ['2026-10-05', 0, 0], ['2026-10-06', 1.25, 3]])
    expect(s[0].label).toBe('04.10')
    expect(totalsOf(s)).toEqual({ cost: 1.75, runs: 5, tokensIn: 1010, tokensOut: 205 })
    expect(spendOn(s, today)).toBe(1.25)
  })

  it('частичный первый день периода не теряется', () => {
    const s = fillDailySeries([{ day: '2026-09-29', cost: 1, runs: 1 }], 7, today)
    expect(s[0].day).toBe('2026-09-29')
    expect(s).toHaveLength(8)
    expect(totalsOf(s).cost).toBe(1)
  })

  it('заполнение бюджета: жёлтый с 80 %, красный с 100 %', () => {
    expect(budgetUsage(10, 50)).toMatchObject({ tone: 'green', label: '20%' })
    expect(budgetUsage(40, 50)!.tone).toBe('amber')
    expect(budgetUsage(55, 50)!.tone).toBe('red')
    expect(budgetUsage(1, 0)).toBeNull()
    expect(shareOf(0.001, 10)).toBe('<1%')
    expect(shareOf(1, 0)).toBe('—')
  })

  it('сводка по агентам', () => {
    const stats = { runs7d: 10, costUsd7d: 1.5, costUsdToday: 0.2, queued: 1, running: 0, awaitingApproval: 2, dead24h: 1, failed7d: 3 }
    const s = summarizeAgents([{ enabled: true, stats }, { enabled: false, stats }])
    expect(s).toMatchObject({ total: 2, enabled: 1, runs7d: 20, failed7d: 6, awaiting: 4, dead24h: 2, queued: 2 })
    expect(s.cost7d).toBeCloseTo(3)
  })
})

describe('ссылки из уведомлений', () => {
  const base = '/admin-giga-panel'
  it('одобрение важнее задачи, задача важнее агента', () => {
    expect(notificationHref({ approval_id: 'a1', entity_type: 'agent_task', entity_id: 't1', agent_key: 'm' }, base)?.href).toBe('/admin-giga-panel/agents/approvals?focus=a1')
    expect(notificationHref({ entity_type: 'agent_approval', entity_id: 'a2' }, base)?.href).toBe('/admin-giga-panel/agents/approvals?focus=a2')
    expect(notificationHref({ entity_type: 'agent_task', entity_id: 't1' }, base)?.href).toBe('/admin-giga-panel/agents/tasks/t1')
    expect(notificationHref({ entity_type: 'agent_run', entity_id: 'r1', agent_key: 'monitoring' }, base)?.href).toBe('/admin-giga-panel/agents/monitoring')
    expect(notificationHref({ entity_type: 'company' }, base)).toBeNull()
  })
})
