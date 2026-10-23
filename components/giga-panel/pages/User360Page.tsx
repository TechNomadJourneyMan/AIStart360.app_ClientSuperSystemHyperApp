'use client'

import { useWorkspace } from '@/components/giga-panel/WorkspaceContext'

import { Suspense, useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { BellRing, ClipboardList, Eye, FilePlus2, RefreshCw } from 'lucide-react'
import { RequirePermission, useStaff } from '@/components/giga-panel/StaffContext'
import { Badge, Button, ErrorState, PageHeader, Skeleton, StatTile, Tabs, fmtAgo, useGigaQuery } from '@/components/giga-panel/kit'
import { PROFILE_STATUS } from '@/lib/admin/labels'
import { STAFF_ROLE_LABELS } from '@/lib/admin/rbac'
import type { User360Profile } from '@/components/giga-panel/user360/types'
import { ProfileTab } from '@/components/giga-panel/user360/ProfileTab'
import { ImpersonateDialog } from '@/components/giga-panel/user360/ImpersonateDialog'
import { DataEntryModal } from '@/components/giga-panel/user360/DataEntryModal'
import { SurveyReminderDialog } from '@/components/giga-panel/user360/SurveyReminderDialog'
import { SurveyStatusChips } from '@/components/survey/SurveyStatusChips'
import { rememberUser } from '@/components/giga-panel/CommandPalette'

// The tabs (one is open at a time) load when they are opened, not with the card (W4).
const TabLoading = () => <Skeleton className="h-64" />
const SurveyTab = dynamic(() => import('@/components/giga-panel/user360/SurveyTab').then((m) => m.SurveyTab), { loading: TabLoading })
const GriTab = dynamic(() => import('@/components/giga-panel/user360/GriTab').then((m) => m.GriTab), { loading: TabLoading })
const ActivityTab = dynamic(() => import('@/components/giga-panel/user360/ActivityTab').then((m) => m.ActivityTab), { loading: TabLoading })
const JourneyTab = dynamic(() => import('@/components/giga-panel/user360/JourneyTab').then((m) => m.JourneyTab), { loading: TabLoading })
const DocumentsTab = dynamic(() => import('@/components/giga-panel/user360/DocumentsTab').then((m) => m.DocumentsTab), { loading: TabLoading })
const HistoryTab = dynamic(() => import('@/components/giga-panel/user360/HistoryTab').then((m) => m.HistoryTab), { loading: TabLoading })
const NotesTab = dynamic(() => import('@/components/giga-panel/user360/NotesTab').then((m) => m.NotesTab), { loading: TabLoading })
const EmailsTab = dynamic(() => import('@/components/giga-panel/user360/EmailsTab').then((m) => m.EmailsTab), { loading: TabLoading })
const QualityTab = dynamic(() => import('@/components/giga-panel/user360/QualityTab').then((m) => m.QualityTab), { loading: TabLoading })
const TasksTab = dynamic(() => import('@/components/giga-panel/user360/TasksTab').then((m) => m.TasksTab), { loading: TabLoading })
const TimelineTab = dynamic(() => import('@/components/giga-panel/user360/TimelineTab').then((m) => m.TimelineTab), { loading: TabLoading })
const GriDynamicsPanel = dynamic(() => import('@/components/giga-panel/user360/GriDynamicsPanel').then((m) => m.GriDynamicsPanel), { loading: TabLoading })
const PointATab = dynamic(() => import('@/components/giga-panel/user360/PointATab').then((m) => m.PointATab), { loading: TabLoading })
const PointBTab = dynamic(() => import('@/components/giga-panel/user360/PointBTab').then((m) => m.PointBTab), { loading: TabLoading })
const PulseTab = dynamic(() => import('@/components/giga-panel/user360/PulseTab').then((m) => m.PulseTab), { loading: TabLoading })
const CasesTab = dynamic(() => import('@/components/giga-panel/user360/CasesTab').then((m) => m.CasesTab), { loading: TabLoading })
const MessagesTab = dynamic(() => import('@/components/giga-panel/user360/MessagesTab').then((m) => m.MessagesTab), { loading: TabLoading })
const CommentsTab = dynamic(() => import('@/components/giga-panel/user360/CommentsTab').then((m) => m.CommentsTab), { loading: TabLoading })
const ReviewTab = dynamic(() => import('@/components/giga-panel/user360/review/ReviewTab').then((m) => m.ReviewTab), { loading: TabLoading })

type TabKey = 'profile' | 'messages' | 'timeline' | 'survey' | 'point-a' | 'point-b' | 'gri' | 'pulse' | 'cases' | 'comments' | 'review' | 'activity' | 'cjm' | 'documents' | 'notes' | 'tasks' | 'emails' | 'quality' | 'history'

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
  const [remindOpen, setRemindOpen] = useState(false)
  const u = data?.data
  // Экспертные вкладки (перенесены из старого портала эксперта): читать может
  // каждый, кто видит пользователя и его данные; править — только clients.review.
  const expertTabs = !!u && can('users.view') && u.can.sensitive
  const canReview = !!u?.can.review

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
            {u && can('users.invite') && u.can.sensitive && u.survey.startedSteps < u.survey.totalSteps && (
              <Button variant="secondary" icon={<BellRing size={13} />} onClick={() => setRemindOpen(true)}>Напомнить про анкету</Button>
            )}
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
          {/* The questionnaire mode, express status, full submitted (survey Ф5). */}
          {u.surveyStatus && <div className="mb-3"><SurveyStatusChips status={u.surveyStatus} /></div>}
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
              { key: 'timeline', label: 'Лента' },
              { key: 'messages', label: 'Сообщения', hidden: !can('inbox.view') },
              { key: 'survey', label: 'Анкета', hidden: !u.can.viewSurvey },
              { key: 'point-a', label: 'Точка А', hidden: !expertTabs },
              { key: 'point-b', label: 'Точка Б', hidden: !expertTabs },
              { key: 'gri', label: 'GRI', count: u.gri.runs, hidden: !(can('gri.view') && u.can.sensitive) },
              { key: 'pulse', label: 'Пульс', hidden: !expertTabs },
              { key: 'cases', label: 'Кейсы', hidden: !expertTabs },
              { key: 'comments', label: 'Комментарии', hidden: !expertTabs },
              { key: 'review', label: 'Разбор', hidden: !canReview },
              { key: 'activity', label: 'Активность', count: u.counters.events, hidden: !u.can.activity },
              { key: 'cjm', label: 'CJM' },
              { key: 'documents', label: 'Документы', count: u.counters.documents, hidden: !u.can.sensitive },
              { key: 'notes', label: 'Заметки', hidden: !u.can.sensitive },
              { key: 'tasks', label: 'Задачи', hidden: !u.can.sensitive },
              { key: 'emails', label: 'Письма', hidden: !u.can.sensitive },
              { key: 'quality', label: 'Качество данных', hidden: !u.can.viewSurvey },
              { key: 'history', label: 'История', hidden: !u.can.audit },
            ]}
          />
          {tab === 'profile' && <ProfileTab data={u} onChanged={reload} onPurged={() => router.replace(`${base}/users`)} />}
          {tab === 'timeline' && <TimelineTab userId={id} />}
          {tab === 'messages' && can('inbox.view') && <MessagesTab userId={id} />}
          {tab === 'survey' && u.can.viewSurvey && <SurveyTab userId={id} canEdit={u.can.editSurvey} surveyStatus={u.surveyStatus ?? null} />}
          {tab === 'gri' && (
            <>
              <GriDynamicsPanel userId={id} industry={u.company?.industry ?? null} />
              <GriTab userId={id} canEdit={u.can.editGri} canDelete={u.can.deleteGri} />
            </>
          )}
          {tab === 'point-a' && expertTabs && <PointATab userId={id} canReview={canReview} />}
          {tab === 'point-b' && expertTabs && <PointBTab userId={id} canReview={canReview} />}
          {tab === 'pulse' && expertTabs && <PulseTab userId={id} />}
          {tab === 'cases' && expertTabs && <CasesTab userId={id} canReview={canReview} />}
          {tab === 'comments' && expertTabs && <CommentsTab userId={id} canReview={canReview} />}
          {tab === 'review' && canReview && <ReviewTab userId={id} />}
          {tab === 'activity' && u.can.activity && <ActivityTab userId={id} />}
          {tab === 'cjm' && <JourneyTab userId={id} journey={u.journey} canActivity={u.can.activity} />}
          {tab === 'documents' && u.can.sensitive && <DocumentsTab userId={id} />}
          {tab === 'notes' && u.can.sensitive && <NotesTab userId={id} />}
          {tab === 'tasks' && u.can.sensitive && <TasksTab userId={id} />}
          {tab === 'emails' && u.can.sensitive && <EmailsTab userId={id} />}
          {tab === 'quality' && u.can.viewSurvey && <QualityTab userId={id} />}
          {tab === 'history' && u.can.audit && <HistoryTab userId={id} />}
          <SurveyReminderDialog
            open={remindOpen}
            onClose={() => setRemindOpen(false)}
            userId={id}
            userLabel={title}
            survey={u.survey}
            onSent={reload}
          />
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
