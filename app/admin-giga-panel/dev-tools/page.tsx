'use client'

import { Suspense } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useStaff } from '@/components/giga-panel/StaffContext'
import { PageHeader, Tabs } from '@/components/giga-panel/kit'
import { ViewAsTab } from '@/components/giga-panel/dev-tools/ViewAsTab'
import { TestAccountsTab } from '@/components/giga-panel/dev-tools/TestAccountsTab'
import { PermissionsTab } from '@/components/giga-panel/dev-tools/PermissionsTab'
import { DiagnosticsTab } from '@/components/giga-panel/dev-tools/DiagnosticsTab'
import { ToolsTab } from '@/components/giga-panel/dev-tools/ToolsTab'

const TABS = [
  { key: 'view-as', label: 'Как роль' },
  { key: 'accounts', label: 'Тест-аккаунты' },
  { key: 'permissions', label: 'Права' },
  { key: 'diagnostics', label: 'Диагностика' },
  { key: 'tools', label: 'Инструменты' },
] as const
type TabKey = (typeof TABS)[number]['key']

function isTab(v: string | null): v is TabKey {
  return TABS.some((t) => t.key === v)
}

function Inner() {
  const sp = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const raw = sp.get('tab')
  const tab: TabKey = isTab(raw) ? raw : 'view-as'
  const setTab = (t: TabKey) => router.replace(`${pathname}?tab=${t}`, { scroll: false })

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'GIGA-CRM', href: '/admin-giga-panel' }, { label: 'Dev-tools' }]}
        title="Dev-tools"
        description="Инструменты разработчика платформы: панель глазами другой роли, тестовые аккаунты, матрица прав, диагностика и проверка уведомлений. Только Super Admin; каждое действие пишется в журнал."
      />
      <Tabs tabs={TABS} value={tab} onChange={setTab} className="mb-5" />
      {tab === 'view-as' && <ViewAsTab />}
      {tab === 'accounts' && <TestAccountsTab />}
      {tab === 'permissions' && <PermissionsTab />}
      {tab === 'diagnostics' && <DiagnosticsTab />}
      {tab === 'tools' && <ToolsTab />}
    </>
  )
}

/**
 * Доступ: право devtools.use (только Super Admin). Пока Super Admin смотрит
 * панель «как роль», у действующей роли этого права нет — но страница остаётся
 * открытой по НАСТОЯЩЕЙ роли (её API тоже проверяют настоящую роль), чтобы из
 * режима всегда можно было вернуться.
 */
export default function DevToolsPage() {
  const { can, me, loading } = useStaff()
  if (loading) return null
  if (!can('devtools.use') && me?.realRole !== 'super_admin') {
    return (
      <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] px-5 py-8 text-center">
        <p className="text-sm font-semibold text-amber-200">Раздел недоступен для вашей роли</p>
        <p className="mt-1 text-xs text-slate-500">Dev-tools доступны только Super Admin.</p>
      </div>
    )
  }
  return <Suspense fallback={null}><Inner /></Suspense>
}
