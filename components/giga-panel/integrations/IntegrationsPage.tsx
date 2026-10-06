'use client'

/**
 * GIGA › Интеграции — e-commerce integrations of every client company (W7).
 *
 *   list     /api/giga-admin/integrations (users.view): status, last sync,
 *            sanitised error, never a key.
 *   actions  company.edit (audited on the server): connect for a client
 *            (key form, checked with the provider before it is stored
 *            encrypted), «Проверить», «Синхронизировать», «Отключить».
 *   catalog  which providers are live (не проверено вживую) and which are
 *            BLOCKED with the reason, what is needed and how to unblock.
 */
import { useMemo, useState } from 'react'
import { AlertTriangle, Plug, Plus, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react'
import {
  Badge, Button, ConfirmDialog, DataTable, EmptyState, ErrorState, Field, GigaApiError, gigaFetch, inputClass, Modal,
  PageHeader, Panel, fmtAgo, useDebounced, useGigaQuery, type Column, type Tone,
} from '../kit'

interface CatalogField { name: string; label: string; target: 'secret' | 'setting'; input: 'password' | 'text' | 'textarea'; placeholder?: string; help?: string; maxLength: number }
interface CatalogItem {
  key: string
  label: string
  categoryLabel: string
  mode: 'live' | 'file'
  fields: CatalogField[]
  docs: string[]
  keySource: string
  verifiedLive: boolean
  blocked: { reason: string; requiredInput: string; howToUnblock: string } | null
  exportHint: string
}
interface Item {
  id: string
  companyId: string
  companyName: string | null
  provider: string
  status: 'connected' | 'error' | 'disconnected' | 'needs_reauth'
  authKind: string
  accountLabel: string | null
  lastSyncAt: string | null
  nextSyncAt: string | null
  lastError: string | null
  errorCount: number
  filledTo: string | null
}
interface ListResponse { ok: true; data: { items: Item[]; catalog: CatalogItem[]; encryptionReady: boolean; canEdit: boolean } }
interface CompaniesResponse { ok: true; data: { items: Array<{ id: string; name: string | null }> } }

const STATUS: Record<Item['status'] | 'file', { label: string; tone: Tone }> = {
  connected: { label: 'Подключено', tone: 'green' },
  error: { label: 'Ошибки', tone: 'red' },
  needs_reauth: { label: 'Нужен новый ключ', tone: 'red' },
  disconnected: { label: 'Отключено', tone: 'neutral' },
  file: { label: 'Выгрузки', tone: 'amber' },
}

export function IntegrationsPage() {
  const q = useGigaQuery<ListResponse>('/api/giga-admin/integrations')
  const data = q.data?.data
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<GigaApiError | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [removing, setRemoving] = useState<Item | null>(null)
  const [connecting, setConnecting] = useState(false)

  const label = (key: string) => data?.catalog.find((c) => c.key === key)?.label ?? key

  const act = async (row: Item, kind: 'test' | 'sync') => {
    setBusy(`${row.id}:${kind}`)
    setActionError(null)
    setNotice(null)
    try {
      const path = `/api/giga-admin/integrations/${encodeURIComponent(row.companyId)}/${row.provider}/${kind}`
      const r = await gigaFetch<{ data: { status?: string; factsWritten?: number; message?: string | null; metricsWritten?: number | null; accountLabel?: string | null } }>(path, { method: 'POST' })
      setNotice(kind === 'test'
        ? `${label(row.provider)}: ключ работает${r.data.accountLabel ? ` (${r.data.accountLabel})` : ''}`
        : `${label(row.provider)}: ${r.data.status === 'synced' ? `записано фактов ${r.data.factsWritten ?? 0}${r.data.metricsWritten != null ? `, метрик ${r.data.metricsWritten}` : ''}` : r.data.message ?? r.data.status}`)
    } catch (e) {
      setActionError(e instanceof GigaApiError ? e : new GigaApiError(String(e), 0))
    } finally {
      setBusy(null)
      void q.reload()
    }
  }

  const remove = async () => {
    if (!removing) return
    setBusy(`${removing.id}:delete`)
    setActionError(null)
    try {
      await gigaFetch(`/api/giga-admin/integrations/${encodeURIComponent(removing.companyId)}/${removing.provider}`, { method: 'DELETE' })
      setRemoving(null)
      void q.reload()
    } catch (e) {
      setActionError(e instanceof GigaApiError ? e : new GigaApiError(String(e), 0))
    } finally {
      setBusy(null)
    }
  }

  const columns: Column<Item>[] = [
    { key: 'company', header: 'Компания', render: (r) => <div><p className="text-slate-200">{r.companyName ?? '—'}</p><p className="font-mono text-[10px] text-slate-500">{r.companyId}</p></div> },
    { key: 'provider', header: 'Сервис', render: (r) => <div><p className="text-slate-200">{label(r.provider)}</p><p className="text-[10px] text-slate-500">{r.accountLabel ?? ''}</p></div> },
    { key: 'status', header: 'Статус', render: (r) => { const s = STATUS[r.authKind === 'file' ? 'file' : r.status]; return <Badge tone={s.tone}>{s.label}</Badge> } },
    { key: 'sync', header: 'Синхронизация', render: (r) => r.authKind === 'file' ? '—' : <div className="text-xs"><p>{r.lastSyncAt ? fmtAgo(r.lastSyncAt) : 'ещё не было'}</p>{r.filledTo && <p className="text-[10px] text-slate-500">данные по {r.filledTo}</p>}</div> },
    { key: 'error', header: 'Ошибка', render: (r) => r.lastError ? <p className="max-w-[280px] text-[11px] text-red-300" title={r.lastError}>{r.lastError}{r.errorCount > 1 ? ` (×${r.errorCount})` : ''}</p> : '—' },
    {
      key: 'actions', header: '', className: 'text-right',
      render: (r) => !data?.canEdit || r.status === 'disconnected' ? null : (
        <div className="flex justify-end gap-1.5">
          {r.authKind !== 'file' && <Button size="sm" icon={<ShieldCheck size={12} />} loading={busy === `${r.id}:test`} onClick={() => act(r, 'test')}>Проверить</Button>}
          {r.authKind !== 'file' && r.status !== 'needs_reauth' && <Button size="sm" icon={<RefreshCw size={12} />} loading={busy === `${r.id}:sync`} onClick={() => act(r, 'sync')}>Синхронизировать</Button>}
          <Button size="sm" variant="danger" icon={<Trash2 size={12} />} onClick={() => setRemoving(r)}>Отключить</Button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        title="Интеграции"
        description="Маркетплейсы, МойСклад, веб-аналитика и магазины клиентов: статус синхронизации и ошибки. Ключи хранятся зашифрованными и не показываются."
        actions={data?.canEdit ? <Button variant="primary" icon={<Plus size={14} />} onClick={() => setConnecting(true)} disabled={!data.encryptionReady}>Подключить для клиента</Button> : undefined}
      />
      <ErrorState error={q.error} onRetry={q.reload} />
      <ErrorState error={actionError} />
      {notice && <p role="status" className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">{notice}</p>}
      {data && !data.encryptionReady && (
        <p className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200"><AlertTriangle size={14} /> SECRETS_ENCRYPTION_KEY не настроен — подключение по ключу недоступно.</p>
      )}

      <Panel title="Подключения клиентов" description="Сначала — с ошибками и требующие нового ключа.">
        <DataTable
          columns={columns}
          rows={data?.items}
          rowKey={(r) => r.id}
          loading={q.loading}
          empty={<EmptyState icon={<Plug size={18} />} title="Подключений нет" text="Клиенты подключают интеграции в Настройках › Интеграции; сотрудник с правом «Данные компании клиента» может подключить здесь." />}
        />
      </Panel>

      <Panel title="Сервисы" description="Живые подключения ещё не проверены на реальных кабинетах продавцов. Где живого подключения нет — данные загружаются выгрузками.">
        <div className="grid gap-3 md:grid-cols-2">
          {(data?.catalog ?? []).map((c) => (
            <div key={c.key} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-xs text-slate-400">
              <div className="mb-1 flex items-center justify-between gap-2">
                <p className="text-sm text-slate-200">{c.label} <span className="text-[10px] text-slate-500">· {c.categoryLabel}</span></p>
                {c.mode === 'live' ? <Badge tone="blue">Live · не проверено вживую</Badge> : <Badge tone="amber">BLOCKED · выгрузки</Badge>}
              </div>
              {c.blocked ? (
                <div className="space-y-1">
                  <p><b className="text-slate-300">Причина:</b> {c.blocked.reason}</p>
                  <p><b className="text-slate-300">Нужно:</b> {c.blocked.requiredInput}</p>
                  <p><b className="text-slate-300">Как разблокировать:</b> {c.blocked.howToUnblock}</p>
                </div>
              ) : <p>{c.keySource}</p>}
              <p className="mt-1 text-[10px] text-slate-500">Выгрузка: {c.exportHint}</p>
            </div>
          ))}
        </div>
      </Panel>

      {connecting && data && (
        <ConnectModal catalog={data.catalog} onClose={() => setConnecting(false)} onDone={() => { setConnecting(false); void q.reload() }} />
      )}

      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={remove}
        loading={!!busy && busy.endsWith(':delete')}
        title="Отключить интеграцию?"
        text={removing ? `${label(removing.provider)} у компании «${removing.companyName ?? removing.companyId}»: сохранённый ключ будет удалён, синхронизация остановится. Уже полученные данные останутся.` : ''}
        confirmLabel="Отключить"
      />
    </div>
  )
}

function ConnectModal({ catalog, onClose, onDone }: { catalog: CatalogItem[]; onClose: () => void; onDone: () => void }) {
  const [search, setSearch] = useState('')
  const debounced = useDebounced(search, 300)
  const companies = useGigaQuery<CompaniesResponse>(debounced.trim().length >= 2 ? `/api/giga-admin/integrations/companies?q=${encodeURIComponent(debounced.trim())}` : null)
  const [companyId, setCompanyId] = useState('')
  const [provider, setProvider] = useState(catalog.find((c) => c.mode === 'live')?.key ?? '')
  const [fields, setFields] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const item = useMemo(() => catalog.find((c) => c.key === provider) ?? null, [catalog, provider])

  const submit = async () => {
    if (!companyId || !item) return
    setBusy(true)
    setError(null)
    try {
      await gigaFetch(`/api/giga-admin/integrations/${encodeURIComponent(companyId)}/${item.key}`, { method: 'POST', json: { fields } })
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось подключить')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={() => (busy ? undefined : onClose())}
      title="Подключить интеграцию клиенту"
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Отмена</Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={!companyId || !item}>{item?.mode === 'live' ? 'Проверить и подключить' : 'Отметить «выгрузки»'}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Компания" hint="Название или ID компании (минимум 2 символа)">
          <input value={search} onChange={(e) => { setSearch(e.target.value); setCompanyId('') }} className={inputClass} autoFocus />
        </Field>
        {(companies.data?.data.items ?? []).length > 0 && (
          <div className="max-h-40 space-y-1 overflow-y-auto">
            {companies.data?.data.items.map((c) => (
              <button key={c.id} type="button" onClick={() => { setCompanyId(c.id); setSearch(c.name ?? c.id) }}
                className={`block w-full rounded-lg border px-3 py-1.5 text-left text-xs ${companyId === c.id ? 'border-blue-500/40 bg-blue-500/10 text-blue-200' : 'border-white/[0.06] text-slate-300 hover:bg-white/[0.04]'}`}>
                {c.name ?? '—'} <span className="font-mono text-[10px] text-slate-500">{c.id}</span>
              </button>
            ))}
          </div>
        )}
        <Field label="Сервис">
          <select value={provider} onChange={(e) => { setProvider(e.target.value); setFields({}) }} className={inputClass}>
            {catalog.map((c) => <option key={c.key} value={c.key}>{c.label}{c.mode === 'file' ? ' — только выгрузки' : ''}</option>)}
          </select>
        </Field>
        {item && <p className="text-xs text-slate-400">{item.mode === 'live' ? item.keySource : item.blocked?.reason}</p>}
        {item?.mode === 'live' && item.fields.map((f) => (
          <Field key={f.name} label={f.label} hint={f.help}>
            {f.input === 'textarea'
              ? <textarea value={fields[f.name] ?? ''} onChange={(e) => setFields((s) => ({ ...s, [f.name]: e.target.value }))} rows={4} maxLength={f.maxLength} autoComplete="off" spellCheck={false} className={`${inputClass} font-mono text-xs`} placeholder={f.placeholder} />
              : <input type={f.input === 'password' ? 'password' : 'text'} value={fields[f.name] ?? ''} onChange={(e) => setFields((s) => ({ ...s, [f.name]: e.target.value }))} maxLength={f.maxLength} autoComplete="off" spellCheck={false} className={inputClass} placeholder={f.placeholder} />}
          </Field>
        ))}
        {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
      </div>
    </Modal>
  )
}
