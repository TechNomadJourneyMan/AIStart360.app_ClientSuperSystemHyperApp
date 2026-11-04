'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { BellRing, X } from 'lucide-react'
import { useStaff } from './StaffContext'
import { Button, ConfirmDialog, Field, GigaApiError, Modal, cx, gigaFetch, inputClass } from './kit'
import { PROFILE_STATUS } from '@/lib/admin/labels'
import { BULK_ACTION_LABELS, BULK_MAX, BULK_PERMISSIONS, BULK_PURGE_CONFIRM, BULK_PURGE_MAX, type BulkAction } from '@/lib/admin/bulk-users-shared'

/**
 * Панель массовых действий в списке пользователей: «Выбрано N» + меню
 * действий → предпросмотр (сколько в каком статусе, сколько сотрудников
 * будет пропущено) → отчёт с ошибками по каждому, кто не прошёл.
 */

export interface BulkUser { id: string; label: string; email?: string | null; status: string; staffRole: string | null; surveySteps: number; isTest?: boolean }
interface Staff { id: string; name: string; roleLabel: string }
interface Result { id: string; ok: boolean; error: string | null; skipped?: boolean }

const MENU: BulkAction[] = ['approve', 'reject', 'assign', 'set_tier', 'block', 'unblock', 'archive', 'purge']
const DANGER = new Set<BulkAction>(['reject', 'block', 'archive', 'purge'])
/** Сколько email показать в подтверждении удаления. */
const PURGE_PREVIEW = 10

interface Report { action: BulkAction; total: number; done: number; failed: Array<{ label: string; error: string }>; warnings: Array<{ label: string; error: string }> }

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
  const [report, setReport] = useState<Report | null>(null)

  const byStatus = useMemo(() => {
    const m = new Map<string, number>()
    for (const u of users) m.set(u.status, (m.get(u.status) ?? 0) + 1)
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1])
  }, [users])
  const staffCount = users.filter((u) => u.staffRole).length
  const testCount = users.filter((u) => u.isTest).length

  if (!users.length && !report) return null

  const close = () => { setAction(null); setReason(''); setAssignee('') }
  const needsReason = action === 'archive' || action === 'purge'
  const tooMany = users.length > BULK_MAX
  const tooManyToPurge = users.length > BULK_PURGE_MAX

  const run = async () => {
    if (!action) return
    if (needsReason && reason.trim().length < 3) {
      toast.error(action === 'purge' ? 'Укажите причину удаления' : 'Укажите причину архивации')
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
          // Кнопка открывается только после ввода слова в диалоге (requireText).
          ...(action === 'purge' ? { confirm: BULK_PURGE_CONFIRM } : {}),
        },
      })
      const failed = r.results.filter((x) => !x.ok)
      const labelOf = new Map(users.map((u) => [u.id, action === 'purge' ? u.email || u.label : u.label]))
      if (action === 'purge') {
        // Необратимое действие — подробный отчёт в окне, а не во всплывашке.
        setReport({
          action,
          total: r.results.length,
          done: r.done,
          failed: failed.map((f) => ({ label: labelOf.get(f.id) ?? f.id, error: f.error ?? 'ошибка' })),
          warnings: r.results.filter((x) => x.ok && x.error).map((x) => ({ label: labelOf.get(x.id) ?? x.id, error: x.error as string })),
        })
        close()
        onDone()
        return
      }
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
      {users.length > 0 && <div className="sticky bottom-4 z-30 mt-3 flex flex-wrap items-center gap-2 rounded-2xl border border-blue-500/25 bg-slate-950/95 px-4 py-3 shadow-2xl backdrop-blur" role="region" aria-label="Массовые действия">
        <span className="text-xs font-semibold text-slate-100">Выбрано {users.length}</span>
        {tooMany && <span className="text-[11px] text-red-300">максимум {BULK_MAX} за раз</span>}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {onRemind && (
            <Button size="sm" variant="secondary" icon={<BellRing size={12} />} disabled={!remindable} onClick={onRemind} title="Только тем, у кого анкета не закончена">
              Напомнить ({remindable})
            </Button>
          )}
          {allowed.map((a) => (
            <Button
              key={a}
              size="sm"
              variant={DANGER.has(a) ? 'danger' : 'secondary'}
              disabled={tooMany || (a === 'purge' && tooManyToPurge)}
              title={a === 'purge' && tooManyToPurge ? `Удалять можно не больше ${BULK_PURGE_MAX} за раз` : undefined}
              onClick={() => setAction(a)}
            >
              {BULK_ACTION_LABELS[a]}
            </Button>
          ))}
          <Button size="sm" variant="ghost" icon={<X size={12} />} onClick={onClear} aria-label="Снять выделение">Снять</Button>
        </div>
      </div>}

      <ConfirmDialog
        open={!!action}
        onClose={close}
        onConfirm={() => void run()}
        loading={busy}
        tone={action && DANGER.has(action) ? 'danger' : 'primary'}
        title={action ? `${BULK_ACTION_LABELS[action]}: ${users.length}` : ''}
        confirmLabel={action ? `${BULK_ACTION_LABELS[action]} (${users.length})` : 'Подтвердить'}
        requireText={action === 'purge' ? BULK_PURGE_CONFIRM : undefined}
        text={
          <div className="space-y-2">
            {action === 'purge' && (
              <div className="space-y-2 rounded-lg border border-rose-500/25 bg-rose-500/[0.06] px-3 py-2 text-rose-200">
                <p>
                  Будет <b>удалено навсегда {users.length}</b> {users.length === 1 ? 'пользователь' : 'пользователей'}: учётная запись, профиль, компания, анкета, GRI,
                  документы и файлы. Восстановить нельзя — в журнале останется только запись об удалении. Если нужно просто закрыть доступ — используйте блокировку или архивацию.
                </p>
                <ul className="space-y-0.5 font-mono text-[11px] text-rose-100">
                  {users.slice(0, PURGE_PREVIEW).map((u) => <li key={u.id} className="truncate">{u.email || u.label}{u.isTest ? ' · тест' : ''}</li>)}
                  {users.length > PURGE_PREVIEW && <li className="font-sans text-rose-300">и ещё {users.length - PURGE_PREVIEW}</li>}
                </ul>
                {testCount > 0 && testCount < users.length && <p className="text-[11px]">Из них тестовых аккаунтов: {testCount}.</p>}
              </div>
            )}
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
            {action === 'unblock' && <p>Разблокируются только заблокированные: статус станет «одобрен», вход откроется.</p>}
            {action === 'purge' && <p>Super Admin и ваш собственный аккаунт удалить нельзя — они будут пропущены.</p>}
            {action === 'archive' && <p>Вход закрывается, данные сохраняются; восстановить можно из карточки.</p>}
          </div>
        }
      >
        {(action === 'reject' || action === 'archive' || action === 'block' || action === 'unblock' || action === 'purge') && (
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
        {needsReason && reason.trim().length < 3 && (
          <p className="mt-2 text-[11px] text-amber-300">Укажите причину — без неё {action === 'purge' ? 'удаление' : 'архивация'} не выполнится.</p>
        )}
      </ConfirmDialog>

      <Modal
        open={!!report}
        onClose={() => setReport(null)}
        title={report ? `${BULK_ACTION_LABELS[report.action]}: итог` : ''}
        footer={<Button variant="secondary" onClick={() => setReport(null)}>Закрыть</Button>}
      >
        {report && (
          <div className="space-y-3 text-xs text-slate-300">
            <p>
              Выполнено: <b className="text-emerald-300">{report.done}</b> из {report.total}
              {report.failed.length > 0 && <> · не выполнено: <b className="text-rose-300">{report.failed.length}</b></>}
            </p>
            {report.failed.length > 0 && (
              <ul className="max-h-60 space-y-1 overflow-y-auto">
                {report.failed.map((f, i) => (
                  <li key={i} className="rounded-lg border border-rose-500/20 bg-rose-500/[0.05] px-2 py-1">
                    <span className="font-mono text-[11px] text-slate-200">{f.label}</span> — <span className="text-rose-200">{f.error}</span>
                  </li>
                ))}
              </ul>
            )}
            {report.warnings.length > 0 && (
              <ul className="max-h-40 space-y-1 overflow-y-auto">
                {report.warnings.map((w, i) => (
                  <li key={i} className="rounded-lg border border-amber-500/20 bg-amber-500/[0.05] px-2 py-1">
                    <span className="font-mono text-[11px] text-slate-200">{w.label}</span> — <span className="text-amber-200">{w.error}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Modal>
    </>
  )
}
