'use client'

import { useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Copy, LogIn, Plus, Trash2, UserRound } from 'lucide-react'
import { STAFF_ROLE_LABELS, isStaffRole } from '@/lib/admin/rbac'
import { TEST_ACCOUNT_KINDS, TEST_EMAIL_DOMAIN, TEST_STATUSES, testAccountKind, type TestProfileStatus } from '@/lib/devtools/test-accounts'
import {
  Badge, Button, ConfirmDialog, DataTable, EmptyState, ErrorState, GigaApiError, Modal, Panel, Select, fmtDateTime, gigaFetch, useGigaQuery, type Column,
} from '../kit'
import { ImpersonateDialog } from '../user360/ImpersonateDialog'

interface Row {
  id: string; email: string | null; full_name: string | null; role: string | null; status: string | null
  created_at: string | null; staff_role: string | null; deletable: boolean
}
interface ListResponse { ok: true; migrationRequired: boolean; message?: string; data: Row[] }
interface Created { id: string; email: string; password: string; companyId: string | null; kind: string; label: string; client: boolean }

const STATUS_TONE: Record<string, 'green' | 'amber' | 'red' | 'neutral'> = { approved: 'green', pending_approval: 'amber', blocked: 'red' }
const STATUS_LABEL: Record<string, string> = Object.fromEntries(TEST_STATUSES.map((s) => [s.value, s.label]))

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(`${what} скопирован`)
  } catch {
    toast.error('Не удалось скопировать — выделите текст вручную')
  }
}

function roleLabel(r: Row): string {
  if (isStaffRole(r.staff_role)) return STAFF_ROLE_LABELS[r.staff_role]
  if (r.role === 'expert') return 'Эксперт'
  if (r.role === 'admin') return 'Администратор'
  return 'Клиент'
}

/** Тестовые аккаунты: создать роль / состояние, войти «от имени» (клиенты), сменить статус, удалить. */
export function TestAccountsTab() {
  const { data, error, loading, reload } = useGigaQuery<ListResponse>('/api/giga-admin/dev-tools/test-accounts')
  const [kind, setKind] = useState<string>(TEST_ACCOUNT_KINDS[0].key)
  const [withCompany, setWithCompany] = useState(true)
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<Created | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [del, setDel] = useState<Row | null>(null)
  const [delAll, setDelAll] = useState(false)
  const [imp, setImp] = useState<Row | null>(null)

  const selected = testAccountKind(kind) ?? TEST_ACCOUNT_KINDS[0]
  const migration = data?.migrationRequired

  const create = async () => {
    setCreating(true)
    try {
      const res = await gigaFetch<{ data: Created }>('/api/giga-admin/dev-tools/test-accounts', {
        method: 'POST', json: { kind, withCompany: selected.client ? withCompany : false },
      })
      setCreated(res.data)
      void reload()
    } catch (e) {
      toast.error(e instanceof GigaApiError ? e.message : 'Не удалось создать аккаунт')
    } finally {
      setCreating(false)
    }
  }

  const changeStatus = async (r: Row, status: TestProfileStatus) => {
    setBusy(r.id)
    try {
      await gigaFetch(`/api/giga-admin/dev-tools/test-accounts/${r.id}`, { method: 'PATCH', json: { status } })
      toast.success(`Статус: ${STATUS_LABEL[status]}`)
      void reload()
    } catch (e) {
      toast.error(e instanceof GigaApiError ? e.message : 'Не удалось сменить статус')
    } finally {
      setBusy(null)
    }
  }

  const removeOne = async () => {
    if (!del) return
    setBusy(del.id)
    try {
      await gigaFetch(`/api/giga-admin/dev-tools/test-accounts/${del.id}`, { method: 'DELETE' })
      toast.success('Тестовый аккаунт удалён')
      setDel(null)
      void reload()
    } catch (e) {
      toast.error(e instanceof GigaApiError ? e.message : 'Не удалось удалить')
    } finally {
      setBusy(null)
    }
  }

  const removeAll = async () => {
    setBusy('all')
    try {
      const res = await gigaFetch<{ deleted: number; failed: Array<{ email: string | null; error: string }>; skipped: number }>(
        '/api/giga-admin/dev-tools/test-accounts', { method: 'DELETE', json: { confirm: 'УДАЛИТЬ' } },
      )
      if (res.failed.length) toast.warning(`Удалено ${res.deleted}, не удалось — ${res.failed.length}`)
      else toast.success(`Удалено тестовых аккаунтов: ${res.deleted}`)
      setDelAll(false)
      void reload()
    } catch (e) {
      toast.error(e instanceof GigaApiError ? e.message : 'Не удалось удалить')
    } finally {
      setBusy(null)
    }
  }

  const columns: Column<Row>[] = [
    {
      key: 'who', header: 'Аккаунт', render: (r) => (
        <div className="min-w-0">
          <p className="truncate text-slate-100">{r.full_name || '—'}</p>
          <p className="truncate font-mono text-[11px] text-slate-500">{r.email}</p>
        </div>
      ),
    },
    { key: 'role', header: 'Роль', render: (r) => <Badge tone={r.staff_role ? 'violet' : 'blue'}>{roleLabel(r)}</Badge> },
    {
      key: 'status', header: 'Статус', render: (r) => (
        <Select
          label="Статус"
          value={(r.status ?? 'approved') as TestProfileStatus}
          onChange={(v) => changeStatus(r, v)}
          options={TEST_STATUSES}
        />
      ),
    },
    { key: 'created', header: 'Создан', render: (r) => <span className="whitespace-nowrap text-[11px] text-slate-400">{fmtDateTime(r.created_at)}</span> },
    {
      key: 'act', header: '', render: (r) => (
        <div className="flex flex-wrap justify-end gap-1.5">
          <Link href={`/admin-giga-panel/users/${r.id}`} className="inline-flex items-center gap-1 rounded-xl border border-white/[0.1] px-2.5 py-1.5 text-[11px] text-slate-200 hover:bg-white/[0.06]">
            <UserRound size={12} /> User 360
          </Link>
          {r.role === 'client' && !r.staff_role && r.status !== 'blocked' && (
            <Button size="sm" variant="warning" icon={<LogIn size={12} />} onClick={() => setImp(r)}>От имени</Button>
          )}
          <Button size="sm" variant="danger" icon={<Trash2 size={12} />} loading={busy === r.id} disabled={!r.deletable} title={r.deletable ? undefined : 'Адрес не в тестовом домене — удаляйте из User 360'} onClick={() => setDel(r)}>
            Удалить
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <ErrorState error={error} onRetry={reload} />
      {migration && (
        <div role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/[0.08] px-4 py-3 text-xs text-amber-200">
          {data?.message ?? 'Примените миграцию 120 — без колонки profiles.is_test тестовые аккаунты не создаются.'}
        </div>
      )}

      <Panel
        title="Создать тестовый аккаунт"
        description={`Аккаунт создаётся в базе платформы, помечается как тестовый (profiles.is_test) и получает адрес в домене ${TEST_EMAIL_DOMAIN}. Письма не отправляются. Пароль показывается один раз. Не больше 20 в час.`}
      >
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          {TEST_ACCOUNT_KINDS.map((k) => (
            <button
              key={k.key}
              type="button"
              onClick={() => setKind(k.key)}
              aria-pressed={kind === k.key}
              className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${kind === k.key ? 'border-blue-500/40 bg-blue-500/10' : 'border-white/[0.07] bg-white/[0.02] hover:border-white/[0.14]'}`}
            >
              <p className="text-xs font-semibold text-slate-100">{k.label}</p>
              <p className="mt-0.5 text-[10px] leading-snug text-slate-500">{k.hint}</p>
            </button>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {selected.client && (
            <label className="flex items-center gap-2 text-xs text-slate-300">
              <input type="checkbox" checked={withCompany} onChange={(e) => setWithCompany(e.target.checked)} className="accent-blue-500" />
              Создать пустую компанию
            </label>
          )}
          <Button variant="primary" icon={<Plus size={14} />} loading={creating} disabled={!!migration} onClick={create}>
            Создать: {selected.label}
          </Button>
        </div>
        {selected.staffRole && (
          <p className="mt-2 text-[11px] text-slate-500">
            Если в настройках включена обязательная 2FA для персонала, тестовому сотруднику понадобится настроить второй фактор при первом входе.
          </p>
        )}
      </Panel>

      <Panel
        title={`Тестовые аккаунты${data?.data ? ` · ${data.data.length}` : ''}`}
        bodyClassName="p-0"
        actions={
          <Button size="sm" variant="danger" icon={<Trash2 size={12} />} disabled={!data?.data?.length} loading={busy === 'all'} onClick={() => setDelAll(true)}>
            Удалить все тестовые аккаунты
          </Button>
        }
      >
        <DataTable
          columns={columns}
          rows={data?.data}
          rowKey={(r) => r.id}
          loading={loading}
          empty={<EmptyState title="Тестовых аккаунтов нет" text="Создайте аккаунт нужной роли выше — он появится здесь." />}
        />
      </Panel>

      <Modal
        open={!!created}
        onClose={() => setCreated(null)}
        title="Тестовый аккаунт создан"
        footer={<Button variant="primary" onClick={() => setCreated(null)}>Готово</Button>}
      >
        {created && (
          <div className="space-y-3 text-xs">
            <p className="text-slate-400">{created.label}. Сохраните пароль сейчас — повторно его не показать (можно только сбросить).</p>
            {([['Email', created.email], ['Пароль', created.password]] as const).map(([label, value]) => (
              <div key={label}>
                <p className="mb-1 text-[11px] text-slate-500">{label}</p>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 break-all rounded-lg border border-white/[0.08] bg-black/30 px-3 py-2 font-mono text-[12px] text-slate-100">{value}</code>
                  <Button size="sm" icon={<Copy size={12} />} onClick={() => copy(value, label)}>Копировать</Button>
                </div>
              </div>
            ))}
            <div className="flex flex-wrap gap-2 pt-1">
              <Link href={`/admin-giga-panel/users/${created.id}`} className="text-[11px] text-blue-300 hover:underline">Открыть User 360 →</Link>
              <span className="text-[11px] text-slate-600">Вход: /login с этим email и паролем{created.client ? ', или «От имени» из списка' : ''}.</span>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!del}
        onClose={() => setDel(null)}
        onConfirm={removeOne}
        loading={!!del && busy === del.id}
        title="Удалить тестовый аккаунт?"
        text={<>Аккаунт <span className="font-mono text-slate-200">{del?.email}</span> и все его данные будут удалены безвозвратно.</>}
        confirmLabel="Удалить"
      />
      <ConfirmDialog
        open={delAll}
        onClose={() => setDelAll(false)}
        onConfirm={removeAll}
        loading={busy === 'all'}
        title="Удалить все тестовые аккаунты?"
        text={`Будут безвозвратно удалены все аккаунты с пометкой «тестовый» в домене ${TEST_EMAIL_DOMAIN} (${data?.data?.filter((r) => r.deletable).length ?? 0}) вместе с данными. Живые пользователи не затрагиваются.`}
        requireText="УДАЛИТЬ"
        confirmLabel="Удалить все"
      />
      {imp && (
        <ImpersonateDialog
          open
          onClose={() => setImp(null)}
          userId={imp.id}
          userLabel={imp.full_name || imp.email || imp.id}
          allowEdit
          defaultReason="Тестирование кабинета (Dev-tools, тестовый аккаунт)"
        />
      )}
    </div>
  )
}
