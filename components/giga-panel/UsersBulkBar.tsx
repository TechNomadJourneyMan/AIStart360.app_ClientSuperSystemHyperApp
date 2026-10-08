'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { BellRing, X } from 'lucide-react'
import { useStaff } from './StaffContext'
import { Button, ConfirmDialog, Field, GigaApiError, cx, gigaFetch, inputClass } from './kit'
import { PROFILE_STATUS } from '@/lib/admin/labels'
import { BULK_ACTION_LABELS, BULK_MAX, BULK_PERMISSIONS, type BulkAction } from '@/lib/admin/bulk-users-shared'

/**
 * Панель массовых действий в списке пользователей: «Выбрано N» + меню
 * действий → предпросмотр (сколько в каком статусе, сколько сотрудников
 * будет пропущено) → отчёт с ошибками по каждому, кто не прошёл.
 */

export interface BulkUser { id: string; label: string; status: string; staffRole: string | null; surveySteps: number }
interface Staff { id: string; name: string; roleLabel: string }
interface Result { id: string; ok: boolean; error: string | null; skipped?: boolean }

const MENU: BulkAction[] = ['approve', 'reject', 'assign', 'set_tier', 'block', 'archive']
const DANGER = new Set<BulkAction>(['reject', 'block', 'archive'])

export function UsersBulkBar({ users, staff, onClear, onDone, onRemind, remindable }: {
  users: BulkUser[]
  staff: Staff[]
  onClear: () => void
  onDone: () => void
  onRemind?: () => void
  remindable: number
}) {
  const { can } = useStaff()
  const allowed = MENU.filter((a) => BULK_PERMISSIONS[a].every((p) => can(p)))
  const [action, setAction] = useState<BulkAction | null>(null)
  const [reason, setReason] = useState('')
  const [tier, setTier] = useState<'free' | 'pro'>('pro')
  const [assignee, setAssignee] = useState('')
  const [busy, setBusy] = useState(false)

  const byStatus = useMemo(() => {
    const m = new Map<string, number>()
    for (const u of users) m.set(u.status, (m.get(u.status) ?? 0) + 1)
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1])
  }, [users])
  const staffCount = users.filter((u) => u.staffRole).length

  if (!users.length) return null

  const close = () => { setAction(null); setReason(''); setAssignee('') }
  const needsReason = action === 'archive'
  const tooMany = users.length > BULK_MAX

  const run = async () => {
    if (!action) return
    if (needsReason && reason.trim().length < 3) {
      toast.error('Укажите причину архивации')
      return
    }
    setBusy(true)
    try {
      const r = await gigaFetch<{ results: Result[]; done: number; failed: number }>('/api/giga-admin/users/bulk', {
        method: 'POST',
        json: {
          action,
          ids: users.map((u) => u.id),
          ...(reason.trim() ? { reason: reason.trim() } : {}),
          ...(action === 'set_tier' ? { tier } : {}),
          ...(action === 'assign' ? { assigneeId: assignee || null } : {}),
        },
      })
      const failed = r.results.filter((x) => !x.ok)
      const labelOf = new Map(users.map((u) => [u.id, u.label]))
      const lines = failed.slice(0, 5).map((f) => `${labelOf.get(f.id) ?? f.id}: ${f.error ?? 'ошибка'}`)
      if (failed.length) {
        toast.warning(`${BULK_ACTION_LABELS[action]}: выполнено ${r.done} из ${r.results.length}`, {
          description: lines.join('\n') + (failed.length > 5 ? `\n…и ещё ${failed.length - 5}` : ''),
          duration: 12_000,
        })
      } else {
        toast.success(`${BULK_ACTION_LABELS[action]}: выполнено для ${r.done}`)
      }
      close()
      onDone()
    } catch (e) {
      toast.error(e instanceof GigaApiError ? e.message : 'Массовое действие не выполнено')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="sticky bottom-4 z-30 mt-3 flex flex-wrap items-center gap-2 rounded-2xl border border-blue-500/25 bg-slate-950/95 px-4 py-3 shadow-2xl backdrop-blur" role="region" aria-label="Массовые действия">
        <span className="text-xs font-semibold text-slate-100">Выбрано {users.length}</span>
        {tooMany && <span className="text-[11px] text-red-300">максимум {BULK_MAX} за раз</span>}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {onRemind && (
            <Button size="sm" variant="secondary" icon={<BellRing size={12} />} disabled={!remindable} onClick={onRemind} title="Только тем, у кого анкета не закончена">
              Напомнить ({remindable})
            </Button>
          )}
          {allowed.map((a) => (
            <Button key={a} size="sm" variant={DANGER.has(a) ? 'danger' : 'secondary'} disabled={tooMany} onClick={() => setAction(a)}>
              {BULK_ACTION_LABELS[a]}
            </Button>
          ))}
          <Button size="sm" variant="ghost" icon={<X size={12} />} onClick={onClear} aria-label="Снять выделение">Снять</Button>
        </div>
      </div>

      <ConfirmDialog
        open={!!action}
        onClose={close}
        onConfirm={() => void run()}
        loading={busy}
        tone={action && DANGER.has(action) ? 'danger' : 'primary'}
        title={action ? `${BULK_ACTION_LABELS[action]}: ${users.length}` : ''}
        confirmLabel={action ? `${BULK_ACTION_LABELS[action]} (${users.length})` : 'Подтвердить'}
        text={
          <div className="space-y-2">
            <p>Действие применится к каждому выбранному отдельно; кого нельзя обработать — останется как есть и попадёт в отчёт.</p>
            <ul className="flex flex-wrap gap-1.5">
              {byStatus.map(([s, n]) => (
                <li key={s} className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[11px] text-slate-300">
                  {PROFILE_STATUS[s]?.label ?? s}: {n}
                </li>
              ))}
            </ul>
            {staffCount > 0 && (
              <p className="text-amber-300">Среди выбранных сотрудников: {staffCount}. Сотрудники вашего ранга и выше будут пропущены.</p>
            )}
            {action === 'approve' && <p>Одобряются только ожидающие, требующие уточнения и отклонённые; клиенты получат письмо «доступ открыт».</p>}
            {action === 'reject' && <p>Отклоняются только ожидающие решения; клиенты получат письмо с причиной, если она указана.</p>}
            {action === 'block' && <p>Вход будет закрыт сразу, активные сессии завершатся.</p>}
            {action === 'archive' && <p>Вход закрывается, данные сохраняются; восстановить можно из карточки.</p>}
          </div>
        }
      >
        {(action === 'reject' || action === 'archive' || action === 'block') && (
          <Field label={needsReason ? 'Причина (обязательно)' : 'Причина (необязательно)'}>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} rows={2} className={cx(inputClass, 'resize-none')} />
          </Field>
        )}
        {action === 'set_tier' && (
          <Field label="Тариф">
            <select value={tier} onChange={(e) => setTier(e.target.value as 'free' | 'pro')} className={inputClass}>
              <option value="pro">Pro</option>
              <option value="free">Free</option>
            </select>
          </Field>
        )}
        {action === 'assign' && (
          <Field label="Ответственный">
            <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className={inputClass}>
              <option value="">Снять ответственного</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.name} — {s.roleLabel}</option>)}
            </select>
          </Field>
        )}
        {needsReason && reason.trim().length < 3 && <p className="mt-2 text-[11px] text-amber-300">Укажите причину — без неё архивация не выполнится.</p>}
      </ConfirmDialog>
    </>
  )
}
