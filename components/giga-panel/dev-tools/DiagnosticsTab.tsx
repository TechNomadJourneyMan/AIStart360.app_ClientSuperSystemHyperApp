'use client'

import { useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { CheckCircle2, RefreshCw, XCircle } from 'lucide-react'
import { Badge, Button, ConfirmDialog, ErrorState, GigaApiError, Panel, Skeleton, fmtDateTime, gigaFetch, useGigaQuery } from '../kit'

interface Diagnostics {
  ok: true
  checkedAt: string
  build: {
    vercelEnv: string | null; nodeEnv: string | null; commitSha: string | null; commitShort: string | null; commitRef: string | null
    commitMessage: string | null; region: string | null; deploymentUrl: string | null; deploymentId: string | null; node: string; siteUrl: string
  }
  env: Array<{ label: string; key: string; required: boolean; configured: boolean }>
  session: {
    id: string; email: string | null; kind: string; realRole: string; realRoleLabel: string; effectiveRole: string; effectiveRoleLabel: string
    viewAsExpiresAt: string | null; permissions: string[]; clientScope: string
    mfa: { stepUpVerified: boolean; totpEnabled: boolean | null; passkeys: number | null; requiredForStaff: boolean | null }
    staffCookie: boolean
    impersonation: { active: true; sessionId: string; mode: string; target: string; expiresAt: string } | { active: false; reason: string | null }
  }
  impersonation: {
    error: string | null
    active: Array<{
      id: string; admin_id: string; admin_email: string | null; admin_role: string | null; target_user_id: string; mode: string; reason: string
      started_at: string; expires_at: string; target: { email: string | null; full_name: string | null } | null
    }>
  }
  migrations: {
    error: string | null
    last: Array<{ file: string; applied_at: string | null; applied_by?: string | null }>
    devtools: { file: string; inLedger: boolean | null; isTestColumn: boolean | null; status: 'applied' | 'missing' | 'unknown' }
  }
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-white/[0.04] py-1.5 last:border-0">
      <span className="text-[11px] text-slate-500">{label}</span>
      <span className="min-w-0 break-all text-right text-[11px] text-slate-200">{children ?? '—'}</span>
    </div>
  )
}

function Yes({ ok, yes = 'да', no = 'нет' }: { ok: boolean | null | undefined; yes?: string; no?: string }) {
  if (ok == null) return <span className="text-slate-500">неизвестно</span>
  return ok ? <span className="text-emerald-300">{yes}</span> : <span className="text-amber-300">{no}</span>
}

/** Сборка, окружение, моя сессия, сессии «от имени», журнал миграций. */
export function DiagnosticsTab() {
  const { data, error, loading, reload } = useGigaQuery<Diagnostics>('/api/giga-admin/dev-tools/diagnostics')
  const [confirmAll, setConfirmAll] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const endAll = async () => {
    setBusy('all')
    try {
      const res = await gigaFetch<{ ended: number }>('/api/giga-admin/dev-tools/impersonation/end-all', { method: 'POST', json: {} })
      toast.success(`Завершено сессий: ${res.ended}`)
      setConfirmAll(false)
      void reload()
    } catch (e) {
      toast.error(e instanceof GigaApiError ? e.message : 'Не удалось завершить')
    } finally {
      setBusy(null)
    }
  }

  const endOne = async (id: string) => {
    setBusy(id)
    try {
      await gigaFetch(`/api/giga-admin/impersonation/${id}/end`, { method: 'POST', json: {} })
      toast.success('Сессия завершена')
      void reload()
    } catch (e) {
      toast.error(e instanceof GigaApiError ? e.message : 'Не удалось завершить')
    } finally {
      setBusy(null)
    }
  }

  if (loading && !data) return <div className="grid gap-4 lg:grid-cols-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-48" />)}</div>
  const d = data
  const envMissing = d?.env.filter((e) => e.required && !e.configured).length ?? 0
  const m120 = d?.migrations.devtools

  return (
    <div className="space-y-4">
      <ErrorState error={error} onRetry={reload} />
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-slate-500">{d ? `Проверено ${fmtDateTime(d.checkedAt)}` : ''}</p>
        <Button size="sm" icon={<RefreshCw size={12} />} loading={loading} onClick={() => reload()}>Обновить</Button>
      </div>
      {d && (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Сборка">
              <Row label="Окружение Vercel">{d.build.vercelEnv ?? 'локально'}</Row>
              <Row label="NODE_ENV">{d.build.nodeEnv}</Row>
              <Row label="Коммит">{d.build.commitShort ? <span className="font-mono" title={d.build.commitSha ?? ''}>{d.build.commitShort}</span> : null}</Row>
              <Row label="Ветка">{d.build.commitRef}</Row>
              <Row label="Сообщение коммита">{d.build.commitMessage}</Row>
              <Row label="Регион">{d.build.region}</Row>
              <Row label="Деплой">{d.build.deploymentUrl}</Row>
              <Row label="Адрес приложения">{d.build.siteUrl}</Row>
              <Row label="Node.js">{d.build.node}</Row>
            </Panel>

            <Panel title="Моя сессия">
              <Row label="Аккаунт">{d.session.email ?? d.session.id}</Row>
              <Row label="Вход">{d.session.kind === 'session' ? 'личная сессия' : 'staff-cookie (вход «от имени»)'}</Row>
              <Row label="Настоящая роль">{d.session.realRoleLabel}</Row>
              <Row label="Действующая роль">
                {d.session.effectiveRole !== d.session.realRole
                  ? <Badge tone="amber">{d.session.effectiveRoleLabel} · «как роль»{d.session.viewAsExpiresAt ? ` до ${fmtDateTime(d.session.viewAsExpiresAt)}` : ''}</Badge>
                  : d.session.effectiveRoleLabel}
              </Row>
              <Row label="Прав у действующей роли">{d.session.permissions.length}</Row>
              <Row label="Второй фактор подтверждён"><Yes ok={d.session.mfa.stepUpVerified} /></Row>
              <Row label="TOTP включён"><Yes ok={d.session.mfa.totpEnabled} /></Row>
              <Row label="Ключи доступа (passkeys)">{d.session.mfa.passkeys ?? '—'}</Row>
              <Row label="2FA обязательна для персонала"><Yes ok={d.session.mfa.requiredForStaff} /></Row>
              <Row label="Сессия «от имени» в этом браузере">
                {d.session.impersonation.active
                  ? <Badge tone="amber">{d.session.impersonation.target} · {d.session.impersonation.mode === 'edit' ? 'правка' : 'просмотр'}</Badge>
                  : 'нет'}
              </Row>
            </Panel>
          </div>

          <Panel
            title="Переменные окружения"
            description="Только факт настройки — значения не показываются никогда."
            actions={envMissing ? <Badge tone="red">не хватает обязательных: {envMissing}</Badge> : <Badge tone="green">обязательные заданы</Badge>}
          >
            <div className="grid gap-x-6 sm:grid-cols-2">
              {d.env.map((e) => (
                <div key={e.key} className="flex items-center gap-2 border-b border-white/[0.04] py-1.5">
                  {e.configured ? <CheckCircle2 size={13} className="shrink-0 text-emerald-400" /> : <XCircle size={13} className={e.required ? 'shrink-0 text-red-400' : 'shrink-0 text-slate-600'} />}
                  <span className="min-w-0 flex-1 truncate text-[11px] text-slate-300" title={e.key}>{e.label}</span>
                  <span className="font-mono text-[10px] text-slate-600">{e.key}</span>
                  {e.required && !e.configured && <Badge tone="red">обязательно</Badge>}
                </div>
              ))}
            </div>
          </Panel>

          <Panel
            title={`Открытые сессии «от имени» · ${d.impersonation.active.length}`}
            actions={
              <>
                <Link href="/admin-giga-panel/impersonation" className="text-[11px] text-blue-300 hover:underline">Журнал сессий</Link>
                <Button size="sm" variant="danger" disabled={!d.impersonation.active.length} loading={busy === 'all'} onClick={() => setConfirmAll(true)}>Завершить все</Button>
              </>
            }
          >
            {d.impersonation.error && <p className="text-xs text-red-300">{d.impersonation.error}</p>}
            {!d.impersonation.active.length && !d.impersonation.error && <p className="text-xs text-slate-500">Открытых сессий нет.</p>}
            <div className="space-y-2">
              {d.impersonation.active.map((s) => (
                <div key={s.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-white/[0.06] px-3 py-2 text-[11px]">
                  <Badge tone={s.mode === 'edit' ? 'red' : 'blue'}>{s.mode === 'edit' ? 'правка' : 'просмотр'}</Badge>
                  <span className="text-slate-200">{s.target?.full_name || s.target?.email || s.target_user_id}</span>
                  <span className="text-slate-500">← {s.admin_email || s.admin_id}</span>
                  <span className="min-w-0 flex-1 truncate text-slate-500">{s.reason}</span>
                  <span className="whitespace-nowrap text-slate-500">до {fmtDateTime(s.expires_at)}</span>
                  <Button size="sm" variant="danger" loading={busy === s.id} onClick={() => endOne(s.id)}>Завершить</Button>
                </div>
              ))}
            </div>
          </Panel>

          <Panel
            title="Миграции базы"
            description="Последние 10 записей журнала public.schema_migrations (пишет scripts/apply-migration.js)."
            actions={m120 && (
              <Badge tone={m120.status === 'applied' ? 'green' : m120.status === 'missing' ? 'red' : 'neutral'}>
                120 (фильтр контента, тест-аккаунты): {m120.status === 'applied' ? 'применена' : m120.status === 'missing' ? 'НЕ применена' : 'неизвестно'}
              </Badge>
            )}
          >
            {d.migrations.error && <p className="mb-2 text-xs text-red-300">{d.migrations.error}</p>}
            {m120 && m120.status !== 'applied' && (
              <p className="mb-3 rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2 font-mono text-[11px] text-amber-200">
                node scripts/apply-migration.js supabase/migrations/{m120.file}
              </p>
            )}
            <div className="space-y-1">
              {d.migrations.last.map((m) => (
                <div key={m.file} className="flex items-center justify-between gap-3 border-b border-white/[0.04] py-1.5 text-[11px]">
                  <span className="font-mono text-slate-200">{m.file}</span>
                  <span className="whitespace-nowrap text-slate-500">{fmtDateTime(m.applied_at)}{m.applied_by ? ` · ${m.applied_by}` : ''}</span>
                </div>
              ))}
            </div>
          </Panel>
        </>
      )}
      <ConfirmDialog
        open={confirmAll}
        onClose={() => setConfirmAll(false)}
        onConfirm={endAll}
        loading={busy === 'all'}
        title="Завершить все сессии «от имени»?"
        text="Все открытые сессии любых сотрудников будут закрыты; браузеры выйдут из кабинетов клиентов в течение нескольких секунд."
        confirmLabel="Завершить все"
      />
    </div>
  )
}
