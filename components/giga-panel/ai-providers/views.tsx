'use client'

/**
 * «Провайдеры и ключи» — stateless pieces of the page: provider card (keys,
 * models, routes, today's spend), routing table, budgets and spend views.
 * Everything comes in through props; the page (AiProvidersPage) owns fetching
 * and dialogs. Rendered in tests with react-dom/server.
 *
 * Without `canManage` no mutation control is rendered at all — the page shows
 * a read-only explanation instead.
 */
import type { ReactNode } from 'react'
import { CheckCircle2, Coins, KeyRound, Pencil, Plus, RotateCcw, ShieldAlert, ShieldCheck, Trash2, XCircle } from 'lucide-react'
import { Badge, BarList, Button, DataTable, EmptyState, cx, fmtDateTime, inputClass, type Column } from '../kit'
import { NoRightHint, Toggle } from '../agents/ui'
import {
  CAPABILITY_LABEL,
  CAPABILITY_TONE,
  CHECKED_WITH_LABEL,
  GROUP_LABEL,
  KIND_LABEL,
  ROUTE_SLOTS,
  SOURCE_LABEL,
  budgetUsage,
  fmtPrice,
  fmtTokens,
  fmtUsd,
  modelOptionsFor,
  modelsUsingKey,
  providersSpentToday,
  routeFor,
  routeLabel,
  routeProblem,
  shareOf,
  slotKey,
  spendKeyLabel,
  verifyMeta,
} from './model'
import type { BudgetsDto, CredentialDto, ModelDto, ProviderDto, RouteDto, SpendGroupBy, SpendRowDto, VerifyResultDto } from './types'

export const READ_ONLY_TEXT = 'Режим просмотра: изменять провайдеров, ключи, модели, маршруты и бюджеты может только Super Admin (право «Системные настройки»).'

// ─── Small parts ─────────────────────────────────────────────────────────────

export function SpendBar({ label, spent, budget, emptyText = 'без лимита' }: { label: ReactNode; spent: number; budget: number | null; emptyText?: string }) {
  const usage = budgetUsage(spent, budget)
  const bar: Record<string, string> = { green: 'bg-emerald-400/70', amber: 'bg-amber-400/80', red: 'bg-red-400/80' }
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="truncate text-slate-300">{label}</span>
        <span className="shrink-0 font-mono tabular-nums text-slate-300">
          {fmtUsd(spent)} <span className="text-slate-500">/ {budget == null ? emptyText : fmtUsd(budget)}</span>
        </span>
      </div>
      {usage ? (
        <div
          className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.05]"
          role="progressbar"
          aria-label={`израсходовано ${usage.label} дневного бюджета`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.min(100, Math.round(usage.ratio * 100))}
        >
          <div className={cx('h-full rounded-full', bar[usage.tone] ?? 'bg-blue-400/70')} style={{ width: `${Math.min(100, Math.max(usage.ratio > 0 ? 2 : 0, usage.ratio * 100))}%` }} />
        </div>
      ) : budget === 0 ? (
        <p className="mt-1 text-[10px] text-amber-300/80">Лимит 0 — вызовы через этого провайдера запрещены.</p>
      ) : null}
    </div>
  )
}

function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{children}</p>
      {action}
    </div>
  )
}

// ─── Keys ────────────────────────────────────────────────────────────────────

export interface KeyHandlers {
  onRotate?: (c: CredentialDto) => void
  onToggle?: (c: CredentialDto, enabled: boolean) => void
  onVerify?: (c: CredentialDto) => void
  onDelete?: (c: CredentialDto) => void
}

export function VerifyOutcome({ result }: { result: VerifyResultDto }) {
  const how = `${CHECKED_WITH_LABEL[result.checkedWith]}${result.model ? ` · ${result.model}` : ''}`
  return (
    <p role="status" className={cx('mt-1.5 flex items-start gap-1.5 text-[11px]', result.ok ? 'text-emerald-300' : 'text-red-300')}>
      {result.ok ? <CheckCircle2 size={12} className="mt-0.5 shrink-0" /> : <XCircle size={12} className="mt-0.5 shrink-0" />}
      <span>
        {result.ok ? 'Ключ работает' : 'Проверка не прошла'} — {how}
        {result.error && <span className="block break-words text-red-200/80">{result.error}</span>}
      </span>
    </p>
  )
}

export function CredentialRow({ provider, credential: c, canManage, encryptionConfigured, verifying, verifyResult, handlers }: {
  provider: Pick<ProviderDto, 'models'>
  credential: CredentialDto
  canManage: boolean
  encryptionConfigured: boolean
  verifying?: boolean
  verifyResult?: VerifyResultDto | null
  handlers?: KeyHandlers
}) {
  const v = verifyMeta(c)
  const bound = modelsUsingKey(provider, c.id)
  return (
    <li className="rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-2.5" data-testid="credential-row">
      <div className="flex flex-wrap items-center gap-2">
        <KeyRound size={13} className="text-slate-500" />
        <span className="text-xs font-medium text-slate-200">{c.label}</span>
        <span className="font-mono text-[11px] text-slate-400" aria-label="Ключ скрыт, видны последние символы">{c.masked}</span>
        {!c.enabled && <Badge tone="neutral">выключен</Badge>}
        <Badge tone={v.tone} title={v.hint ?? undefined}>{v.label}</Badge>
        {c.last_verified_at && <span className="text-[10px] text-slate-600">{fmtDateTime(c.last_verified_at)}</span>}
        {canManage && (
          <span className="ml-auto flex flex-wrap items-center gap-1.5">
            <Toggle checked={c.enabled} label={c.enabled ? `Выключить ключ ${c.label}` : `Включить ключ ${c.label}`} onChange={(next) => handlers?.onToggle?.(c, next)} />
            <Button size="sm" variant="secondary" icon={<ShieldCheck size={12} />} loading={verifying} onClick={() => handlers?.onVerify?.(c)}>Проверить</Button>
            <Button
              size="sm"
              variant="ghost"
              icon={<RotateCcw size={12} />}
              disabled={!encryptionConfigured}
              title={encryptionConfigured ? 'Заменить секрет ключа' : 'На сервере не задан SECRETS_ENCRYPTION_KEY'}
              onClick={() => handlers?.onRotate?.(c)}
            >
              Сменить ключ
            </Button>
            <Button size="sm" variant="ghost" aria-label={`Удалить ключ ${c.label}`} icon={<Trash2 size={12} />} onClick={() => handlers?.onDelete?.(c)} />
          </span>
        )}
      </div>
      {c.last_verify_ok === false && c.last_verify_error && !verifyResult && (
        <p className="mt-1 break-words text-[11px] text-red-300/80">{c.last_verify_error}</p>
      )}
      {verifyResult && <VerifyOutcome result={verifyResult} />}
      {(bound.length > 0 || c.rotated_at) && (
        <p className="mt-1 text-[10px] text-slate-600">
          {bound.length > 0 && <>Закреплён за: {bound.map((m) => m.model_id).join(', ')}. </>}
          {c.rotated_at && <>Сменён {fmtDateTime(c.rotated_at)}.</>}
        </p>
      )}
    </li>
  )
}

// ─── Models ──────────────────────────────────────────────────────────────────

export function ModelsTable({ provider, canManage, onEdit, onDelete }: {
  provider: Pick<ProviderDto, 'models' | 'credentials' | 'routes'>
  canManage: boolean
  onEdit?: (m: ModelDto) => void
  onDelete?: (m: ModelDto) => void
}) {
  if (provider.models.length === 0) {
    return <p className="rounded-xl border border-dashed border-white/[0.06] px-3 py-3 text-[11px] text-slate-500">Моделей нет. Добавьте id модели у провайдера, чтобы направить на неё запросы.</p>
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-left text-xs">
        <thead>
          <tr className="border-b border-white/[0.06] text-[10px] uppercase tracking-wider text-slate-500">
            <th scope="col" className="px-2 py-2 font-medium">Модель</th>
            <th scope="col" className="px-2 py-2 font-medium">Возможность</th>
            <th scope="col" className="px-2 py-2 font-medium">Ключ</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">Вход / 1M</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">Выход / 1M</th>
            <th scope="col" className="px-2 py-2 font-medium">Маршруты</th>
            {canManage && <th scope="col" className="px-2 py-2"><span className="sr-only">Действия</span></th>}
          </tr>
        </thead>
        <tbody>
          {provider.models.map((m) => {
            const cred = m.credential_id ? provider.credentials.find((c) => c.id === m.credential_id) : null
            const routes = provider.routes.filter((r) => r.model_id === m.id)
            return (
              <tr key={m.id} className="border-b border-white/[0.04]" data-testid="model-row">
                <td className="px-2 py-2">
                  <span className="font-mono text-[11px] text-slate-200">{m.model_id}</span>
                  {m.label && <span className="ml-1.5 text-[11px] text-slate-500">{m.label}</span>}
                  {!m.enabled && <Badge tone="neutral" className="ml-1.5">выключена</Badge>}
                </td>
                <td className="px-2 py-2"><Badge tone={CAPABILITY_TONE[m.capability]}>{CAPABILITY_LABEL[m.capability]}</Badge></td>
                <td className="px-2 py-2 text-[11px] text-slate-400">{cred ? <>{cred.label} <span className="font-mono">{cred.masked}</span></> : 'любой включённый'}</td>
                <td className="px-2 py-2 text-right font-mono tabular-nums text-slate-300">{fmtPrice(m.price_in_per_mtok)}</td>
                <td className="px-2 py-2 text-right font-mono tabular-nums text-slate-300">{fmtPrice(m.price_out_per_mtok)}</td>
                <td className="px-2 py-2">
                  {routes.length ? <span className="flex flex-wrap gap-1">{routes.map((r) => <Badge key={slotKey(r.capability, r.tier)} tone="blue">{routeLabel(r)}</Badge>)}</span> : <span className="text-[11px] text-slate-600">—</span>}
                </td>
                {canManage && (
                  <td className="px-2 py-2 text-right">
                    <span className="inline-flex gap-1">
                      <Button size="sm" variant="ghost" aria-label={`Изменить модель ${m.model_id}`} icon={<Pencil size={12} />} onClick={() => onEdit?.(m)} />
                      <Button size="sm" variant="ghost" aria-label={`Удалить модель ${m.model_id}`} icon={<Trash2 size={12} />} onClick={() => onDelete?.(m)} />
                    </span>
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── Provider card ───────────────────────────────────────────────────────────

export interface ProviderCardProps {
  provider: ProviderDto
  spentTodayUsd: number | null
  canManage: boolean
  encryptionConfigured: boolean
  verifyingId?: string | null
  verifyResults?: Record<string, VerifyResultDto>
  onEdit?: (p: ProviderDto) => void
  onToggle?: (p: ProviderDto, enabled: boolean) => void
  onDelete?: (p: ProviderDto) => void
  onAddKey?: (p: ProviderDto) => void
  onAddModel?: (p: ProviderDto) => void
  onEditModel?: (p: ProviderDto, m: ModelDto) => void
  onDeleteModel?: (p: ProviderDto, m: ModelDto) => void
  keyHandlers?: KeyHandlers
}

export function ProviderCard(props: ProviderCardProps) {
  const { provider: p, spentTodayUsd, canManage, encryptionConfigured } = props
  const headerNames = Object.keys(p.extra_headers ?? {})
  const enabledKeys = p.credentials.filter((c) => c.enabled).length
  return (
    <article
      className={cx('rounded-2xl border bg-white/[0.03] backdrop-blur-sm', p.enabled ? 'border-white/[0.07]' : 'border-white/[0.04] opacity-80')}
      aria-labelledby={`provider-${p.id}`}
      data-testid="provider-card"
      data-provider-key={p.key}
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-white/[0.06] px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id={`provider-${p.id}`} className="text-sm font-semibold text-slate-100">{p.name}</h2>
            <span className="font-mono text-[11px] text-slate-500">{p.key}</span>
            <Badge tone={p.kind === 'openrouter' ? 'violet' : 'blue'}>{KIND_LABEL[p.kind]}</Badge>
            {p.enabled ? <Badge tone="green">включён</Badge> : <Badge tone="neutral">выключен</Badge>}
            {enabledKeys === 0 && <Badge tone="amber" title="Без ключа провайдер работает только с ключом из env (если он задан)">нет включённых ключей</Badge>}
          </div>
          <p className="mt-1 break-all font-mono text-[11px] text-slate-400">{p.base_url}</p>
        </div>
        {canManage && (
          <div className="flex flex-wrap items-center gap-2">
            <Toggle checked={p.enabled} label={p.enabled ? `Выключить провайдера ${p.name}` : `Включить провайдера ${p.name}`} onChange={(next) => props.onToggle?.(p, next)} />
            <Button size="sm" variant="secondary" icon={<Pencil size={12} />} onClick={() => props.onEdit?.(p)}>Изменить</Button>
            <Button size="sm" variant="ghost" aria-label={`Удалить провайдера ${p.name}`} icon={<Trash2 size={12} />} onClick={() => props.onDelete?.(p)} />
          </div>
        )}
      </header>

      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <dl className="grid grid-cols-[minmax(7rem,auto)_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-xs">
          <dt className="text-slate-500">Пути</dt>
          <dd className="min-w-0 break-words font-mono text-[11px] text-slate-300">
            chat {p.chat_path} · embeddings {p.embeddings_path}{p.rerank_path ? ` · rerank ${p.rerank_path}` : ''}
          </dd>
          <dt className="text-slate-500">OCR</dt>
          <dd className="text-slate-300">{p.ocr_mode === 'chat_vision' ? 'через vision-модель (chat_vision)' : 'нет'}</dd>
          <dt className="text-slate-500">response_format</dt>
          <dd className="text-slate-300">{p.supports_response_format ? 'поддерживается' : 'не поддерживается'}</dd>
          <dt className="text-slate-500">Доп. заголовки</dt>
          <dd className="min-w-0 break-words font-mono text-[11px] text-slate-300">{headerNames.length ? headerNames.join(', ') : '—'}</dd>
          <dt className="text-slate-500">Приватность</dt>
          <dd className="min-w-0 break-words text-slate-300">{p.privacy_note || <span className="text-slate-600">не указано</span>}</dd>
        </dl>
        <div className="space-y-3">
          {spentTodayUsd === null
            ? <p className="text-[11px] text-slate-500">Расход за сегодня недоступен.</p>
            : <SpendBar label="Расход сегодня / дневной бюджет" spent={spentTodayUsd} budget={p.daily_budget_usd} />}
          <div>
            <SectionTitle>Обслуживает маршруты</SectionTitle>
            {p.routes.length
              ? <div className="flex flex-wrap gap-1">{p.routes.map((r) => <Badge key={slotKey(r.capability, r.tier)} tone="blue" title={r.model}>{routeLabel(r)} → {r.model}</Badge>)}</div>
              : <p className="text-[11px] text-slate-600">Ни один маршрут не направлен на этого провайдера.</p>}
          </div>
        </div>
      </div>

      <div className="space-y-4 border-t border-white/[0.05] p-4">
        <section aria-label={`Ключи ${p.name}`}>
          <SectionTitle
            action={canManage && (
              <Button
                size="sm"
                variant="secondary"
                icon={<Plus size={12} />}
                disabled={!encryptionConfigured}
                title={encryptionConfigured ? undefined : 'На сервере не задан SECRETS_ENCRYPTION_KEY — ключ сохранить нельзя'}
                onClick={() => props.onAddKey?.(p)}
              >
                Добавить ключ
              </Button>
            )}
          >
            Ключи API
          </SectionTitle>
          {p.credentials.length === 0 ? (
            <p className="rounded-xl border border-dashed border-white/[0.06] px-3 py-3 text-[11px] text-slate-500">
              Ключей нет.{p.key === 'openrouter' ? ' Используется OPENROUTER_API_KEY из env, если он задан.' : p.key === 'alem' ? ' Используется ALEM_API_KEY из env, если он задан.' : ''}
            </p>
          ) : (
            <ul className="space-y-2">
              {p.credentials.map((c) => (
                <CredentialRow
                  key={c.id}
                  provider={p}
                  credential={c}
                  canManage={canManage}
                  encryptionConfigured={encryptionConfigured}
                  verifying={props.verifyingId === c.id}
                  verifyResult={props.verifyResults?.[c.id] ?? null}
                  handlers={props.keyHandlers}
                />
              ))}
            </ul>
          )}
        </section>

        <section aria-label={`Модели ${p.name}`}>
          <SectionTitle action={canManage && <Button size="sm" variant="secondary" icon={<Plus size={12} />} onClick={() => props.onAddModel?.(p)}>Добавить модель</Button>}>
            Модели
          </SectionTitle>
          <ModelsTable
            provider={p}
            canManage={canManage}
            onEdit={(m) => props.onEditModel?.(p, m)}
            onDelete={(m) => props.onDeleteModel?.(p, m)}
          />
        </section>
      </div>
    </article>
  )
}

// ─── Routing ─────────────────────────────────────────────────────────────────

export const ROUTING_EXPLANATION =
  'Маршрут направляет возможность (для чата — уровень) на модель конкретного провайдера. Без маршрута, а также если модель или провайдер выключены или у них нет ключа, работает встроенный вариант: OpenRouter с моделью из env. Автоматического переключения на другого провайдера при ошибке нет.'

export function RoutingTable({ providers, routes, canManage, drafts, savingKey, onDraft, onSave }: {
  providers: readonly ProviderDto[]
  routes: readonly RouteDto[]
  canManage: boolean
  /** slotKey → selected model row id ('' = default); missing = current value. */
  drafts?: Record<string, string>
  savingKey?: string | null
  onDraft?: (slot: string, value: string) => void
  onSave?: (slot: string) => void
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-xs">
        <thead>
          <tr className="border-b border-white/[0.06] text-[10px] uppercase tracking-wider text-slate-500">
            <th scope="col" className="px-3 py-2.5 font-medium">Возможность</th>
            <th scope="col" className="px-3 py-2.5 font-medium">Модель</th>
            <th scope="col" className="px-3 py-2.5 font-medium">Если маршрута нет</th>
            <th scope="col" className="px-3 py-2.5 font-medium">Изменён</th>
            {canManage && <th scope="col" className="px-3 py-2.5"><span className="sr-only">Сохранить</span></th>}
          </tr>
        </thead>
        <tbody>
          {ROUTE_SLOTS.map((slot) => {
            const key = slotKey(slot.capability, slot.tier)
            const current = routeFor(routes, slot)
            const options = modelOptionsFor(providers, slot.capability)
            const value = drafts?.[key] ?? current?.modelRowId ?? ''
            const dirty = value !== (current?.modelRowId ?? '')
            const problem = routeProblem(current, providers)
            return (
              <tr key={key} className="border-b border-white/[0.04] align-top" data-testid="route-row">
                <td className="px-3 py-2.5">
                  <p className="text-slate-200">{slot.label}</p>
                  <p className="text-[10px] text-slate-600">{slot.hint}</p>
                </td>
                <td className="px-3 py-2.5">
                  {canManage ? (
                    <select
                      aria-label={`Модель для «${slot.label}»`}
                      value={value}
                      onChange={(e) => onDraft?.(key, e.target.value)}
                      className={cx(inputClass, 'bg-[#0b1128] py-1.5 text-xs')}
                    >
                      <option value="">по умолчанию (OpenRouter из env)</option>
                      {options.map((o) => (
                        <option key={o.value} value={o.value} disabled={o.disabled && o.value !== current?.modelRowId}>
                          {o.label}{o.reason ? ` — ${o.reason}` : ''}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className={cx('font-mono text-[11px]', current ? 'text-slate-200' : 'text-slate-500')}>
                      {current ? `${current.providerKey} · ${current.modelId}` : 'по умолчанию (OpenRouter из env)'}
                    </span>
                  )}
                  {options.length === 0 && <p className="mt-1 text-[10px] text-slate-600">Нет моделей с возможностью «{CAPABILITY_LABEL[slot.capability]}».</p>}
                  {problem && <p className="mt-1 flex items-center gap-1 text-[10px] text-amber-300"><ShieldAlert size={11} /> {problem}</p>}
                </td>
                <td className="px-3 py-2.5 text-[11px] text-slate-500">{slot.fallback}</td>
                <td className="px-3 py-2.5 text-[11px] text-slate-500">{current ? fmtDateTime(current.updatedAt) : '—'}</td>
                {canManage && (
                  <td className="px-3 py-2.5 text-right">
                    <Button size="sm" variant={dirty ? 'primary' : 'secondary'} disabled={!dirty} loading={savingKey === key} onClick={() => onSave?.(key)}>Сохранить</Button>
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── Budgets ─────────────────────────────────────────────────────────────────

export function BudgetsSummary({ budgets, canManage, onEdit }: { budgets: BudgetsDto; canManage: boolean; onEdit?: () => void }) {
  const spentByProviders = providersSpentToday(budgets)
  const level = (title: string, b: BudgetsDto['platform'], env: string, spent: number | null, note: string) => (
    <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-3" data-testid="budget-level">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-slate-200">{title}</p>
        <Badge tone={b.source === 'db' ? 'blue' : 'neutral'} title={b.source === 'env' ? `Значение из ${env}` : 'Задано в панели'}>источник: {SOURCE_LABEL[b.source]}</Badge>
      </div>
      <p className="mt-1 font-mono text-lg font-semibold tabular-nums text-slate-100">{fmtUsd(b.dailyUsd)}<span className="ml-1 text-[11px] font-normal text-slate-500">в сутки</span></p>
      {b.source === 'env' && <p className="text-[10px] text-slate-600">{env}</p>}
      {spent !== null && <div className="mt-2"><SpendBar label="Сегодня" spent={spent} budget={b.dailyUsd} /></div>}
      <p className="mt-2 text-[10px] text-slate-600">{note}</p>
    </div>
  )
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        {level('Платформа', budgets.platform, 'AGENT_PLATFORM_DAILY_BUDGET_USD', spentByProviders,
          'Сегодня — сумма расходов, у которых записан провайдер (с 00:00 по времени сервера БД).')}
        {level('Одна компания', budgets.company, 'AGENT_COMPANY_DAILY_BUDGET_USD', null,
          'Лимит на каждую компанию отдельно. Расходы по компаниям — во вкладке «Расходы».')}
      </div>
      <div>
        <SectionTitle>Провайдеры</SectionTitle>
        {budgets.providers.length === 0 ? (
          <p className="text-[11px] text-slate-500">Провайдеров нет.</p>
        ) : (
          <div className="grid gap-x-8 gap-y-3 md:grid-cols-2">
            {budgets.providers.map((p) => (
              <SpendBar key={p.key} label={<>{p.name} <span className="font-mono text-[10px] text-slate-600">{p.key}</span></>} spent={p.spentTodayUsd} budget={p.dailyBudgetUsd} />
            ))}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.05] pt-3">
        <p className="text-[11px] text-slate-500">
          {budgets.updatedAt && budgets.updatedBy ? <>Изменены {fmtDateTime(budgets.updatedAt)}{budgets.updatedBy ? <> · <span className="font-mono">{budgets.updatedBy}</span></> : null}</> : 'Бюджеты платформы и компании в панели не задавались — действуют значения из env.'}
        </p>
        {canManage ? <Button variant="primary" size="sm" icon={<Pencil size={12} />} onClick={onEdit}>Изменить бюджеты</Button> : <NoRightHint>Изменять бюджеты может только Super Admin.</NoRightHint>}
      </div>
    </div>
  )
}

// ─── Spend ───────────────────────────────────────────────────────────────────

export function SpendView({ groupBy, rows, totalUsd, providers }: {
  groupBy: SpendGroupBy
  rows: readonly SpendRowDto[]
  totalUsd: number
  providers: readonly Pick<ProviderDto, 'key' | 'name'>[]
}) {
  if (rows.length === 0) {
    return <EmptyState icon={<Coins size={18} />} title="Расходов за период нет" text="Когда функции платформы и агенты начнут вызывать модели, здесь появятся суммы." />
  }
  const label = (r: SpendRowDto) => spendKeyLabel(groupBy, r.key, providers)
  const cols: Column<SpendRowDto>[] = [
    { key: 'key', header: GROUP_LABEL[groupBy], render: (r) => <span className={cx(groupBy === 'provider' || groupBy === 'feature' ? 'text-slate-200' : 'font-mono text-[11px] text-slate-200', r.key === null && 'text-slate-500')}>{label(r)}</span> },
    { key: 'calls', header: 'Вызовов', className: 'text-right', render: (r) => <span className="font-mono tabular-nums">{r.calls.toLocaleString('ru-RU')}</span> },
    { key: 'tokens', header: 'Токены вх / вых', className: 'text-right', render: (r) => <span className="font-mono tabular-nums">{fmtTokens(r.tokensIn)} / {fmtTokens(r.tokensOut)}</span> },
    { key: 'cost', header: 'Стоимость', className: 'text-right', render: (r) => <span className="font-mono tabular-nums text-slate-100">{fmtUsd(r.costUsd)}</span> },
    { key: 'share', header: 'Доля', className: 'text-right', render: (r) => <span className="font-mono tabular-nums">{shareOf(r.costUsd, totalUsd)}</span> },
  ]
  return (
    <div className="space-y-4">
      <div className="px-4 pt-4">
        <BarList
          items={rows.slice(0, 10).map((r, i) => ({ key: `${r.key ?? 'null'}-${i}`, label: label(r), value: r.costUsd }))}
          format={(n) => fmtUsd(n)}
        />
      </div>
      <DataTable columns={cols} rows={[...rows]} rowKey={(r) => r.key ?? '∅'} />
    </div>
  )
}
