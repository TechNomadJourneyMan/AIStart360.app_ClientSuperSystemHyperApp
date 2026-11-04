'use client'

import { useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { CheckCircle2, ShieldOff, UserRound } from 'lucide-react'
import { PROFANITY_CATEGORY_LABELS, type ProfanityCategory } from '@/lib/moderation/profanity'
import {
  Badge, Button, DataTable, EmptyState, ErrorState, Field, GigaApiError, Modal, Pagination, Panel, Select, fmtDateTime, gigaFetch, inputClass, type Column, type Tone,
} from '@/components/giga-panel/kit'
import { SOURCE_LABELS, STATUS_LABELS, type EventStatus, type EventsResponse, type ModerationEventRow } from './types'

const CATEGORY_TONE: Record<ProfanityCategory, Tone> = { mat: 'red', insult: 'amber', spam: 'violet', custom: 'blue' }
const STATUS_TONE: Record<EventStatus, Tone> = { open: 'amber', reviewed: 'green', false_positive: 'neutral' }

type StatusFilter = 'open' | 'all' | 'reviewed' | 'false_positive'
type CategoryFilter = '' | ProfanityCategory

export function JournalPanel({ data, error, loading, reload, status, setStatus, category, setCategory, userId, page, setPage, onTermAdded }: {
  data: EventsResponse | null
  error: GigaApiError | null
  loading: boolean
  reload: () => void
  status: StatusFilter
  setStatus: (v: StatusFilter) => void
  category: CategoryFilter
  setCategory: (v: CategoryFilter) => void
  userId: string | null
  page: number
  setPage: (p: number) => void
  onTermAdded: () => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [fpRow, setFpRow] = useState<ModerationEventRow | null>(null)
  const [allowWord, setAllowWord] = useState('')
  const [allowNote, setAllowNote] = useState('')

  const setEventStatus = async (row: ModerationEventRow, next: EventStatus): Promise<boolean> => {
    setBusy(row.id)
    try {
      await gigaFetch(`/api/giga-admin/content-filter/events/${row.id}`, { method: 'PATCH', json: { status: next } })
      toast.success(next === 'reviewed' ? 'Отмечено как проверенное' : next === 'false_positive' ? 'Отмечено как ложное срабатывание' : 'Возвращено в новые')
      reload()
      return true
    } catch (e) {
      toast.error(e instanceof GigaApiError ? e.message : 'Не удалось обновить запись')
      return false
    } finally {
      setBusy(null)
    }
  }

  const confirmFalsePositive = async () => {
    if (!fpRow) return
    const ok = await setEventStatus(fpRow, 'false_positive')
    if (!ok) return
    const word = allowWord.trim()
    if (word) {
      try {
        await gigaFetch('/api/giga-admin/content-filter/terms', {
          method: 'POST',
          json: { term: word, kind: 'allow', note: allowNote.trim() || `Ложное срабатывание: ${fpRow.field_label ?? fpRow.field}` },
        })
        toast.success(`«${word}» добавлено в исключения`)
        onTermAdded()
      } catch (e) {
        toast.error(e instanceof GigaApiError ? e.message : 'Не удалось добавить исключение')
      }
    }
    setFpRow(null)
  }

  const columns: Column<ModerationEventRow>[] = [
    { key: 'date', header: 'Когда', render: (r) => <span className="whitespace-nowrap text-[11px] text-slate-400">{fmtDateTime(r.created_at)}</span> },
    {
      key: 'user', header: 'Пользователь', className: 'max-w-[14rem]', render: (r) => r.user_id
        ? (
          <Link href={`/admin-giga-panel/users/${r.user_id}`} className="block truncate text-slate-100 hover:text-blue-300" title={r.user_email ?? r.user_id}>
            {r.user_name || r.user_email || r.user_id}
            {r.user_name && r.user_email && <span className="block truncate text-[10px] text-slate-500">{r.user_email}</span>}
          </Link>
        )
        : <span className="text-slate-400" title="Регистрация: аккаунт не создан">{r.user_email || 'гость'}</span>,
    },
    { key: 'source', header: 'Где', render: (r) => <span className="whitespace-nowrap">{SOURCE_LABELS[r.source] ?? r.source}<span className="block text-[10px] text-slate-500">{r.field_label || r.field}</span></span> },
    {
      key: 'cat', header: 'Нарушение', render: (r) => (
        <div className="flex flex-wrap gap-1">
          {r.categories.map((c) => <Badge key={c} tone={CATEGORY_TONE[c] ?? 'neutral'}>{PROFANITY_CATEGORY_LABELS[c] ?? c}</Badge>)}
        </div>
      ),
    },
    {
      key: 'excerpt', header: 'Текст (замаскирован)', className: 'max-w-[20rem]', render: (r) => (
        <span className="line-clamp-2 text-slate-400" title={r.excerpt ?? ''}>
          {r.excerpt || '—'}
          {r.terms.length > 0 && <span className="block text-[10px] text-slate-500">Слова: {r.terms.join(', ')}</span>}
        </span>
      ),
    },
    { key: 'status', header: 'Статус', render: (r) => <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABELS[r.status]}</Badge> },
    {
      key: 'act', header: '', render: (r) => (
        <div className="flex flex-wrap justify-end gap-1.5">
          {r.status === 'open' ? (
            <>
              <Button size="sm" variant="secondary" icon={<CheckCircle2 size={12} />} loading={busy === r.id} onClick={() => setEventStatus(r, 'reviewed')}>Проверено</Button>
              <Button size="sm" variant="ghost" icon={<ShieldOff size={12} />} disabled={busy === r.id} onClick={() => { setAllowWord(''); setAllowNote(''); setFpRow(r) }}>Ложное</Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" loading={busy === r.id} onClick={() => setEventStatus(r, 'open')}>Вернуть</Button>
          )}
          {r.user_id && (
            <Link
              href={`/admin-giga-panel/users/${r.user_id}`}
              title="Карточка пользователя — там можно заблокировать"
              className="inline-flex items-center gap-1 rounded-xl border border-white/[0.1] px-2.5 py-1.5 text-[11px] text-slate-300 hover:bg-white/[0.06]"
            >
              <UserRound size={12} /> Карточка
            </Link>
          )}
        </div>
      ),
    },
  ]

  return (
    <>
      <Panel
        bodyClassName="p-0"
        title="Журнал нарушений"
        description="Тексты не сохранены — пользователь увидел сообщение. Мат замаскирован."
        actions={
          <>
            <Select<StatusFilter>
              label="Статус"
              value={status}
              onChange={(v) => { setStatus(v); setPage(1) }}
              options={[
                { value: 'open', label: `Новые${data ? ` (${data.counts.open})` : ''}` },
                { value: 'reviewed', label: `Проверенные${data ? ` (${data.counts.reviewed})` : ''}` },
                { value: 'false_positive', label: `Ложные${data ? ` (${data.counts.false_positive})` : ''}` },
                { value: 'all', label: 'Все' },
              ]}
            />
            <Select<CategoryFilter>
              label="Категория"
              value={category}
              onChange={(v) => { setCategory(v); setPage(1) }}
              options={[
                { value: '', label: 'Все категории' },
                ...(Object.keys(PROFANITY_CATEGORY_LABELS) as ProfanityCategory[]).map((c) => ({ value: c, label: PROFANITY_CATEGORY_LABELS[c] })),
              ]}
            />
          </>
        }
      >
        {userId && (
          <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] px-4 py-2 text-[11px] text-slate-400">
            Только пользователь <Link href={`/admin-giga-panel/users/${userId}`} className="text-blue-300 hover:underline">{userId}</Link>
            <Link href="/admin-giga-panel/content-filter" className="text-slate-500 hover:text-slate-300">· показать всех</Link>
          </div>
        )}
        <div className="px-4 pt-3"><ErrorState error={error} onRetry={reload} /></div>
        {!error && (
          <DataTable
            columns={columns}
            rows={data?.data}
            rowKey={(r) => r.id}
            loading={loading}
            empty={<EmptyState title={status === 'open' ? 'Новых нарушений нет' : 'Записей нет'} text="Сюда попадают тексты, которые фильтр не дал сохранить." />}
          />
        )}
        {data && !error && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />}
      </Panel>

      <Modal
        open={!!fpRow}
        onClose={() => setFpRow(null)}
        title="Ложное срабатывание"
        footer={
          <>
            <Button variant="ghost" onClick={() => setFpRow(null)}>Отмена</Button>
            <Button variant="primary" loading={!!fpRow && busy === fpRow.id} onClick={confirmFalsePositive}>
              {allowWord.trim() ? 'Отметить и добавить исключение' : 'Отметить'}
            </Button>
          </>
        }
      >
        {fpRow && (
          <div className="space-y-3 text-xs text-slate-400">
            <p>
              Текст: <span className="text-slate-200">{fpRow.excerpt || '—'}</span>
              {fpRow.terms.length > 0 && <> · сработало на: <span className="text-slate-200">{fpRow.terms.join(', ')}</span></>}
            </p>
            <p>
              Чтобы это слово больше не блокировалось, впишите его в исключения (в журнале оно замаскировано — наберите
              слово целиком или его начало). Исключение действует для всех слов, которые с него начинаются.
            </p>
            <Field label="Слово-исключение (необязательно)" hint="От 2 до 60 символов. Пусто — только отметить запись.">
              <input value={allowWord} onChange={(e) => setAllowWord(e.target.value)} maxLength={60} className={inputClass} placeholder="например, хуанхэ" />
            </Field>
            <Field label="Заметка">
              <input value={allowNote} onChange={(e) => setAllowNote(e.target.value)} maxLength={300} className={inputClass} placeholder="Почему это не нарушение" />
            </Field>
          </div>
        )}
      </Modal>
    </>
  )
}
