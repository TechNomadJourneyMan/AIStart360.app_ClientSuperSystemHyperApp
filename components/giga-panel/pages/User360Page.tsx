'use client'

import { useWorkspace } from '@/components/giga-panel/WorkspaceContext'

import { Suspense, useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ClipboardList, Eye, FilePlus2, RefreshCw } from 'lucide-react'
import { RequirePermission, useStaff } from '@/components/giga-panel/StaffContext'
import { Badge, Button, ErrorState, PageHeader, Skeleton, StatTile, Tabs, fmtAgo, useGigaQuery } from '@/components/giga-panel/kit'
import { PROFILE_STATUS } from '@/lib/admin/labels'
import { STAFF_ROLE_LABELS } from '@/lib/admin/rbac'
import type { User360Profile } from '@/components/giga-panel/user360/types'
import { ProfileTab } from '@/components/giga-panel/user360/ProfileTab'
import { SurveyTab } from '@/components/giga-panel/user360/SurveyTab'
import { GriTab } from '@/components/giga-panel/user360/GriTab'
import { ActivityTab } from '@/components/giga-panel/user360/ActivityTab'
import { JourneyTab } from '@/components/giga-panel/user360/JourneyTab'
import { DocumentsTab } from '@/components/giga-panel/user360/DocumentsTab'
import { HistoryTab } from '@/components/giga-panel/user360/HistoryTab'
import { ImpersonateDialog } from '@/components/giga-panel/user360/ImpersonateDialog'
import { DataEntryModal } from '@/components/giga-panel/user360/DataEntryModal'
import { rememberUser } from '@/components/giga-panel/CommandPalette'

type TabKey = 'profile' | 'survey' | 'gri' | 'activity' | 'cjm' | 'documents' | 'history'

function User360Inner({ id }: { id: string }) {
  const { base, label } = useWorkspace()
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const { can } = useStaff()
  const tab = (sp.get('tab') as TabKey) || 'profile'
  const setTab = (t: TabKey) => router.replace(`${pathname}?tab=${t}`, { scroll: false })
  const { data, error, loading, reload } = useGigaQuery<{ data: User360Profile }>(`/api/giga-admin/users/${id}/profile`)
  const [impTarget, setImpTarget] = useState<null | 'cabinet' | 'survey'>(null)
  const [dataOpen, setDataOpen] = useState(false)
  const u = data?.data

  const title = u ? (u.company?.name || u.profile.organization || u.profile.full_name || u.profile.email || 'Пользователь') : 'Пользователь'

  // Feeds «недавние» in the panel-wide quick search (⌘K).
  useEffect(() => {
    if (!u) return
    rememberUser({ id, label: title, hint: [u.profile.full_name, u.profile.email].filter(Boolean).join(' · ') || null })
  }, [u, id, title])

  return (
    <div>
      <PageHeader
        crumbs={[{ label, href: base }, { label: 'Пользователи', href: `${base}/users` }, { label: title }]}
        title={<span className="flex flex-wrap items-center gap-2">{title}
          {u && <Badge tone={PROFILE_STATUS[u.profile.status]?.tone}>{PROFILE_STATUS[u.profile.status]?.label ?? u.profile.status}</Badge>}
          {u?.staffRole && <Badge tone="violet">{STAFF_ROLE_LABELS[u.staffRole]}</Badge>}
          {u?.impersonationActive && <Badge tone="amber">кабинет открыт админом</Badge>}
        </span>}
        description={u ? `${[u.profile.full_name, u.profile.email].filter(Boolean).join(' · ')} · активность ${fmtAgo(u.profile.last_seen_at)}` : undefined}
        actions={
          <>
            <Button variant="ghost" icon={<RefreshCw size={13} />} onClick={reload} loading={loading && !!u}>Обновить</Button>
            {u && can('company.edit') && u.can.sensitive && (
              <Button variant="primary" icon={<FilePlus2 size={13} />} onClick={() => setDataOpen(true)}>Добавить данные</Button>
            )}
            {u?.can.impersonate && (
              <>
                <Button variant="warning" icon={<Eye size={13} />} onClick={() => setImpTarget('cabinet')}>Посмотреть кабинет</Button>
                {u.can.viewSurvey && <Button variant="warning" icon={<ClipboardList size={13} />} onClick={() => setImpTarget('survey')}>Открыть анкету</Button>}
              </>
            )}
          </>
        }
      />
      <ErrorState error={error} onRetry={reload} />
      {!u && loading && <Skeleton className="h-64" />}
      {u && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Анкета" value={`${u.survey.percent}%`} hint={`${u.survey.startedSteps}/${u.survey.totalSteps} шагов · ${fmtAgo(u.survey.updatedAt)}`} tone="blue" />
            <StatTile label="GRI" value={u.gri.current ? u.gri.current.index.toFixed(1) : '—'} hint={u.gri.runs ? `прохождений: ${u.gri.runs}` : u.gri.draftUpdatedAt ? 'тест в процессе' : 'не пройден'} tone="violet" />
            <StatTile label="Точка А" value={u.diagnostics?.overall_score != null ? Math.round(Number(u.diagnostics.overall_score)) : '—'} hint={u.diagnostics ? `расчётов: ${u.diagnostics.runs}` : 'не рассчитана'} tone="green" />
            <StatTile label="Этап CJM" value={`${u.journey.completed}/${u.journey.total}`} hint={u.journey.current?.label ?? '—'} tone="amber" />
          </div>
          <Tabs<TabKey>
            className="mb-4"
            value={tab}
            onChange={setTab}
            tabs={[
              { key: 'profile', label: 'Профиль' },
              { key: 'survey', label: 'Анкета', hidden: !u.can.viewSurvey },
              { key: 'gri', label: 'GRI', count: u.gri.runs, hidden: !(can('gri.view') && u.can.sensitive) },
              { key: 'activity', label: 'Активность', count: u.counters.events, hidden: !u.can.activity },
              { key: 'cjm', label: 'CJM' },
              { key: 'documents', label: 'Документы', count: u.counters.documents, hidden: !u.can.sensitive },
              { key: 'history', label: 'История', hidden: !u.can.audit },
            ]}
          />
          {tab === 'profile' && <ProfileTab data={u} onChanged={reload} />}
          {tab === 'survey' && u.can.viewSurvey && <SurveyTab userId={id} canEdit={u.can.editSurvey} />}
          {tab === 'gri' && <GriTab userId={id} canEdit={u.can.editGri} canDelete={u.can.deleteGri} />}
          {tab === 'activity' && u.can.activity && <ActivityTab userId={id} />}
          {tab === 'cjm' && <JourneyTab userId={id} journey={u.journey} canActivity={u.can.activity} />}
          {tab === 'documents' && u.can.sensitive && <DocumentsTab userId={id} />}
          {tab === 'history' && u.can.audit && <HistoryTab userId={id} />}
          <DataEntryModal
            open={dataOpen}
            onClose={() => setDataOpen(false)}
            data={u}
            canEditSurvey={u.can.editSurvey}
            onChanged={reload}
          />
          <ImpersonateDialog
            open={!!impTarget}
            onClose={() => setImpTarget(null)}
            userId={id}
            userLabel={title}
            allowEdit={u.can.impersonateEdit}
            redirect={impTarget === 'survey' ? '/client/onboarding' : '/client/home'}
            defaultMode={impTarget === 'survey' && u.can.impersonateEdit ? 'edit' : 'view'}
            defaultReason={impTarget === 'survey' ? 'Работа с анкетой пользователя' : 'Проверка кабинета пользователя'}
          />
        </>
      )}
    </div>
  )
}

export function User360Page({ params }: { params: { id: string } }) {
  return (
    <RequirePermission permission="users.view">
      <Suspense fallback={null}>
        <User360Inner id={params.id} />
      </Suspense>
    </RequirePermission>
  )
}
