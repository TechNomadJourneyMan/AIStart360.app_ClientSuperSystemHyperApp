'use client'

/**
 * GIGA-CRM «Сообщения» — all conversations of the platform with its users
 * (Telegram, WhatsApp, email, the cabinet). Left: the list with filters
 * (ждут ответа / мои / без ответственного / просрочены / авто / с нарушениями)
 * and search by name, email, company; right: the conversation. «Новый диалог»
 * opens a conversation with any user. ?user=<id> selects a conversation
 * (links from staff notifications).
 */
import { Suspense, useCallback, useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Bot, Lock, MessageSquarePlus, ShieldAlert } from 'lucide-react'
import { RequirePermission, useStaff } from '@/components/giga-panel/StaffContext'
import {
  Badge, Button, EmptyState, ErrorState, Modal, PageHeader, SearchInput, Skeleton, Tabs, cx, fmtAgo, useDebounced, useGigaQuery,
} from '@/components/giga-panel/kit'
import { Conversation, ConversationEmpty } from '@/components/giga-panel/comm/Conversation'
import type { ThreadDTO, ThreadFilter } from '@/lib/comm/admin'

interface ThreadItem {
  userId: string
  name: string
  email: string | null
  company: string | null
  assignee: { id: string; name: string } | null
  thread: ThreadDTO
}
interface ThreadsResponse { data: ThreadItem[]; counts: { waiting: number; overdue: number; mine: number } }

const POLL_MS = 30_000

function MessagesInner() {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const { can } = useStaff()
  const selected = sp.get('user')
  const [filter, setFilter] = useState<ThreadFilter>('all')
  const [search, setSearch] = useState('')
  const q = useDebounced(search, 350)
  const [pickOpen, setPickOpen] = useState(false)

  const list = useGigaQuery<ThreadsResponse>(`/api/giga-admin/comm/threads?filter=${filter}${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''}`)
  const reload = list.reload
  useEffect(() => {
    const id = setInterval(() => { if (document.visibilityState === 'visible') void reload() }, POLL_MS)
    return () => clearInterval(id)
  }, [reload])

  const select = useCallback((userId: string | null) => {
    router.replace(userId ? `${pathname}?user=${userId}` : pathname, { scroll: false })
  }, [router, pathname])

  const counts = list.data?.counts
  return (
    <>
      <PageHeader
        crumbs={[{ label: 'GIGA-CRM', href: '/admin-giga-panel' }, { label: 'Сообщения' }]}
        title="Сообщения"
        description="Диалоги с пользователями платформы: кабинет, Telegram, WhatsApp и почта в одной ленте. Пользователь ждёт ответа — диалог наверху «Ждут ответа»."
        actions={can('inbox.manage') && <Button variant="primary" size="sm" icon={<MessageSquarePlus size={13} />} onClick={() => setPickOpen(true)}>Новый диалог</Button>}
      />

      <Tabs<ThreadFilter>
        className="mb-3"
        value={filter}
        onChange={setFilter}
        tabs={[
          { key: 'all', label: 'Все' },
          { key: 'waiting', label: 'Ждут ответа', count: counts?.waiting ?? null },
          { key: 'mine', label: 'Мои', count: counts?.mine ?? null },
          { key: 'unassigned', label: 'Без ответственного' },
          { key: 'overdue', label: 'Просрочены', count: counts?.overdue ?? null },
          { key: 'auto', label: 'Авто' },
          { key: 'violations', label: 'С нарушениями' },
          { key: 'closed', label: 'Закрытые' },
        ]}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(280px,360px)_1fr]">
        <div className="space-y-2">
          <SearchInput value={search} onChange={setSearch} placeholder="Имя, email или компания" />
          {list.error && <ErrorState error={list.error} onRetry={() => void reload()} />}
          {list.loading && !list.data && Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
          {list.data && list.data.data.length === 0 && (
            <EmptyState title="Диалогов нет" text={q.trim() ? 'Никого не нашли — попробуйте другой запрос.' : 'Здесь появятся сообщения пользователей и ваши ответы.'} />
          )}
          <ul className="space-y-1.5" aria-label="Диалоги">
            {(list.data?.data ?? []).map((it) => (
              <li key={it.userId}>
                <button
                  type="button"
                  onClick={() => select(it.userId)}
                  aria-current={selected === it.userId}
                  className={cx(
                    'w-full rounded-xl border px-3 py-2.5 text-left transition-colors',
                    selected === it.userId ? 'border-blue-500/40 bg-blue-500/10' : 'border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05]',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-semibold text-slate-100">{it.name}</span>
                    <span className="shrink-0 text-[10px] text-slate-500">{fmtAgo(it.thread.lastMessageAt)}</span>
                  </div>
                  {it.company && <p className="truncate text-[10px] text-slate-500">{it.company}</p>}
                  <p className="mt-0.5 line-clamp-1 text-[11px] text-slate-400">{it.thread.preview ?? '—'}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    {it.thread.unreadStaff > 0 && <Badge tone="blue">{it.thread.unreadStaff} новых</Badge>}
                    {it.thread.status === 'waiting_staff' && !it.thread.overdue && <Badge tone="amber">ждёт ответа</Badge>}
                    {it.thread.overdue && <Badge tone="red">просрочен</Badge>}
                    {it.thread.mode === 'auto' && <Badge tone="violet"><Bot size={9} /> авто</Badge>}
                    {it.thread.profanityCount > 0 && <Badge tone="red" title="Сообщений с нецензурной лексикой"><ShieldAlert size={9} /> {it.thread.profanityCount}</Badge>}
                    {it.thread.blockedAt && <Badge tone="red"><Lock size={9} /> блок</Badge>}
                    {it.thread.status === 'closed' && <Badge>закрыт</Badge>}
                    <span className="ml-auto truncate text-[10px] text-slate-600">{it.assignee?.name ?? 'без ответственного'}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>

        {selected ? <Conversation key={selected} userId={selected} onChanged={() => void reload()} /> : <ConversationEmpty />}
      </div>

      <UserPicker open={pickOpen} onClose={() => setPickOpen(false)} onPick={(id) => { setPickOpen(false); select(id) }} />
    </>
  )
}

interface UserRow { id: string; full_name: string | null; email: string | null; company_name?: string | null }

/** «Новый диалог»: search any user (the GIGA users list, same scope rules). */
function UserPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (userId: string) => void }) {
  const [search, setSearch] = useState('')
  const q = useDebounced(search, 300)
  const res = useGigaQuery<{ data: UserRow[] }>(open && q.trim().length >= 2 ? `/api/giga-admin/users?q=${encodeURIComponent(q.trim())}&pageSize=10` : null)
  useEffect(() => { if (!open) setSearch('') }, [open])
  return (
    <Modal open={open} onClose={onClose} title="Новый диалог">
      <SearchInput value={search} onChange={setSearch} placeholder="Имя, email или компания пользователя" />
      <div className="mt-3 space-y-1.5">
        {q.trim().length < 2 && <p className="text-xs text-slate-500">Введите хотя бы 2 символа.</p>}
        {res.error && <ErrorState error={res.error} />}
        {res.loading && <Skeleton className="h-10" />}
        {res.data && res.data.data.length === 0 && <p className="text-xs text-slate-500">Никого не нашли.</p>}
        {(res.data?.data ?? []).map((u) => (
          <button key={u.id} type="button" onClick={() => onPick(u.id)} className="w-full rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-left hover:bg-white/[0.06]">
            <p className="text-xs font-medium text-slate-200">{u.full_name || u.email || u.id}</p>
            <p className="text-[10px] text-slate-500">{[u.company_name, u.email].filter(Boolean).join(' · ')}</p>
          </button>
        ))}
      </div>
    </Modal>
  )
}

export function MessagesPage() {
  return (
    <RequirePermission permission="inbox.view">
      <Suspense fallback={null}>
        <MessagesInner />
      </Suspense>
    </RequirePermission>
  )
}
