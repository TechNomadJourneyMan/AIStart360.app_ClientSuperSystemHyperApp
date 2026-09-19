'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { CheckCircle2, Clock, Mail, RefreshCw, Send, XCircle } from 'lucide-react'
import { RequirePermission, useStaff } from '@/components/giga-panel/StaffContext'
import {
  Badge, Button, DataTable, EmptyState, ErrorState, Field, PageHeader, Panel, cx, fmtAgo, fmtDateTime,
  gigaFetch, inputClass, useGigaQuery, type Column,
} from '@/components/giga-panel/kit'
import { parseEmailList, type InviteResult } from '@/lib/admin/invite-shared'

interface InviteRow {
  id: number
  email: string
  sentAt: string
  sentBy: string
  outcome: 'invited' | 'relinked'
  note: string | null
  acceptedAt: string | null
  userId: string | null
  profileStatus: string | null
}

const MAX_EMAILS = 25

export default function InvitesPage() {
  const { can } = useStaff()
  const canInvite = can('users.manage')
  const list = useGigaQuery<{ data: InviteRow[] }>('/api/giga-admin/invites')

  const [raw, setRaw] = useState('')
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)
  const [results, setResults] = useState<InviteResult[] | null>(null)

  const { emails, invalid } = useMemo(() => parseEmailList(raw), [raw])
  const tooMany = emails.length > MAX_EMAILS

  const send = async () => {
    setSending(true)
    setResults(null)
    try {
      const res = await gigaFetch<{ sent: number; failed: number; results: InviteResult[] }>('/api/giga-admin/invites', {
        method: 'POST',
        json: { emails, note: note.trim() || undefined },
      })
      setResults(res.results)
      if (res.sent) toast.success(`Отправлено писем: ${res.sent}${res.failed ? `, с ошибкой: ${res.failed}` : ''}`)
      else toast.error('Ни одно письмо не отправлено')
      if (res.sent) {
        setRaw('')
        setNote('')
        void list.reload()
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось отправить приглашения')
    } finally {
      setSending(false)
    }
  }

  const columns: Column<InviteRow>[] = [
    {
      key: 'email', header: 'Адрес',
      render: (r) => (
        <span className="block min-w-0">
          <span className="block truncate font-medium text-slate-100">{r.email}</span>
          {r.note && <span className="block truncate text-[10px] text-slate-500">«{r.note}»</span>}
        </span>
      ),
    },
    {
      key: 'state', header: 'Статус',
      render: (r) => (
        <div className="flex flex-wrap items-center gap-1">
          {r.acceptedAt
            ? <Badge tone="green">принято</Badge>
            : <Badge tone="amber">ожидает</Badge>}
          {r.outcome === 'relinked' && <Badge>аккаунт уже был</Badge>}
        </div>
      ),
    },
    { key: 'sent', header: 'Отправлено', render: (r) => <span className="text-slate-400" title={fmtDateTime(r.sentAt)}>{fmtAgo(r.sentAt)}</span> },
    { key: 'by', header: 'Кто пригласил', render: (r) => <span className="text-slate-500">{r.sentBy === 'giga:super_admin' ? 'общий пароль' : r.sentBy}</span> },
    {
      key: 'user', header: '',
      render: (r) => (r.userId
        ? <Link href={`/admin-giga-panel/users/${r.userId}`} className="text-[11px] text-blue-300 hover:underline">Карточка</Link>
        : <span className="text-[11px] text-slate-600">—</span>),
    },
  ]

  return (
    <RequirePermission permission="users.view">
      <PageHeader
        crumbs={[{ label: 'GIGA-CRM', href: '/admin-giga-panel' }, { label: 'Приглашения' }]}
        title="Приглашения на платформу"
        description="Письмо со ссылкой уходит с нашего домена: человек задаёт пароль и сразу попадает в кабинет. Вход через Google для этого не нужен."
        actions={<Button size="sm" variant="ghost" icon={<RefreshCw size={13} />} onClick={() => void list.reload()}>Обновить</Button>}
      />

      {!canInvite && (
        <p className="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/[0.06] px-4 py-2.5 text-xs text-amber-200">
          У вас доступ только на просмотр: отправлять приглашения могут роли с правом управления пользователями.
        </p>
      )}

      {canInvite && (
        <Panel className="mb-4" title={<span className="flex items-center gap-2"><Mail size={14} className="text-blue-300" /> Новое приглашение</span>}>
          <div className="grid gap-3 lg:grid-cols-2">
            <Field label="Адреса" hint={`Через запятую, точку с запятой или с новой строки. До ${MAX_EMAILS} за раз.`}>
              <textarea
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
                rows={4}
                placeholder={'ivan@company.kz\nsales@company.kz'}
                className={cx(inputClass, 'font-mono text-xs')}
              />
            </Field>
            <Field label="Сообщение в письме (необязательно)" hint="Одна строка от вас — попадёт в текст приглашения.">
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={4}
                maxLength={300}
                placeholder="Пример: приглашаю пройти диагностику до нашей встречи в четверг."
                className={inputClass}
              />
            </Field>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] text-slate-500">
              {emails.length > 0 && <span className="text-slate-300">Адресов: {emails.length}. </span>}
              {invalid.length > 0 && <span className="text-amber-300">Не похоже на почту: {invalid.slice(0, 3).join(', ')}{invalid.length > 3 ? '…' : ''}. </span>}
              {tooMany && <span className="text-red-300">Больше {MAX_EMAILS} за раз нельзя. </span>}
              {emails.length === 0 && invalid.length === 0 && 'Введите хотя бы один адрес.'}
            </p>
            <Button
              variant="primary"
              icon={<Send size={13} />}
              disabled={emails.length === 0 || tooMany}
              loading={sending}
              onClick={() => void send()}
            >
              Отправить приглашения
            </Button>
          </div>

          {results && (
            <ul className="mt-3 space-y-1 border-t border-white/[0.06] pt-3">
              {results.map((r) => (
                <li key={r.email} className="flex items-center gap-2 text-[11px]">
                  {r.outcome === 'failed'
                    ? <XCircle size={12} className="shrink-0 text-red-400" />
                    : r.outcome === 'relinked'
                      ? <Clock size={12} className="shrink-0 text-amber-400" />
                      : <CheckCircle2 size={12} className="shrink-0 text-emerald-400" />}
                  <span className="text-slate-200">{r.email}</span>
                  <span className="text-slate-500">— {r.message}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      <Panel title="Отправленные приглашения" description={list.data ? `Последние ${list.data.data.length}` : undefined} bodyClassName="p-0">
        {list.error && <div className="p-3"><ErrorState error={list.error} onRetry={list.reload} /></div>}
        <DataTable
          columns={columns}
          rows={list.data?.data}
          rowKey={(r) => String(r.id)}
          loading={list.loading}
          empty={<EmptyState title="Приглашений пока нет" text="Отправьте первое — оно появится здесь со статусом." />}
        />
      </Panel>
    </RequirePermission>
  )
}
