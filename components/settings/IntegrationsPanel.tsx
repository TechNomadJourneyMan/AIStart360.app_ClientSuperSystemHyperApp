'use client'

/**
 * Settings › Интеграции.
 *
 *   CRM          Bitrix24 / amoCRM through /api/v1/crm/connections (the old
 *                /api/crm Prisma routes always answered «No organization»).
 *   E-commerce   /api/integrations: marketplaces, accounting, analytics, shop
 *                platforms, ads. Live providers: key form → the server checks
 *                the key with the provider before storing it encrypted;
 *                «Проверить», «Отключить». Providers without a live adapter
 *                are honest: «Загрузка выгрузок» + why (BLOCKED) + which
 *                export to upload in Файлы.
 *   Channels     the remaining notification channels (WhatsApp «Скоро» stays).
 *
 * Keys are never shown back: the API returns no credential, only the account
 * label and the status.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'

// ── Types of /api/integrations ─────────────────────────────────────────────
interface CatalogField { name: string; label: string; target: 'secret' | 'setting'; input: 'password' | 'text' | 'textarea'; placeholder?: string; help?: string; maxLength: number }
interface CatalogItem {
  key: string
  label: string
  category: string
  categoryLabel: string
  mode: 'live' | 'file'
  fields: CatalogField[]
  docs: string[]
  keySource: string
  verifiedLive: boolean
  blocked: { reason: string; requiredInput: string; howToUnblock: string } | null
  exportHint: string
}
interface Connection {
  id: string
  provider: string
  status: 'connected' | 'error' | 'disconnected' | 'needs_reauth'
  authKind: string
  accountLabel: string | null
  lastSyncAt: string | null
  lastError: string | null
  errorCount: number
  filledTo: string | null
}
interface IntegrationsData { catalog: CatalogItem[]; connections: Connection[]; canManage: boolean; encryptionReady: boolean; migrationPending?: boolean }

// ── CRM (/api/v1/crm/connections) ──────────────────────────────────────────
interface CrmConnection { id: string; provider: string; base_url: string; is_active: boolean; last_sync_status: string | null; synced_deals: number | null; synced_contacts: number | null }

const STATUS: Record<string, { label: string; cls: string }> = {
  connected:    { label: 'Подключено',          cls: 'text-primary bg-primary/10 border-primary/20' },
  error:        { label: 'Ошибки синхронизации', cls: 'text-error bg-error/10 border-error/20' },
  needs_reauth: { label: 'Нужен новый ключ',    cls: 'text-error bg-error/10 border-error/20' },
  disconnected: { label: 'Отключено',           cls: 'text-on-surface-variant bg-surface-container-high border-outline-variant/30' },
  file:         { label: 'Загрузка выгрузок',   cls: 'text-tertiary-container bg-tertiary-container/10 border-tertiary-container/20' },
  available:    { label: 'Доступно',            cls: 'text-secondary bg-secondary/10 border-secondary/20' },
  coming:       { label: 'Скоро',               cls: 'text-on-surface-variant bg-surface-container-high border-outline-variant/30' },
}

function StatusBadge({ status }: { status: string }) {
  const b = STATUS[status] ?? STATUS.coming
  return <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border shrink-0 ${b.cls}`}>{b.label}</span>
}

function fmt(iso: string | null): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
}

async function json<T>(res: Response): Promise<T & { ok?: boolean; error?: string }> {
  return (await res.json().catch(() => ({}))) as T & { ok?: boolean; error?: string }
}

const inputCls = 'w-full bg-surface-container border border-outline-variant/30 rounded-lg px-3 py-2 text-xs text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:border-primary/50'
const btn = 'text-xs px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50'

export function IntegrationsPanel() {
  return (
    <>
      <EcommerceIntegrations />
      <CrmIntegrations />
      <ChannelsCard />
    </>
  )
}

// ── E-commerce ─────────────────────────────────────────────────────────────

function EcommerceIntegrations() {
  const [data, setData] = useState<IntegrationsData | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'no_company'>('loading')
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/integrations', { credentials: 'include', cache: 'no-store' })
      const body = await json<{ data?: IntegrationsData; code?: string }>(res)
      if (res.status === 404 || body.code === 'no_company') { setState('no_company'); return }
      if (!res.ok || !body.data) throw new Error(body.error ?? 'load failed')
      setData(body.data)
      setState('ready')
    } catch {
      setState('error')
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const byCategory = useMemo(() => {
    const groups = new Map<string, CatalogItem[]>()
    for (const item of data?.catalog ?? []) {
      const list = groups.get(item.categoryLabel) ?? []
      list.push(item)
      groups.set(item.categoryLabel, list)
    }
    return [...groups.entries()]
  }, [data])

  const connectionOf = (key: string) => data?.connections.find((c) => c.provider === key) ?? null

  const run = async (key: string, action: () => Promise<Response>, success: string) => {
    setBusy(key)
    try {
      const res = await action()
      const body = await json<Record<string, unknown>>(res)
      if (!res.ok) throw new Error(body.error ?? 'Не удалось выполнить действие')
      toast.success(success)
      setOpen(null)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось выполнить действие')
      await load()
    } finally {
      setBusy(null)
    }
  }

  const connect = (item: CatalogItem, fields: Record<string, string>) => run(
    item.key,
    () => fetch('/api/integrations', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: item.key, fields }),
    }),
    item.mode === 'live' ? `${item.label}: ключ проверен и сохранён. Данные появятся после первой синхронизации.` : `${item.label}: отмечено — загружайте выгрузки в «Файлы».`,
  )
  const test = (item: CatalogItem) => run(item.key, () => fetch(`/api/integrations/${item.key}/test`, { method: 'POST', credentials: 'include' }), `${item.label}: ключ работает`)
  const disconnect = (item: CatalogItem) => {
    if (!confirm(`Отключить ${item.label}? Сохранённый ключ будет удалён.`)) return
    void run(item.key, () => fetch(`/api/integrations/${item.key}`, { method: 'DELETE', credentials: 'include' }), `${item.label} отключено, ключ удалён`)
  }

  return (
    <Card title="Магазин, маркетплейсы и аналитика" subtitle="Заказы, выручка, возвраты, остатки и трафик — в кабинет e-commerce и метрики. Ключи хранятся только в зашифрованном виде.">
      {state === 'loading' && <div className="h-24 bg-surface-container-high rounded-xl animate-pulse" />}
      {state === 'error' && <p className="text-sm text-error">Не удалось загрузить интеграции. Обновите страницу.</p>}
      {state === 'no_company' && (
        <p className="text-sm text-on-surface-variant">Интеграции подключаются к компании. Заполните анкету (шаг «Компания»), чтобы создать её.</p>
      )}
      {state === 'ready' && data && (
        <div className="space-y-5">
          {data.migrationPending && (
            <p className="text-xs text-on-surface-variant bg-surface-container-high rounded-lg px-3 py-2">
              Подключение интеграций ещё не включено на сервере. Список сервисов — ниже; подключить их можно будет после обновления платформы.
            </p>
          )}
          {!data.encryptionReady && (
            <p className="text-xs text-error bg-error/10 border border-error/20 rounded-lg px-3 py-2">
              Хранилище ключей на сервере не настроено — подключение по ключу временно недоступно. Сообщите администратору.
            </p>
          )}
          {!data.canManage && (
            <p className="text-xs text-on-surface-variant bg-surface-container-high rounded-lg px-3 py-2">
              Подключать и отключать интеграции может владелец или администратор компании.
            </p>
          )}
          {byCategory.map(([category, items]) => (
            <div key={category}>
              <p className="text-[10px] font-mono uppercase tracking-wider text-on-surface-variant mb-2">{category}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {items.map((item) => (
                  <ProviderCard
                    key={item.key}
                    item={item}
                    conn={connectionOf(item.key)}
                    canManage={data.canManage && !data.migrationPending}
                    encryptionReady={data.encryptionReady}
                    open={open === item.key}
                    busy={busy === item.key}
                    onOpen={() => setOpen(open === item.key ? null : item.key)}
                    onConnect={(f) => connect(item, f)}
                    onTest={() => test(item)}
                    onDisconnect={() => disconnect(item)}
                  />
                ))}
              </div>
            </div>
          ))}
          <p className="text-[11px] text-on-surface-variant/70">
            Живые подключения пока не проверены на реальных кабинетах продавцов — первые синхронизации сверяйте с кабинетом.
            Выгрузки (CSV/XLSX) загружаются в разделе <Link href="/client/onboarding/documents" className="text-primary hover:underline">Файлы</Link>.
          </p>
        </div>
      )}
    </Card>
  )
}

function ProviderCard({ item, conn, canManage, encryptionReady, open, busy, onOpen, onConnect, onTest, onDisconnect }: {
  item: CatalogItem
  conn: Connection | null
  canManage: boolean
  encryptionReady: boolean
  open: boolean
  busy: boolean
  onOpen: () => void
  onConnect: (fields: Record<string, string>) => void
  onTest: () => void
  onDisconnect: () => void
}) {
  const [fields, setFields] = useState<Record<string, string>>({})
  const active = conn && conn.status !== 'disconnected'
  const status = !active ? (item.mode === 'file' ? 'file' : 'available') : conn.authKind === 'file' ? 'file' : conn.status
  const live = item.mode === 'live'

  return (
    <div className="bg-surface-container-high rounded-xl p-4 border border-white/[0.04]">
      <div className="flex items-start justify-between gap-2 mb-1">
        <div>
          <p className="text-sm font-semibold text-on-surface">{item.label}</p>
          <p className="text-[11px] text-on-surface-variant">
            {active && conn.accountLabel ? conn.accountLabel : live ? 'Подключение по ключу API' : 'Только выгрузки (CSV/XLSX)'}
          </p>
        </div>
        <StatusBadge status={status} />
      </div>

      {active && live && conn.authKind !== 'file' && (
        <div className="text-[11px] text-on-surface-variant space-y-0.5 mt-2">
          <p>Последняя синхронизация: {fmt(conn.lastSyncAt)}{conn.filledTo ? ` · данные по ${conn.filledTo}` : ''}</p>
          {conn.lastError && <p className="text-error">{conn.lastError}</p>}
          {conn.status === 'needs_reauth' && <p className="text-error">Ключ больше не принимается — подключите заново с новым ключом.</p>}
        </div>
      )}

      {!live && item.blocked && (
        <details className="mt-2 text-[11px] text-on-surface-variant">
          <summary className="cursor-pointer hover:text-on-surface">Почему нет живого подключения</summary>
          <p className="mt-1">{item.blocked.reason}</p>
          <p className="mt-1"><span className="text-on-surface">Что загрузить:</span> {item.exportHint}</p>
        </details>
      )}

      {canManage && (
        <div className="mt-3 flex flex-wrap gap-2">
          {live && active && conn.authKind !== 'file' && (
            <button type="button" disabled={busy} onClick={onTest} className={`${btn} bg-primary/10 border border-primary/20 text-primary hover:bg-primary/15`}>{busy ? 'Проверка…' : 'Проверить'}</button>
          )}
          {live && (!active || conn.status === 'needs_reauth') && (
            <button type="button" disabled={busy || !encryptionReady} onClick={onOpen} className={`${btn} border border-outline-variant/30 text-on-surface-variant hover:text-on-surface hover:border-primary/30`}>
              {active ? 'Переподключить' : 'Подключить'}
            </button>
          )}
          {!live && !active && (
            <button type="button" disabled={busy} onClick={() => onConnect({})} className={`${btn} border border-outline-variant/30 text-on-surface-variant hover:text-on-surface hover:border-primary/30`}>Я продаю здесь — загружу выгрузки</button>
          )}
          {active && (
            <button type="button" disabled={busy} onClick={onDisconnect} className={`${btn} border border-error/30 text-error hover:bg-error/10`}>Отключить</button>
          )}
        </div>
      )}

      {open && live && (
        <form
          className="mt-3 space-y-2"
          onSubmit={(e) => { e.preventDefault(); onConnect(fields) }}
        >
          <p className="text-[11px] text-on-surface-variant">{item.keySource}</p>
          {item.fields.map((f) => (
            <label key={f.name} className="block">
              <span className="block text-[11px] text-on-surface mb-1">{f.label}</span>
              {f.input === 'textarea' ? (
                <textarea
                  value={fields[f.name] ?? ''}
                  onChange={(e) => setFields((s) => ({ ...s, [f.name]: e.target.value }))}
                  placeholder={f.placeholder}
                  maxLength={f.maxLength}
                  rows={4}
                  autoComplete="off"
                  spellCheck={false}
                  className={`${inputCls} font-mono`}
                />
              ) : (
                <input
                  type={f.input === 'password' ? 'password' : 'text'}
                  value={fields[f.name] ?? ''}
                  onChange={(e) => setFields((s) => ({ ...s, [f.name]: e.target.value }))}
                  placeholder={f.placeholder}
                  maxLength={f.maxLength}
                  autoComplete="off"
                  spellCheck={false}
                  className={inputCls}
                />
              )}
              {f.help && <span className="block text-[10px] text-on-surface-variant/70 mt-1">{f.help}</span>}
            </label>
          ))}
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className={`${btn} bg-primary text-on-primary hover:bg-primary/90`}>{busy ? 'Проверяем ключ…' : 'Проверить и подключить'}</button>
            <button type="button" onClick={onOpen} className={`${btn} text-on-surface-variant hover:text-on-surface`}>Отмена</button>
          </div>
        </form>
      )}
    </div>
  )
}

// ── CRM ────────────────────────────────────────────────────────────────────

// Same payload as the Pulse page: Bitrix24 — the incoming webhook URL is the
// token (provider-client recognises webhook mode) and its host is base_url;
// amoCRM — domain + long-lived token.
const CRM_PROVIDERS = [
  { key: 'bitrix24', name: 'Bitrix24', placeholder: 'https://b24-xxx.bitrix24.kz/rest/1/ваш_секрет/', domainPlaceholder: null },
  { key: 'amocrm', name: 'amoCRM', placeholder: 'Долгосрочный токен', domainPlaceholder: 'mycompany.amocrm.ru' },
] as const

function crmPayload(provider: 'bitrix24' | 'amocrm', form: { baseUrl: string; token: string }) {
  return provider === 'bitrix24'
    ? { provider, base_url: form.token.replace(/^https?:\/\//, '').split('/')[0], access_token: form.token }
    : { provider, base_url: form.baseUrl, access_token: form.token }
}

function CrmIntegrations() {
  const [rows, setRows] = useState<CrmConnection[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [form, setForm] = useState({ baseUrl: '', token: '' })
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/v1/crm/connections', { credentials: 'include', cache: 'no-store' })
      const body = await json<{ data?: CrmConnection[] }>(res)
      if (!res.ok) throw new Error(body.error)
      setRows(Array.isArray(body.data) ? body.data : [])
      setFailed(false)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const act = async (fn: () => Promise<Response>, ok: string) => {
    setBusy(true)
    try {
      const res = await fn()
      const body = await json<Record<string, unknown>>(res)
      if (!res.ok) throw new Error(body.error ?? 'Не удалось выполнить действие')
      toast.success(ok)
      setOpen(null)
      setForm({ baseUrl: '', token: '' })
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось выполнить действие')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="CRM" subtitle="Сделки и контакты из Bitrix24 / amoCRM — для пульса продаж, дайджеста и рекомендаций.">
      {loading ? <div className="h-24 bg-surface-container-high rounded-xl animate-pulse" /> : failed ? (
        <p className="text-sm text-error">Не удалось загрузить подключения CRM.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {CRM_PROVIDERS.map((p) => {
            const conn = rows.find((r) => r.provider === p.key && r.is_active)
            return (
              <div key={p.key} className="bg-surface-container-high rounded-xl p-4 border border-white/[0.04]">
                <div className="flex items-start justify-between mb-2">
                  <p className="text-sm font-semibold text-on-surface">{p.name}</p>
                  <StatusBadge status={conn ? (conn.last_sync_status === 'error' ? 'error' : 'connected') : 'available'} />
                </div>
                {conn ? (
                  <>
                    <p className="text-[11px] text-on-surface-variant mb-2">
                      {conn.base_url} · сделок: {conn.synced_deals ?? 0} · контактов: {conn.synced_contacts ?? 0}
                    </p>
                    <div className="flex gap-2">
                      <button type="button" disabled={busy} onClick={() => act(() => fetch(`/api/v1/crm/connections/${conn.id}/sync`, { method: 'POST', credentials: 'include' }), 'Синхронизация выполнена')} className={`${btn} bg-primary/10 border border-primary/20 text-primary hover:bg-primary/15`}>Синхронизировать</button>
                      <button type="button" disabled={busy} onClick={() => { if (confirm(`Отключить ${p.name}?`)) void act(() => fetch(`/api/v1/crm/connections/${conn.id}`, { method: 'DELETE', credentials: 'include' }), 'CRM отключена') }} className={`${btn} border border-error/30 text-error hover:bg-error/10`}>Отключить</button>
                    </div>
                  </>
                ) : open === p.key ? (
                  <form className="space-y-2" onSubmit={(e) => {
                    e.preventDefault()
                    void act(() => fetch('/api/v1/crm/connections', {
                      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(crmPayload(p.key, form)),
                    }), `${p.name} подключена`)
                  }}>
                    {p.domainPlaceholder && (
                      <input value={form.baseUrl} onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))} placeholder={p.domainPlaceholder} className={inputCls} />
                    )}
                    <input type="password" value={form.token} onChange={(e) => setForm((f) => ({ ...f, token: e.target.value }))} placeholder={p.placeholder} autoComplete="off" className={inputCls} />
                    <div className="flex gap-2">
                      <button type="submit" disabled={busy || !form.token || (p.domainPlaceholder !== null && !form.baseUrl)} className={`${btn} bg-primary text-on-primary hover:bg-primary/90`}>{busy ? 'Проверка…' : 'Подключить'}</button>
                      <button type="button" onClick={() => setOpen(null)} className={`${btn} text-on-surface-variant hover:text-on-surface`}>Отмена</button>
                    </div>
                  </form>
                ) : (
                  <button type="button" onClick={() => { setOpen(p.key); setForm({ baseUrl: '', token: '' }) }} className={`${btn} border border-outline-variant/30 text-on-surface-variant hover:text-on-surface hover:border-primary/30`}>Подключить</button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}

// ── Channels (no live integration yet) ─────────────────────────────────────

const CHANNELS = [
  { id: 'whatsapp', name: 'WhatsApp', desc: 'Уведомления в WhatsApp' },
  { id: 'sheets', name: 'Google Sheets', desc: 'Экспорт метрик и базы клиентов' },
  { id: 'notion', name: 'Notion', desc: 'Синхронизация заметок и отчётов' },
  { id: 'slack', name: 'Slack', desc: 'Алерты в рабочий канал' },
  { id: 'webhooks', name: 'Webhooks', desc: 'Исходящие вебхуки на события' },
] as const

function ChannelsCard() {
  return (
    <Card title="Каналы и сервисы" subtitle="В разработке — подключение появится здесь.">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {CHANNELS.map((c) => (
          <div key={c.id} className="bg-surface-container-high rounded-xl p-4 border border-white/[0.04] flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-on-surface">{c.name}</p>
              <p className="text-xs text-on-surface-variant">{c.desc}</p>
            </div>
            <StatusBadge status="coming" />
          </div>
        ))}
      </div>
    </Card>
  )
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface-container rounded-xl p-6">
      <div className="mb-5">
        <h3 className="font-headline text-lg font-bold text-on-surface">{title}</h3>
        {subtitle && <p className="text-sm text-on-surface-variant mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  )
}
