'use client'

/**
 * «MCP-доступ» — personal access tokens and OAuth sign-ins of the current
 * staff member / expert (API: /api/mcp/tokens). A new token is shown ONCE,
 * with a copy button and the ready `claude mcp add` command.
 */
import { useState } from 'react'
import { Check, Copy, KeyRound, Plug, Plus, ShieldAlert, Trash2 } from 'lucide-react'
import {
  Badge, Button, ConfirmDialog, DataTable, EmptyState, ErrorState, Field, GigaApiError, gigaFetch, inputClass, Modal,
  PageHeader, Panel, fmtAgo, fmtDate, useGigaQuery, type Column,
} from '../kit'

interface PatItem {
  id: string
  name: string
  prefix: string
  scopes: string[]
  createdVia: string
  expiresAt: string
  revokedAt: string | null
  lastUsedAt: string | null
  createdAt: string
}
interface OAuthItem { familyId: string; clientId: string; clientName: string | null; scopes: string[]; createdAt: string; lastUsedAt: string | null; refreshExpiresAt: string | null }
interface ScopeItem { scope: string; label: string; description: string }
interface TokensResponse {
  ok: true
  items: PatItem[]
  oauth: OAuthItem[]
  allowedScopes: ScopeItem[]
  expiryDays: number[]
  canCreate: boolean
  mcpUrl: string
}

const SERVER_NAME = 'aistart360'

function headerCommand(url: string, token: string): string {
  return `claude mcp add --transport http ${SERVER_NAME} ${url} --header "Authorization: Bearer ${token}"`
}

function CopyButton({ value, label = 'Копировать' }: { value: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <Button
      size="sm"
      icon={done ? <Check size={12} /> : <Copy size={12} />}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setDone(true)
          setTimeout(() => setDone(false), 1500)
        } catch {
          setDone(false)
        }
      }}
    >
      {done ? 'Скопировано' : label}
    </Button>
  )
}

function Code({ children }: { children: string }) {
  return <code className="block overflow-x-auto whitespace-pre rounded-xl border border-white/[0.08] bg-black/30 px-3 py-2 font-mono text-[11px] text-slate-200">{children}</code>
}

function status(t: PatItem): { label: string; tone: 'green' | 'red' | 'neutral' } {
  if (t.revokedAt) return { label: 'Отозван', tone: 'red' }
  if (new Date(t.expiresAt).getTime() <= Date.now()) return { label: 'Истёк', tone: 'neutral' }
  return { label: 'Активен', tone: 'green' }
}

export function McpTokensPage() {
  const q = useGigaQuery<TokensResponse>('/api/mcp/tokens')
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<string[]>([])
  const [days, setDays] = useState(30)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [issued, setIssued] = useState<{ token: string; name: string } | null>(null)
  const [revoke, setRevoke] = useState<{ id: string; label: string; kind: 'pat' | 'oauth' } | null>(null)
  const [revokeBusy, setRevokeBusy] = useState(false)
  const [actionError, setActionError] = useState<GigaApiError | null>(null)

  const data = q.data
  const labelOf = (s: string) => data?.allowedScopes.find((x) => x.scope === s)?.label ?? s

  const openCreate = () => {
    setName('')
    setScopes((data?.allowedScopes ?? []).filter((s) => s.scope !== 'clients:pii').map((s) => s.scope))
    setDays(30)
    setFormError(null)
    setCreating(true)
  }

  const submit = async () => {
    setBusy(true)
    setFormError(null)
    try {
      const r = await gigaFetch<{ token: string; item: PatItem }>('/api/mcp/tokens', { method: 'POST', json: { name, scopes, expires_in_days: days } })
      setCreating(false)
      setIssued({ token: r.token, name: r.item.name })
      void q.reload()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Не удалось создать токен')
    } finally {
      setBusy(false)
    }
  }

  const doRevoke = async () => {
    if (!revoke) return
    setRevokeBusy(true)
    setActionError(null)
    try {
      await gigaFetch(`/api/mcp/tokens/${encodeURIComponent(revoke.id)}${revoke.kind === 'oauth' ? '?kind=oauth' : ''}`, { method: 'DELETE' })
      setRevoke(null)
      void q.reload()
    } catch (e) {
      setActionError(e instanceof GigaApiError ? e : new GigaApiError(String(e), 0))
    } finally {
      setRevokeBusy(false)
    }
  }

  const columns: Column<PatItem>[] = [
    { key: 'name', header: 'Название', render: (t) => <div><p className="font-medium text-slate-200">{t.name}</p><p className="font-mono text-[10px] text-slate-500">{t.prefix}…</p></div> },
    { key: 'scopes', header: 'Права', render: (t) => <div className="flex max-w-[320px] flex-wrap gap-1">{t.scopes.map((s) => <Badge key={s} tone={s === 'clients:pii' ? 'amber' : 'blue'} title={s}>{labelOf(s)}</Badge>)}</div> },
    { key: 'expires', header: 'Действует до', render: (t) => fmtDate(t.expiresAt) },
    { key: 'used', header: 'Использован', render: (t) => (t.lastUsedAt ? fmtAgo(t.lastUsedAt) : '—') },
    { key: 'status', header: 'Статус', render: (t) => { const s = status(t); return <Badge tone={s.tone}>{s.label}</Badge> } },
    {
      key: 'actions', header: '', className: 'text-right',
      render: (t) => status(t).label === 'Активен'
        ? <Button size="sm" variant="danger" icon={<Trash2 size={12} />} onClick={() => setRevoke({ id: t.id, label: t.name, kind: 'pat' })}>Отозвать</Button>
        : null,
    },
  ]

  const oauthColumns: Column<OAuthItem>[] = [
    { key: 'client', header: 'Приложение', render: (g) => <span className="text-slate-200">{g.clientName ?? 'Без названия'}</span> },
    { key: 'scopes', header: 'Права', render: (g) => <div className="flex max-w-[320px] flex-wrap gap-1">{g.scopes.map((s) => <Badge key={s} tone={s === 'clients:pii' ? 'amber' : 'blue'} title={s}>{labelOf(s)}</Badge>)}</div> },
    { key: 'since', header: 'Подключено', render: (g) => fmtDate(g.createdAt) },
    { key: 'used', header: 'Использовано', render: (g) => (g.lastUsedAt ? fmtAgo(g.lastUsedAt) : '—') },
    { key: 'actions', header: '', className: 'text-right', render: (g) => <Button size="sm" variant="danger" icon={<Trash2 size={12} />} onClick={() => setRevoke({ id: g.familyId, label: g.clientName ?? 'приложение', kind: 'oauth' })}>Отключить</Button> },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        title="MCP-доступ"
        description="Подключение Claude Code, Claude Desktop и других MCP-клиентов к данным платформы — только чтение, по правам вашей роли."
        actions={data?.canCreate ? <Button variant="primary" icon={<Plus size={14} />} onClick={openCreate}>Новый токен</Button> : undefined}
      />
      <ErrorState error={q.error} onRetry={q.reload} />
      <ErrorState error={actionError} />

      {data && (
        <Panel title="Как подключить" description="Адрес MCP-сервера и команды для Claude Code">
          <div className="space-y-3 text-xs text-slate-400">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-slate-500">Адрес:</span>
              <code className="font-mono text-slate-200">{data.mcpUrl}</code>
              <CopyButton value={data.mcpUrl} />
            </div>
            <p><b className="text-slate-300">Вход через браузер (OAuth, рекомендуется).</b> Токен не нужен: Claude Code откроет страницу входа, вы подтвердите доступ (с 2FA), токены обновляются сами.</p>
            <Code>{`claude mcp add --transport http ${SERVER_NAME} ${data.mcpUrl}`}</Code>
            <p>Затем в Claude Code выполните <code className="text-slate-200">/mcp</code> и выберите «Authenticate» (или <code className="text-slate-200">claude mcp login {SERVER_NAME}</code>).</p>
            <p><b className="text-slate-300">Личный токен.</b> Создайте токен кнопкой «Новый токен» и передайте его в заголовке:</p>
            <Code>{headerCommand(data.mcpUrl, '<токен>')}</Code>
          </div>
        </Panel>
      )}

      <Panel title="Личные токены" description="Токен показывается один раз. Права проверяются при каждом запросе по вашей текущей роли.">
        {data && data.allowedScopes.length === 0 && (
          <EmptyState icon={<ShieldAlert size={18} />} title="Ваша роль не даёт доступа к данным через MCP" text="MCP открывает клиентов, диагностику, метрики, отчёты, задачи агентов и расходы — нужна роль с этими правами." />
        )}
        {(!data || data.allowedScopes.length > 0) && (
          <DataTable
            columns={columns}
            rows={data?.items}
            rowKey={(t) => t.id}
            loading={q.loading}
            skeletonRows={3}
            empty={<EmptyState icon={<KeyRound size={18} />} title="Токенов нет" text="Создайте токен, чтобы подключить MCP-клиент по заголовку Authorization." />}
          />
        )}
      </Panel>

      <Panel title="Подключённые приложения (OAuth)" description="Входы через браузер. Отключение отзывает все токены этого входа.">
        <DataTable
          columns={oauthColumns}
          rows={data?.oauth}
          rowKey={(g) => g.familyId}
          loading={q.loading}
          skeletonRows={2}
          empty={<EmptyState icon={<Plug size={18} />} title="Подключений нет" />}
        />
      </Panel>

      <Modal
        open={creating}
        onClose={() => (busy ? undefined : setCreating(false))}
        title="Новый токен MCP"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreating(false)} disabled={busy}>Отмена</Button>
            <Button variant="primary" onClick={submit} loading={busy} disabled={!name.trim() || scopes.length === 0}>Создать</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Название" hint="Например: «Claude Code — ноутбук»">
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className={inputClass} autoFocus />
          </Field>
          <fieldset>
            <legend className="mb-1 text-[11px] font-medium text-slate-400">Права (только из прав вашей роли)</legend>
            <div className="space-y-2">
              {(data?.allowedScopes ?? []).map((s) => (
                <label key={s.scope} className="flex cursor-pointer items-start gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-2.5">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={scopes.includes(s.scope)}
                    onChange={(e) => setScopes((prev) => (e.target.checked ? [...prev, s.scope] : prev.filter((x) => x !== s.scope)))}
                  />
                  <span>
                    <span className="block text-xs text-slate-200">{s.label}</span>
                    <span className="block text-[10px] text-slate-500">{s.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <Field label="Срок действия">
            <select value={days} onChange={(e) => setDays(Number(e.target.value))} className={inputClass}>
              {(data?.expiryDays ?? [30]).map((d) => <option key={d} value={d}>{d} дней</option>)}
            </select>
          </Field>
          {formError && <p role="alert" className="text-xs text-red-300">{formError}</p>}
        </div>
      </Modal>

      <Modal open={!!issued} onClose={() => setIssued(null)} title="Токен создан" wide footer={<Button variant="primary" onClick={() => setIssued(null)}>Я сохранил токен</Button>}>
        {issued && data && (
          <div className="space-y-3 text-xs text-slate-400">
            <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-amber-200">
              Скопируйте токен «{issued.name}» сейчас — он показывается один раз и не хранится в открытом виде. Не пересылайте его в чатах.
            </p>
            <div className="flex items-center gap-2">
              <Code>{issued.token}</Code>
              <CopyButton value={issued.token} />
            </div>
            <p>Команда для Claude Code:</p>
            <div className="flex items-start gap-2">
              <Code>{headerCommand(data.mcpUrl, issued.token)}</Code>
              <CopyButton value={headerCommand(data.mcpUrl, issued.token)} />
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!revoke}
        onClose={() => setRevoke(null)}
        onConfirm={doRevoke}
        loading={revokeBusy}
        title={revoke?.kind === 'oauth' ? 'Отключить приложение?' : 'Отозвать токен?'}
        text={revoke ? `«${revoke.label}» сразу перестанет работать. Это действие нельзя отменить.` : undefined}
        confirmLabel={revoke?.kind === 'oauth' ? 'Отключить' : 'Отозвать'}
      />
    </div>
  )
}
