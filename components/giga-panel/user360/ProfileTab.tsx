'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Archive, Ban, KeyRound, LayoutGrid, RotateCcw, ShieldOff, Trash2, UserCog } from 'lucide-react'
import { Badge, Button, ConfirmDialog, Field, GigaApiError, Panel, Select, Timeline, fmtAgo, fmtDateTime, gigaFetch, inputClass } from '../kit'
import { AccessControls } from '../UserDetailPanel'
import { UserSettingsModal } from '../UserSettingsModal'
import { ALL_WIDGETS } from '@/stores/gigaPanel.store'
import { STAFF_ROLE_LABELS, STAFF_ROLES, type StaffRole } from '@/lib/admin/rbac'
import { PROFILE_ROLE, PROFILE_STATUS } from '@/lib/admin/labels'
import type { User360Profile } from './types'

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-2 py-1.5 text-xs">
      <dt className="text-slate-500">{label}</dt>
      <dd className="min-w-0 break-words text-slate-200">{value ?? '—'}</dd>
    </div>
  )
}

type Pending = null | 'block' | 'unblock' | 'archive' | 'restore' | '2fa' | 'role' | 'purge'

const PURGE_COUNT_LABELS: Record<string, string> = {
  companies: 'компаний', documents: 'документов', files: 'файлов', survey_answers: 'ответов анкеты',
  gri_assessments: 'прохождений GRI', diagnostics: 'диагностик', ai_conversations: 'ИИ-диалогов',
}

export function ProfileTab({ data, onChanged, onPurged }: { data: User360Profile; onChanged: () => void; onPurged?: () => void }) {
  const p = data.profile
  const [pending, setPending] = useState<Pending>(null)
  const [busy, setBusy] = useState(false)
  const [reason, setReason] = useState('')
  const [role, setRole] = useState<StaffRole | ''>(data.staffRole ?? '')
  const [widgetsOpen, setWidgetsOpen] = useState(false)
  const [purgeCounts, setPurgeCounts] = useState<Record<string, number> | null>(null)

  const openPurge = () => {
    setPurgeCounts(null)
    setPending('purge')
    gigaFetch<{ counts: Record<string, number> }>(`/api/giga-admin/users/${p.id}/purge`)
      .then((r) => setPurgeCounts(r.counts))
      .catch((e) => toast.error(e instanceof GigaApiError ? e.message : 'Не удалось получить объём данных'))
  }

  const purge = async () => {
    setBusy(true)
    try {
      const r = await gigaFetch<{ filesFailed: number }>(`/api/giga-admin/users/${p.id}/purge`, { method: 'POST', json: { confirmEmail: p.email, reason } })
      toast.success(r.filesFailed ? `Пользователь удалён, но ${r.filesFailed} файл(ов) не удалось стереть из хранилища` : 'Пользователь удалён навсегда')
      setPending(null)
      onPurged?.()
    } catch (e) {
      toast.error(e instanceof GigaApiError ? e.message : 'Удаление не выполнено')
    } finally {
      setBusy(false)
    }
  }

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true)
    try {
      await fn()
      toast.success(ok)
      setPending(null)
      setReason('')
      onChanged()
    } catch (e) {
      toast.error(e instanceof GigaApiError ? e.message : 'Операция не выполнена')
    } finally {
      setBusy(false)
    }
  }

  const blocked = p.status === 'blocked'
  const archived = p.status === 'archived'
  const j = data.journey

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Panel title="Профиль" className="lg:col-span-2">
        <dl className="divide-y divide-white/[0.04]">
          <Row label="Имя" value={p.full_name} />
          <Row label="Email" value={p.email} />
          <Row label="Телефон" value={p.phone} />
          <Row label="Должность" value={p.position} />
          <Row label="Организация" value={data.company?.name ?? p.organization} />
          <Row label="Отрасль" value={data.company?.industry ?? data.survey.hero.industry} />
          <Row label="Роль в системе" value={<span className="flex flex-wrap gap-1"><Badge>{PROFILE_ROLE[p.role] ?? p.role}</Badge>{data.staffRole && <Badge tone="violet">{STAFF_ROLE_LABELS[data.staffRole]}</Badge>}</span>} />
          <Row label="Статус" value={<Badge tone={PROFILE_STATUS[p.status]?.tone}>{PROFILE_STATUS[p.status]?.label ?? p.status}</Badge>} />
          <Row label="Тариф" value={p.tier === 'pro' ? 'Pro' : 'Free'} />
          <Row label="Регистрация" value={fmtDateTime(p.created_at)} />
          <Row label="Доступ открыт" value={fmtDateTime(p.approved_at)} />
          <Row label="Последняя активность" value={`${fmtAgo(p.last_seen_at)}${p.last_seen_at ? ` (${fmtDateTime(p.last_seen_at)})` : ''}`} />
          <Row label="ID" value={<span className="font-mono text-[11px] text-slate-400">{p.id}</span>} />
        </dl>
      </Panel>

      <Panel title="Путь клиента" description={j.current ? `Сейчас: ${j.current.label}${j.daysInStage != null ? ` · ${j.daysInStage} дн` : ''}` : 'Нет данных'}>
        <Timeline
          items={j.stages.filter((s) => s.done).map((s) => ({ id: s.key, at: s.at!, title: s.label, tone: 'green' as const }))}
          emptyText="Пользователь ещё не начал путь"
        />
        {j.next && <p className="mt-3 rounded-lg border border-blue-500/20 bg-blue-500/[0.06] px-3 py-2 text-[11px] text-blue-200">Следующий шаг: {j.next.label}</p>}
      </Panel>

      {data.can.manage && (
        <Panel title="Доступ и тариф" className="lg:col-span-2">
          <AccessControls userId={p.id} />
        </Panel>
      )}

      <Panel title="Действия" description="Каждое действие записывается в журнал">
        <div className="flex flex-col gap-2">
          {data.can.manage && !archived && (
            blocked
              ? <Button variant="secondary" icon={<RotateCcw size={13} />} onClick={() => setPending('unblock')}>Разблокировать</Button>
              : <Button variant="danger" icon={<Ban size={13} />} onClick={() => setPending('block')}>Заблокировать</Button>
          )}
          {data.can.manage && <Button variant="secondary" icon={<ShieldOff size={13} />} onClick={() => setPending('2fa')}>Сбросить 2FA</Button>}
          {data.can.manage && <Button variant="secondary" icon={<LayoutGrid size={13} />} onClick={() => setWidgetsOpen(true)}>Виджеты кабинета</Button>}
          {data.can.roles && <Button variant="secondary" icon={<UserCog size={13} />} onClick={() => setPending('role')}>Роль персонала</Button>}
          {data.can.archive && (
            archived
              ? <Button variant="secondary" icon={<RotateCcw size={13} />} onClick={() => setPending('restore')}>Восстановить из архива</Button>
              : <Button variant="danger" icon={<Archive size={13} />} onClick={() => setPending('archive')}>Архивировать (удалить)</Button>
          )}
          {data.can.purge && p.email && <Button variant="danger" icon={<Trash2 size={13} />} onClick={openPurge}>Удалить навсегда</Button>}
          {!data.can.manage && !data.can.archive && !data.can.roles && !data.can.purge && <p className="text-xs text-slate-500">Для вашей роли действия недоступны.</p>}
        </div>
      </Panel>

      <ConfirmDialog
        open={pending === 'block'}
        onClose={() => setPending(null)}
        title="Заблокировать пользователя?"
        text="Вход будет закрыт немедленно: статус «заблокирован» и бан сессий. Данные сохраняются. Причина попадёт в журнал действий."
        confirmLabel="Заблокировать"
        loading={busy}
        onConfirm={() => run(() => gigaFetch(`/api/giga-admin/users/${p.id}/block`, { method: 'POST', json: { reason } }), 'Пользователь заблокирован')}
      >
        <Field label="Причина"><input value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass} maxLength={300} placeholder="Например: спам, нарушение правил" /></Field>
      </ConfirmDialog>
      <ConfirmDialog
        open={pending === 'unblock'}
        onClose={() => setPending(null)}
        tone="primary"
        title="Разблокировать пользователя?"
        confirmLabel="Разблокировать"
        loading={busy}
        onConfirm={() => run(() => gigaFetch(`/api/giga-admin/users/${p.id}/unblock`, { method: 'POST', json: { reason } }), 'Пользователь разблокирован')}
      >
        <Field label="Причина (необязательно)"><input value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass} maxLength={300} /></Field>
      </ConfirmDialog>
      <ConfirmDialog
        open={pending === '2fa'}
        onClose={() => setPending(null)}
        tone="warning"
        title="Сбросить двухфакторную защиту?"
        text="TOTP, ключи WebAuthn и резервные коды будут удалены. Пользователь получит письмо."
        confirmLabel="Сбросить 2FA"
        requireText="СБРОС"
        loading={busy}
        onConfirm={() => run(() => gigaFetch(`/api/giga-admin/users/${p.id}/2fa-reset`, { method: 'POST', json: {} }), '2FA сброшена')}
      />
      <ConfirmDialog
        open={pending === 'archive' || pending === 'restore'}
        onClose={() => setPending(null)}
        title={pending === 'archive' ? 'Архивировать пользователя?' : 'Восстановить пользователя?'}
        text={pending === 'archive'
          ? 'Аккаунт будет закрыт (статус «в архиве», бан входа), открытые сессии «от имени» завершатся. Данные не удаляются и восстанавливаются отсюда же.'
          : 'Аккаунт получит статус «одобрен», вход будет открыт.'}
        confirmLabel={pending === 'archive' ? 'Архивировать' : 'Восстановить'}
        tone={pending === 'archive' ? 'danger' : 'primary'}
        requireText={pending === 'archive' ? 'АРХИВ' : undefined}
        loading={busy}
        onConfirm={() => run(
          () => gigaFetch(`/api/giga-admin/users/${p.id}/archive`, { method: 'POST', json: { action: pending === 'archive' ? 'archive' : 'restore', reason } }),
          pending === 'archive' ? 'Пользователь в архиве' : 'Пользователь восстановлен',
        )}
      >
        <Field label="Причина"><input value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass} maxLength={300} /></Field>
      </ConfirmDialog>
      <ConfirmDialog
        open={pending === 'purge'}
        onClose={() => setPending(null)}
        title="Удалить пользователя навсегда?"
        text={<>
          Учётная запись, профиль, компания, анкета, GRI, документы и файлы будут <b className="text-rose-300">удалены из платформы и базы без возможности восстановления</b>. В журнале останется только запись об удалении. Если нужно просто закрыть доступ — используйте архивацию.
          <span className="mt-2 block text-slate-300">
            {purgeCounts
              ? `Будет удалено: ${Object.entries(purgeCounts).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${PURGE_COUNT_LABELS[k] ?? k}`).join(', ') || 'только учётная запись'}.`
              : 'Считаю объём данных…'}
          </span>
        </>}
        confirmLabel="Удалить навсегда"
        requireText={p.email ?? undefined}
        loading={busy}
        onConfirm={purge}
      >
        <Field label="Причина"><input value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass} maxLength={300} /></Field>
      </ConfirmDialog>
      <ConfirmDialog
        open={pending === 'role'}
        onClose={() => setPending(null)}
        tone="warning"
        title="Роль персонала"
        text="Роль даёт доступ к GIGA-CRM. Права каждой роли — в разделе «Роли и права»."
        confirmLabel="Сохранить роль"
        loading={busy}
        onConfirm={() => run(
          () => gigaFetch(`/api/giga-admin/users/${p.id}/staff-role`, { method: 'PUT', json: { role: role || null, reason } }),
          role ? `Роль «${STAFF_ROLE_LABELS[role]}» сохранена` : 'Роль снята',
        )}
      >
        <div className="space-y-3">
          <Select
            label="Роль"
            value={role}
            onChange={setRole}
            options={[{ value: '' as const, label: 'Без роли (обычный пользователь)' }, ...STAFF_ROLES.map((r) => ({ value: r, label: STAFF_ROLE_LABELS[r] }))]}
          />
          <Field label="Причина"><input value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass} maxLength={300} /></Field>
          <p className="flex items-center gap-1.5 text-[11px] text-slate-500"><KeyRound size={12} /> Выдать роль можно только одобренному аккаунту.</p>
        </div>
      </ConfirmDialog>

      {widgetsOpen && (
        <UserSettingsModal
          isOpen={widgetsOpen}
          user={{ id: p.id, name: p.full_name, email: p.email ?? '', role: p.role, status: 'active', lastLogin: p.last_seen_at, createdAt: p.created_at, widgets: Array.isArray(p.widget_config) ? (p.widget_config as string[]) : ALL_WIDGETS.map((w) => w.id) }}
          onClose={() => setWidgetsOpen(false)}
          onSave={async (_id: string, widgets: string[]) => {
            await run(() => gigaFetch(`/api/giga-admin/users/${p.id}/widgets`, { method: 'POST', json: { widgets } }), 'Виджеты сохранены')
            setWidgetsOpen(false)
          }}
        />
      )}
    </div>
  )
}
