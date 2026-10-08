'use client'

/**
 * «Провайдеры и ключи» (GIGA → ИИ и автоматизация): LLM providers, their API
 * keys (masked), models with prices, routing of capabilities to models, daily
 * budgets and spend. Data: /api/giga-admin/ai-providers/* (agents.view to read,
 * settings.manage to change — the server checks both; here the controls are
 * simply not rendered for a read-only role).
 */
import { useCallback, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, CheckCircle2, Coins, Cpu, Lock, Plus, Radar, RefreshCw, Server, Wallet, X } from 'lucide-react'
import { RequirePermission, useStaff } from '../StaffContext'
import { useWorkspace } from '../WorkspaceContext'
import { Button, ConfirmDialog, EmptyState, ErrorState, PageHeader, Panel, Skeleton, StatTile, Tabs, cx, gigaFetch, useGigaQuery, type GigaApiError } from '../kit'
import { NoRightHint, Segmented } from '../agents/ui'
import { BudgetsDialog, CredentialDialog, ModelDialog, ProviderDialog } from './dialogs'
import { API, GROUP_LABEL, ROUTE_SLOTS, discoveryResultText, discoverySummary, fmtTokens, fmtUsd, slotKey } from './model'
import type {
  BudgetsResponse,
  CredentialDto,
  DiscoverResponse,
  ModelDto,
  ProviderDto,
  ProvidersResponse,
  RoutesResponse,
  SpendGroupBy,
  SpendResponse,
  StatusResponse,
  VerifyResultDto,
} from './types'
import { BudgetsSummary, ProviderCard, READ_ONLY_TEXT, ROUTING_EXPLANATION, RoutingTable, SpendView, WhoAnswersPanel } from './views'

type Tab = 'providers' | 'routing' | 'budgets' | 'spend'
type Days = '1' | '7' | '30'

const DAYS: ReadonlyArray<{ value: Days; label: string }> = [
  { value: '1', label: '24 часа' }, { value: '7', label: '7 дней' }, { value: '30', label: '30 дней' },
]
const GROUPS: ReadonlyArray<{ value: SpendGroupBy; label: string }> = (['provider', 'model', 'feature', 'company'] as const)
  .map((g) => ({ value: g, label: GROUP_LABEL[g] }))

type Confirm =
  | { kind: 'provider'; provider: ProviderDto }
  | { kind: 'key'; provider: ProviderDto; credential: CredentialDto }
  | { kind: 'model'; provider: ProviderDto; model: ModelDto }
  | { kind: 'route'; slot: string; modelRowId: string | null; text: string }

export function AiProvidersPage() {
  return (
    <RequirePermission permission="agents.view">
      <AiProvidersContent />
    </RequirePermission>
  )
}

function AiProvidersContent() {
  const { base } = useWorkspace()
  const { can } = useStaff()
  const canManage = can('settings.manage')
  const [tab, setTab] = useState<Tab>('providers')
  const [days, setDays] = useState<Days>('7')
  const [groupBy, setGroupBy] = useState<SpendGroupBy>('provider')

  const list = useGigaQuery<ProvidersResponse>(API)
  const routes = useGigaQuery<RoutesResponse>(`${API}/routes`)
  const budgets = useGigaQuery<BudgetsResponse>(`${API}/budgets`)
  const spend = useGigaQuery<SpendResponse>(tab === 'spend' ? `${API}/spend?days=${days}&groupBy=${groupBy}` : null)
  const status = useGigaQuery<StatusResponse>(tab === 'routing' ? `${API}/status` : null)

  const providers = list.data?.providers ?? null
  const encryptionConfigured = list.data?.encryptionConfigured ?? true

  const [flash, setFlash] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [providerDialog, setProviderDialog] = useState<{ provider: ProviderDto | null } | null>(null)
  const [keyDialog, setKeyDialog] = useState<{ provider: ProviderDto; credential: CredentialDto | null } | null>(null)
  const [modelDialog, setModelDialog] = useState<{ provider: ProviderDto; model: ModelDto | null } | null>(null)
  const [budgetsOpen, setBudgetsOpen] = useState(false)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [busy, setBusy] = useState(false)
  const [verifyingId, setVerifyingId] = useState<string | null>(null)
  const [discoveringId, setDiscoveringId] = useState<string | null>(null)
  const [discoveringAll, setDiscoveringAll] = useState(false)
  const [verifyResults, setVerifyResults] = useState<Record<string, VerifyResultDto>>({})
  const [routeDrafts, setRouteDrafts] = useState<Record<string, string>>({})
  const [savingRoute, setSavingRoute] = useState<string | null>(null)

  const reloadList = list.reload
  const reloadRoutes = routes.reload
  const reloadBudgets = budgets.reload
  const reloadStatus = status.reload
  const reloadAll = useCallback(async () => {
    await Promise.all([reloadList(), reloadRoutes(), reloadBudgets(), reloadStatus()])
  }, [reloadList, reloadRoutes, reloadBudgets, reloadStatus])

  const done = useCallback((text: string) => {
    setFlash({ tone: 'ok', text })
    void reloadAll()
  }, [reloadAll])

  const fail = (e: unknown) => setFlash({ tone: 'error', text: e instanceof Error ? e.message : 'Не удалось выполнить действие' })

  async function act(run: () => Promise<unknown>, ok: string) {
    setBusy(true)
    try {
      await run()
      done(ok)
      return true
    } catch (e) {
      fail(e)
      return false
    } finally {
      setBusy(false)
    }
  }

  async function verifyKey(c: CredentialDto) {
    setVerifyingId(c.id)
    try {
      const r = await gigaFetch<{ result: VerifyResultDto }>(`${API}/credentials/${c.id}/verify`, { method: 'POST' })
      setVerifyResults((x) => ({ ...x, [c.id]: r.result }))
      done(r.result.ok ? `Ключ «${c.label}» работает` : `Ключ «${c.label}» не прошёл проверку`)
    } catch (e) {
      fail(e)
    } finally {
      setVerifyingId(null)
    }
  }

  async function discoverKey(c: CredentialDto) {
    setDiscoveringId(c.id)
    try {
      const r = await gigaFetch<DiscoverResponse>(`${API}/discover`, { method: 'POST', json: { credentialId: c.id } })
      const one = r.results[0]
      setFlash({ tone: one?.ok ? 'ok' : 'error', text: one ? discoveryResultText(one) : 'Ключ не найден' })
      void reloadAll()
    } catch (e) {
      fail(e)
    } finally {
      setDiscoveringId(null)
    }
  }

  async function discoverAll() {
    setDiscoveringAll(true)
    try {
      const r = await gigaFetch<DiscoverResponse>(`${API}/discover`, { method: 'POST', json: {} })
      setFlash(discoverySummary(r.results))
      void reloadAll()
    } catch (e) {
      fail(e)
    } finally {
      setDiscoveringAll(false)
    }
  }

  function askRoute(slot: string) {
    const value = routeDrafts[slot] ?? ''
    const s = ROUTE_SLOTS.find((x) => slotKey(x.capability, x.tier) === slot)
    const target = value
      ? providers?.flatMap((p) => p.models.map((m) => ({ p, m }))).find((x) => x.m.id === value)
      : null
    const text = value && target
      ? `«${s?.label ?? slot}» будет обслуживаться моделью ${target.m.model_id} провайдера ${target.p.name}. Изменение действует в течение минуты на всех серверах.`
      : `«${s?.label ?? slot}» перейдёт на автоматический выбор: ${s?.fallback ?? 'OpenRouter из env'}.`
    setConfirm({ kind: 'route', slot, modelRowId: value || null, text })
  }

  async function runConfirm() {
    if (!confirm) return
    if (confirm.kind === 'provider') {
      const ok = await act(() => gigaFetch(`${API}/${confirm.provider.id}`, { method: 'DELETE' }), `Провайдер «${confirm.provider.name}» удалён`)
      if (ok) setConfirm(null)
    } else if (confirm.kind === 'key') {
      const ok = await act(() => gigaFetch(`${API}/credentials/${confirm.credential.id}`, { method: 'DELETE' }), `Ключ «${confirm.credential.label}» удалён`)
      if (ok) setConfirm(null)
    } else if (confirm.kind === 'model') {
      const ok = await act(() => gigaFetch(`${API}/models/${confirm.model.id}`, { method: 'DELETE' }), `Модель ${confirm.model.model_id} удалена`)
      if (ok) setConfirm(null)
    } else {
      const { slot, modelRowId } = confirm
      const s = ROUTE_SLOTS.find((x) => slotKey(x.capability, x.tier) === slot)
      if (!s) return
      setSavingRoute(slot)
      const ok = await act(
        () => gigaFetch(`${API}/routes`, { method: 'PUT', json: { capability: s.capability, tier: s.tier, modelRowId } }),
        modelRowId ? `Маршрут «${s.label}» сохранён` : `Маршрут «${s.label}» сброшен — модель выбирается автоматически`,
      )
      setSavingRoute(null)
      if (ok) {
        setRouteDrafts((x) => { const n = { ...x }; delete n[slot]; return n })
        setConfirm(null)
      }
    }
  }

  const spentToday = (key: string): number | null => {
    const b = budgets.data?.budgets.providers.find((p) => p.key === key)
    return b ? b.spentTodayUsd : null
  }

  const confirmProps = (() => {
    if (!confirm) return null
    switch (confirm.kind) {
      case 'provider': return {
        title: `Удалить провайдера «${confirm.provider.name}»?`,
        text: `Будут удалены его ключи (${confirm.provider.credentials.length}), модели (${confirm.provider.models.length}) и маршруты (${confirm.provider.routes.length}). Запросы этих маршрутов перейдут на встроенный вариант (OpenRouter из env). Отменить нельзя.`,
        confirmLabel: 'Удалить провайдера', tone: 'danger' as const, requireText: confirm.provider.key,
      }
      case 'key': return {
        title: `Удалить ключ «${confirm.credential.label}» (${confirm.credential.masked})?`,
        text: 'Модели, закреплённые за этим ключом, перейдут на другой включённый ключ провайдера или на ключ из env. Восстановить ключ можно только вводом заново.',
        confirmLabel: 'Удалить ключ', tone: 'danger' as const, requireText: undefined,
      }
      case 'model': return {
        title: `Удалить модель ${confirm.model.model_id}?`,
        text: 'Маршруты, направленные на эту модель, будут удалены вместе с ней — их запросы перейдут на встроенный вариант.',
        confirmLabel: 'Удалить модель', tone: 'danger' as const, requireText: undefined,
      }
      default: return { title: 'Изменить маршрут?', text: confirm.text, confirmLabel: 'Применить', tone: 'primary' as const, requireText: undefined }
    }
  })()

  const firstError: GigaApiError | null = list.error ?? null
  const budgetsData = budgets.data?.budgets ?? null

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'GIGA-CRM', href: base }, { label: 'ИИ и автоматизация', href: `${base}/agents` }, { label: 'Провайдеры и ключи' }]}
        title="Провайдеры и ключи"
        description="Провайдеры языковых моделей, ключи API, модели и цены, маршрутизация запросов, дневные бюджеты и расходы."
        actions={
          <>
            <Button size="sm" variant="ghost" icon={<RefreshCw size={13} />} loading={list.loading && !!list.data} onClick={() => void reloadAll()}>Обновить</Button>
            {canManage && tab === 'providers' && (
              <Button
                size="sm"
                variant="secondary"
                icon={<Radar size={13} />}
                loading={discoveringAll}
                title="Запросить список моделей (GET /models) у всех включённых ключей"
                onClick={() => void discoverAll()}
              >
                Обнаружить модели
              </Button>
            )}
            {canManage && tab === 'providers' && (
              <Button size="sm" variant="primary" icon={<Plus size={13} />} onClick={() => setProviderDialog({ provider: null })}>Добавить провайдера</Button>
            )}
          </>
        }
      />

      {!canManage && (
        <div className="mb-4 rounded-xl border border-white/[0.07] bg-white/[0.03] px-4 py-3"><NoRightHint>{READ_ONLY_TEXT}</NoRightHint></div>
      )}
      {list.data && !encryptionConfigured && (
        <p role="alert" className="mb-4 flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/[0.08] px-4 py-3 text-xs text-amber-200">
          <Lock size={14} className="mt-0.5 shrink-0" />
          <span>На сервере не задан <span className="font-mono">SECRETS_ENCRYPTION_KEY</span> — добавить или сменить ключ API нельзя: в открытом виде ключи не хранятся. Уже сохранённые ключи и ключи из env продолжают работать.</span>
        </p>
      )}
      {flash && (
        <div
          role={flash.tone === 'error' ? 'alert' : 'status'}
          className={cx(
            'mb-4 flex items-start gap-2 rounded-xl border px-4 py-2.5 text-xs',
            flash.tone === 'ok' ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200' : 'border-red-500/25 bg-red-500/10 text-red-200',
          )}
        >
          {flash.tone === 'ok' ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" /> : <AlertTriangle size={14} className="mt-0.5 shrink-0" />}
          <span className="min-w-0 flex-1 break-words">{flash.text}</span>
          <button type="button" aria-label="Скрыть сообщение" onClick={() => setFlash(null)} className="text-current opacity-70 hover:opacity-100"><X size={13} /></button>
        </div>
      )}

      <Tabs<Tab>
        className="mb-4"
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'providers', label: 'Провайдеры', count: providers?.length ?? null },
          { key: 'routing', label: 'Маршрутизация' },
          { key: 'budgets', label: 'Бюджеты' },
          { key: 'spend', label: 'Расходы' },
        ]}
      />

      {tab === 'providers' && (
        <div className="space-y-4">
          {firstError && <ErrorState error={firstError} onRetry={() => void list.reload()} />}
          {!providers && list.loading && <div className="space-y-4"><Skeleton className="h-64" /><Skeleton className="h-64" /></div>}
          {providers && providers.length === 0 && (
            <Panel>
              <EmptyState
                icon={<Server size={18} />}
                title="Провайдеров нет"
                text="Пока провайдеры не добавлены, все запросы идут в OpenRouter с ключом из env (OPENROUTER_API_KEY)."
                action={canManage ? <Button variant="primary" icon={<Plus size={13} />} onClick={() => setProviderDialog({ provider: null })}>Добавить провайдера</Button> : undefined}
              />
            </Panel>
          )}
          {budgets.error && providers && <p className="text-[11px] text-slate-500">Расход за сегодня не загрузился: {budgets.error.message}</p>}
          {providers?.map((p) => (
            <ProviderCard
              key={p.id}
              provider={p}
              spentTodayUsd={spentToday(p.key)}
              canManage={canManage}
              encryptionConfigured={encryptionConfigured}
              verifyingId={verifyingId}
              discoveringId={discoveringId}
              verifyResults={verifyResults}
              onEdit={(x) => setProviderDialog({ provider: x })}
              onToggle={(x, enabled) => void act(
                () => gigaFetch(`${API}/${x.id}`, { method: 'PATCH', json: { enabled } }),
                enabled ? `Провайдер «${x.name}» включён` : `Провайдер «${x.name}» выключен — его маршруты перешли на встроенный вариант`,
              )}
              onDelete={(x) => setConfirm({ kind: 'provider', provider: x })}
              onAddKey={(x) => setKeyDialog({ provider: x, credential: null })}
              onAddModel={(x) => setModelDialog({ provider: x, model: null })}
              onEditModel={(x, m) => setModelDialog({ provider: x, model: m })}
              onDeleteModel={(x, m) => setConfirm({ kind: 'model', provider: x, model: m })}
              keyHandlers={{
                onRotate: (c) => setKeyDialog({ provider: p, credential: c }),
                onToggle: (c, enabled) => void act(
                  () => gigaFetch(`${API}/credentials/${c.id}`, { method: 'PATCH', json: { enabled } }),
                  enabled ? `Ключ «${c.label}» включён` : `Ключ «${c.label}» выключен`,
                ),
                onVerify: (c) => void verifyKey(c),
                onDiscover: (c) => void discoverKey(c),
                onDelete: (c) => setConfirm({ kind: 'key', provider: p, credential: c }),
              }}
            />
          ))}
        </div>
      )}

      {tab === 'routing' && (
        <Panel
          className="mb-4"
          title="Кто отвечает сейчас"
          description="Модель, которая примет запрос прямо сейчас, по каждой возможности, и порядок переключения при сбое."
          actions={<Button size="sm" variant="ghost" icon={<RefreshCw size={12} />} loading={status.loading && !!status.data} onClick={() => void status.reload()}>Проверить</Button>}
        >
          {status.error && <ErrorState error={status.error} onRetry={() => void status.reload()} />}
          {!status.data && status.loading && <Skeleton className="h-40" />}
          {status.data && <WhoAnswersPanel slots={status.data.slots} checkedAt={status.data.checkedAt} />}
        </Panel>
      )}

      {tab === 'routing' && (
        <Panel title="Маршрутизация" description={ROUTING_EXPLANATION} bodyClassName="p-0">
          {(routes.error || list.error) && <div className="p-4"><ErrorState error={routes.error ?? list.error} onRetry={() => void reloadAll()} /></div>}
          {(!routes.data || !providers) && (routes.loading || list.loading) && <div className="p-4"><Skeleton className="h-48" /></div>}
          {routes.data && providers && (
            <RoutingTable
              providers={providers}
              routes={routes.data.routes}
              canManage={canManage}
              drafts={routeDrafts}
              savingKey={savingRoute}
              onDraft={(slot, value) => setRouteDrafts((x) => ({ ...x, [slot]: value }))}
              onSave={askRoute}
            />
          )}
        </Panel>
      )}

      {tab === 'budgets' && (
        <Panel
          title="Дневные бюджеты"
          description="Сутки считаются с 00:00 по времени сервера базы данных. Вызов, который превысил бы лимит, останавливается с ошибкой BUDGET_EXCEEDED."
        >
          {budgets.error && <ErrorState error={budgets.error} onRetry={() => void budgets.reload()} />}
          {!budgetsData && budgets.loading && <Skeleton className="h-48" />}
          {budgetsData && <BudgetsSummary budgets={budgetsData} canManage={canManage} onEdit={() => setBudgetsOpen(true)} />}
        </Panel>
      )}

      {tab === 'spend' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Segmented label="Период" value={days} options={DAYS} onChange={setDays} />
            <Segmented label="Группировка" value={groupBy} options={GROUPS} onChange={setGroupBy} />
            <Link href={`${base}/agents/costs`} className="ml-auto text-[11px] text-blue-300 hover:underline">По дням и агентам — «Стоимость ИИ»</Link>
          </div>
          {spend.error && <ErrorState error={spend.error} onRetry={() => void spend.reload()} />}
          {!spend.data && spend.loading && <div className="space-y-3"><div className="grid grid-cols-3 gap-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24" />)}</div><Skeleton className="h-48" /></div>}
          {spend.data && (
            <div className={cx('space-y-4', spend.loading && 'opacity-70 transition-opacity')}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <StatTile label={`Расход за ${DAYS.find((x) => x.value === days)?.label}`} value={fmtUsd(spend.data.totalUsd)} icon={<Coins size={14} />} />
                <StatTile label="Вызовов" value={spend.data.rows.reduce((s, r) => s + r.calls, 0).toLocaleString('ru-RU')} icon={<Cpu size={14} />} tone="violet" />
                <StatTile
                  label="Токены"
                  value={fmtTokens(spend.data.rows.reduce((s, r) => s + r.tokensIn + r.tokensOut, 0))}
                  icon={<Wallet size={14} />}
                  tone="neutral"
                />
              </div>
              <Panel
                title={`По группе «${GROUP_LABEL[spend.data.groupBy]}»`}
                description="Функции платформы (ai_usage_ledger) и запуски агентов (agent_runs). Окно — последние N×24 часа; до 200 строк, самые дорогие сверху."
                bodyClassName="p-0"
              >
                <SpendView groupBy={spend.data.groupBy} rows={spend.data.rows} totalUsd={spend.data.totalUsd} providers={providers ?? []} />
              </Panel>
            </div>
          )}
        </div>
      )}

      {canManage && (
        <>
          <ProviderDialog
            open={!!providerDialog}
            provider={providerDialog?.provider ?? null}
            onClose={() => setProviderDialog(null)}
            onDone={(m) => { setProviderDialog(null); done(m) }}
          />
          <CredentialDialog
            open={!!keyDialog}
            provider={keyDialog?.provider ?? null}
            credential={keyDialog?.credential ?? null}
            onClose={() => setKeyDialog(null)}
            onDone={done}
          />
          <ModelDialog
            open={!!modelDialog}
            provider={modelDialog?.provider ?? null}
            model={modelDialog?.model ?? null}
            onClose={() => setModelDialog(null)}
            onDone={(m) => { setModelDialog(null); done(m) }}
          />
          <BudgetsDialog
            open={budgetsOpen}
            budgets={budgetsData}
            onClose={() => setBudgetsOpen(false)}
            onDone={(m) => { setBudgetsOpen(false); done(m) }}
          />
          <ConfirmDialog
            open={!!confirm}
            onClose={() => setConfirm(null)}
            onConfirm={() => void runConfirm()}
            loading={busy}
            title={confirmProps?.title ?? ''}
            text={confirmProps?.text}
            confirmLabel={confirmProps?.confirmLabel}
            tone={confirmProps?.tone}
            requireText={confirmProps?.requireText}
          />
        </>
      )}
    </>
  )
}
