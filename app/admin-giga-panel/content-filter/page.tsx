'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Settings2 } from 'lucide-react'
import { RequirePermission } from '@/components/giga-panel/StaffContext'
import { Badge, PageHeader, Tabs, useGigaQuery } from '@/components/giga-panel/kit'
import type { ProfanityCategory } from '@/lib/moderation/profanity'
import { JournalPanel } from '@/components/giga-panel/content-filter/JournalPanel'
import { DictionaryPanel } from '@/components/giga-panel/content-filter/DictionaryPanel'
import { TestPanel } from '@/components/giga-panel/content-filter/TestPanel'
import type { EventsResponse, FilterTerm } from '@/components/giga-panel/content-filter/types'

type Tab = 'journal' | 'dictionary' | 'test'
type StatusFilter = 'open' | 'all' | 'reviewed' | 'false_positive'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function Inner() {
  const sp = useSearchParams()
  const userParam = sp.get('user')
  const userId = userParam && UUID_RE.test(userParam) ? userParam : null
  const [tab, setTab] = useState<Tab>('journal')
  const [status, setStatus] = useState<StatusFilter>(userId ? 'all' : 'open')
  const [category, setCategory] = useState<'' | ProfanityCategory>('')
  const [page, setPage] = useState(1)
  const [dictionaryVersion, setDictionaryVersion] = useState(0)

  const qs = new URLSearchParams({ status, page: String(page) })
  if (category) qs.set('category', category)
  if (userId) qs.set('user', userId)
  const events = useGigaQuery<EventsResponse>(`/api/giga-admin/content-filter?${qs.toString()}`)
  const terms = useGigaQuery<{ ok: true; data: FilterTerm[] }>(`/api/giga-admin/content-filter/terms?v=${dictionaryVersion}`)
  const bumpDictionary = () => setDictionaryVersion((v) => v + 1)

  const enabled = events.data?.filterEnabled
  return (
    <>
      <PageHeader
        crumbs={[{ label: 'GIGA-CRM', href: '/admin-giga-panel' }, { label: 'Фильтр контента' }]}
        title="Фильтр контента"
        description="Мат, оскорбления и спам в именах, названиях компаний, анкете и других текстах клиентов не сохраняются: пользователь видит сообщение, персонал — уведомление, случай — в журнале."
        actions={
          <Link
            href="/admin-giga-panel/settings"
            className="inline-flex items-center gap-2 rounded-xl border border-white/[0.1] bg-white/[0.05] px-3 py-2 text-xs text-slate-200 hover:bg-white/[0.09]"
            title="Настройка «Фильтр мата и оскорблений»"
          >
            <Settings2 size={13} />
            Фильтр:
            {enabled === undefined ? <Badge>…</Badge> : enabled ? <Badge tone="green">включён</Badge> : <Badge tone="red">выключен</Badge>}
          </Link>
        }
      />
      {enabled === false && (
        <p className="mb-4 rounded-xl border border-red-500/25 bg-red-500/[0.08] px-4 py-2.5 text-xs text-red-200">
          Фильтр выключен: тексты сохраняются без проверки и в журнал ничего не попадает. Включить —{' '}
          <Link href="/admin-giga-panel/settings" className="underline hover:text-red-100">Настройки → «Фильтр мата и оскорблений»</Link>.
        </p>
      )}
      <Tabs<Tab>
        className="mb-4"
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'journal', label: 'Журнал', count: events.data?.counts.open ?? null },
          { key: 'dictionary', label: 'Словарь', count: terms.data?.data.length ?? null },
          { key: 'test', label: 'Проверка текста' },
        ]}
      />
      {tab === 'journal' && (
        <JournalPanel
          data={events.data}
          error={events.error}
          loading={events.loading}
          reload={() => void events.reload()}
          status={status}
          setStatus={setStatus}
          category={category}
          setCategory={setCategory}
          userId={userId}
          page={page}
          setPage={setPage}
          onTermAdded={bumpDictionary}
        />
      )}
      {tab === 'dictionary' && (
        <DictionaryPanel terms={terms.data?.data ?? null} error={terms.error} loading={terms.loading} reload={bumpDictionary} />
      )}
      {tab === 'test' && <TestPanel dictionaryVersion={dictionaryVersion} />}
    </>
  )
}

export default function ContentFilterPage() {
  return (
    <RequirePermission permission="moderation.content">
      <Suspense fallback={null}><Inner /></Suspense>
    </RequirePermission>
  )
}
