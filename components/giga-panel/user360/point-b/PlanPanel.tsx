'use client'

/**
 * components/giga-panel/user360/point-b/PlanPanel.tsx — versions of the Point B plan
 * for experts and admins: statuses, the draft editor, «Отправить на одобрение»,
 * «Одобрить» / «Вернуть с комментарием» (approvers only), the exception dialog
 * (reason ≥ 10 characters) when the approval conditions fail. Behaviour lives in
 * planController.ts; this file only draws the snapshot.
 */
import { useEffect, useId, useState, type ReactNode } from 'react'
import { CheckCircle2, FilePlus2, Save, Send, Undo2 } from 'lucide-react'
import { Badge, Button, ConfirmDialog, EmptyState, ErrorState, Modal, Panel, Skeleton, cx, fmtDateTime, inputClass } from '../../kit'
import type { PlanVersionRow } from '@/lib/point-b/plan/types'
import { EXCEPTION_REASON_MIN } from '@/lib/point-b/plan/status'
import {
  NOTES_MAX, REJECT_REASON_MIN, STATUS_LABEL, STATUS_TONE, versionActions,
  type PlanController, type PlanSnapshot, type UiError,
} from './planController'
import { usePlanController } from './usePlanController'

const INVALID = 'border-red-500/50 focus:border-red-500/60'

function FieldError({ id, error, field }: { id: string; error: UiError | null; field: string }) {
  if (!error || error.field !== field) return null
  return <p id={id} role="alert" className="mt-1 text-[11px] text-red-300">{error.message}</p>
}

function Notice({ snap }: { snap: PlanSnapshot }) {
  // The goal panel shows its own notices; a field error is shown under its field.
  const mine = snap.scope === 'plan'
  const notice = mine ? snap.notice : null
  const general = mine && snap.error && !snap.error.field ? snap.error : null
  return (
    <div aria-live="polite" className="space-y-2">
      {notice && <p className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">{notice}</p>}
      {general && (
        <div role="alert" className="rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          <p>{general.message}</p>
          {general.reasons.length > 0 && (
            <ul className="mt-1 list-disc space-y-0.5 pl-4">{general.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
          )}
        </div>
      )}
    </div>
  )
}

function VersionItem({ v, canApprove, busy, onApprove, onReject }: {
  v: PlanVersionRow
  canApprove: boolean
  busy: boolean
  onApprove: (v: PlanVersionRow) => void
  onReject: (v: PlanVersionRow) => void
}) {
  const acts = versionActions(v.status, canApprove)
  const when = v.status === 'approved' || v.status === 'superseded' ? v.approved_at : v.submitted_at ?? v.created_at
  return (
    <li className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-slate-200">Версия {v.version}</span>
          <Badge tone={STATUS_TONE[v.status]}>{STATUS_LABEL[v.status]}</Badge>
          {v.approval_exception && <Badge tone="amber" title={v.approval_exception}>По исключению</Badge>}
        </div>
        {v.status === 'in_review' && (
          acts.approve ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="primary" icon={<CheckCircle2 size={12} />} loading={busy} onClick={() => onApprove(v)}>Одобрить</Button>
              <Button size="sm" icon={<Undo2 size={12} />} disabled={busy} onClick={() => onReject(v)}>Вернуть с комментарием</Button>
            </div>
          ) : (
            <span className="text-[11px] text-slate-500">Ждёт одобрения Admin или Super Admin</span>
          )
        )}
      </div>
      {v.change_reason && <p className="mt-2 text-xs text-slate-400"><span className="text-slate-500">Причина изменений: </span>{v.change_reason}</p>}
      {v.expert_notes && <p className="mt-1.5 line-clamp-4 whitespace-pre-wrap break-words text-sm text-slate-200">{v.expert_notes}</p>}
      {v.status === 'draft' && v.rejected_reason && (
        <p className="mt-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-200">
          Возвращена на доработку: {v.rejected_reason}
        </p>
      )}
      {v.approval_exception && <p className="mt-1.5 text-[11px] text-amber-300/80">Исключение: {v.approval_exception}</p>}
      <p className="mt-2 text-[11px] text-slate-600">
        {v.author_name ?? 'Эксперт'} · {fmtDateTime(when)}
      </p>
    </li>
  )
}

export interface PlanPanelViewProps {
  snap: PlanSnapshot
  notes: string
  reason: string
  onNotes: (v: string) => void
  onReason: (v: string) => void
  onCreate: () => void
  onSave: () => void
  onSubmit: () => void
  onAskApprove: (v: PlanVersionRow) => void
  onAskReject: (v: PlanVersionRow) => void
  onRetry: () => void
  /** Dialogs. */
  approveTarget: PlanVersionRow | null
  onApproveClose: () => void
  onApproveConfirm: () => void
  rejectTarget: PlanVersionRow | null
  rejectText: string
  onRejectText: (v: string) => void
  onRejectClose: () => void
  onRejectConfirm: () => void
  exceptionText: string
  onExceptionText: (v: string) => void
  onExceptionClose: () => void
  onExceptionConfirm: () => void
  /** Extra content under the header (e.g. the goal panel placed by the parent). */
  children?: ReactNode
}

export function PlanPanelView(p: PlanPanelViewProps) {
  const uid = useId()
  const { snap } = p
  const plan = snap.plan
  const open = plan?.open ?? null
  const draft = open?.status === 'draft' ? open : null
  const busy = snap.busy !== null
  const notesErr = `${uid}-notes-err`
  const reasonErr = `${uid}-reason-err`
  const exErr = `${uid}-ex-err`
  const rejErr = `${uid}-rej-err`
  const err = snap.scope === 'plan' ? snap.error : null

  return (
    <Panel
      title="План Точки Б"
      description="Версия плана видна клиенту только после одобрения Admin или Super Admin. Одобренная версия не меняется — любое изменение это новая версия."
      actions={plan && !open ? (
        <Button size="sm" variant="primary" icon={<FilePlus2 size={12} />} loading={snap.busy === 'create'} onClick={p.onCreate}>
          {plan.versions.length ? 'Новая версия' : 'Создать черновик'}
        </Button>
      ) : undefined}
    >
      {snap.phase === 'loading' && <Skeleton className="h-24" />}
      {snap.phase === 'error' && <ErrorState error={{ message: snap.loadError ?? 'Не удалось загрузить план' }} onRetry={p.onRetry} />}

      {snap.phase === 'ready' && plan && (
        <div className="space-y-4">
          <Notice snap={snap} />
          {p.children}

          {draft && (
            <div className="space-y-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
              <div className="flex items-center gap-2">
                <p className="text-xs font-semibold text-slate-200">Редактор черновика · версия {draft.version}</p>
                <Badge tone="neutral">Черновик</Badge>
              </div>
              <div>
                <label htmlFor={`${uid}-notes`} className="mb-1 block text-[11px] font-medium text-slate-400">Заметки эксперта</label>
                <textarea
                  id={`${uid}-notes`}
                  value={p.notes}
                  onChange={(e) => p.onNotes(e.target.value)}
                  rows={5}
                  maxLength={NOTES_MAX}
                  aria-invalid={err?.field === 'expertNotes' || undefined}
                  aria-describedby={err?.field === 'expertNotes' ? notesErr : undefined}
                  placeholder="Что в плане меняется и почему: фокус по кварталам, риски, решения по команде…"
                  className={cx(inputClass, err?.field === 'expertNotes' && INVALID)}
                />
                <FieldError id={notesErr} error={err} field="expertNotes" />
              </div>
              <div>
                <label htmlFor={`${uid}-reason`} className="mb-1 block text-[11px] font-medium text-slate-400">Причина изменений (обязательна для одобрения)</label>
                <input
                  id={`${uid}-reason`}
                  value={p.reason}
                  onChange={(e) => p.onReason(e.target.value)}
                  maxLength={500}
                  aria-invalid={err?.field === 'changeReason' || undefined}
                  aria-describedby={err?.field === 'changeReason' ? reasonErr : undefined}
                  placeholder="Например: цель подтверждена, добавлен квартальный фокус"
                  className={cx(inputClass, err?.field === 'changeReason' && INVALID)}
                />
                <FieldError id={reasonErr} error={err} field="changeReason" />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] text-slate-600">{p.notes.length}/{NOTES_MAX}</span>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" icon={<Save size={12} />} loading={snap.busy === 'save'} disabled={busy} onClick={p.onSave}>Сохранить черновик</Button>
                  <Button size="sm" variant="primary" icon={<Send size={12} />} loading={snap.busy === 'submit'} disabled={busy} onClick={p.onSubmit}>Отправить на одобрение</Button>
                </div>
              </div>
            </div>
          )}

          {plan.versions.length === 0 && !draft ? (
            <EmptyState
              title="Плана ещё нет"
              text="Создайте черновик, проверьте цели клиента и отправьте версию на одобрение — до этого клиент видит только предварительный расчёт."
            />
          ) : (
            <ul className="space-y-2" aria-label="Версии плана">
              {plan.versions.map((v) => (
                <VersionItem key={v.id} v={v} canApprove={plan.canApprove} busy={snap.busy === 'approve' || snap.busy === 'reject'} onApprove={p.onAskApprove} onReject={p.onAskReject} />
              ))}
            </ul>
          )}
        </div>
      )}

      <ConfirmDialog
        open={!!p.approveTarget}
        onClose={p.onApproveClose}
        onConfirm={p.onApproveConfirm}
        loading={snap.busy === 'approve'}
        tone="primary"
        title={`Одобрить версию ${p.approveTarget?.version ?? ''}?`}
        text="После одобрения клиент увидит эту версию в своей Точке Б, а прошлая одобренная станет «Заменена». Действие попадёт в журнал."
        confirmLabel="Одобрить"
      />

      <Modal
        open={!!p.rejectTarget}
        onClose={p.onRejectClose}
        title={`Вернуть версию ${p.rejectTarget?.version ?? ''} с комментарием`}
        footer={
          <>
            <Button variant="ghost" onClick={p.onRejectClose} disabled={snap.busy === 'reject'}>Отмена</Button>
            <Button variant="primary" loading={snap.busy === 'reject'} onClick={p.onRejectConfirm}>Вернуть эксперту</Button>
          </>
        }
      >
        <label htmlFor={`${uid}-rej`} className="mb-1 block text-[11px] font-medium text-slate-400">Что поправить (не короче {REJECT_REASON_MIN} символов)</label>
        <textarea
          id={`${uid}-rej`}
          value={p.rejectText}
          onChange={(e) => p.onRejectText(e.target.value)}
          rows={4}
          maxLength={1000}
          aria-invalid={err?.field === 'reason' || undefined}
          aria-describedby={err?.field === 'reason' ? rejErr : undefined}
          className={cx(inputClass, err?.field === 'reason' && INVALID)}
        />
        <FieldError id={rejErr} error={err} field="reason" />
        {err && !err.field && <p role="alert" className="mt-2 text-[11px] text-red-300">{err.message}</p>}
      </Modal>

      <Modal
        open={!!snap.exception}
        onClose={p.onExceptionClose}
        title="Условия одобрения не выполнены"
        footer={
          <>
            <Button variant="ghost" onClick={p.onExceptionClose} disabled={snap.busy === 'approve'}>Отмена</Button>
            <Button variant="warning" loading={snap.busy === 'approve'} onClick={p.onExceptionConfirm}>Одобрить по исключению</Button>
          </>
        }
      >
        <p className="text-xs text-slate-400">Сервер не пропустил одобрение:</p>
        <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-xs text-red-200">
          {(snap.exception?.reasons ?? []).map((r) => <li key={r}>{r}</li>)}
        </ul>
        <p className="mt-3 text-xs text-slate-400">
          Admin может одобрить версию как исключение. Причина (не короче {EXCEPTION_REASON_MIN} символов) сохранится в версии и в журнале.
        </p>
        <label htmlFor={`${uid}-ex`} className="mb-1 mt-3 block text-[11px] font-medium text-slate-400">Причина исключения</label>
        <textarea
          id={`${uid}-ex`}
          value={p.exceptionText}
          onChange={(e) => p.onExceptionText(e.target.value)}
          rows={3}
          maxLength={1000}
          aria-invalid={snap.exception?.error ? true : undefined}
          aria-describedby={snap.exception?.error ? exErr : undefined}
          className={cx(inputClass, snap.exception?.error && INVALID)}
        />
        <p className="mt-1 text-[10px] text-slate-600">{p.exceptionText.trim().length}/{EXCEPTION_REASON_MIN} символов минимум</p>
        {snap.exception?.error && <p id={exErr} role="alert" className="mt-1 text-[11px] text-red-300">{snap.exception.error.message}</p>}
      </Modal>
    </Panel>
  )
}

/** Stateful wrapper: the controller (shared with the goal panel) + the local form fields. */
export function PlanPanel({ ctl, snap, children }: { ctl: PlanController; snap: PlanSnapshot; children?: ReactNode }) {
  const draft = snap.plan?.open?.status === 'draft' ? snap.plan.open : null
  const [notes, setNotes] = useState('')
  const [reason, setReason] = useState('')
  const [approveTarget, setApproveTarget] = useState<PlanVersionRow | null>(null)
  const [rejectTarget, setRejectTarget] = useState<PlanVersionRow | null>(null)
  const [rejectText, setRejectText] = useState('')
  const [exceptionText, setExceptionText] = useState('')

  // The form follows the draft on the server (a new draft, or another save).
  useEffect(() => {
    setNotes(draft?.expert_notes ?? '')
    setReason(draft?.change_reason ?? '')
  }, [draft?.id, draft?.expert_notes, draft?.change_reason])

  useEffect(() => { if (!snap.exception) setExceptionText('') }, [snap.exception])

  return (
    <PlanPanelView
      snap={snap}
      notes={notes}
      reason={reason}
      onNotes={setNotes}
      onReason={setReason}
      onCreate={() => void ctl.createDraft()}
      onSave={() => draft && void ctl.saveDraft(draft.id, { expertNotes: notes, changeReason: reason })}
      onSubmit={() => draft && void ctl.submitDraft(draft.id, { expertNotes: notes, changeReason: reason })}
      onAskApprove={setApproveTarget}
      onAskReject={(v) => { setRejectText(''); ctl.dismissNotice(); setRejectTarget(v) }}
      onRetry={() => void ctl.load()}
      approveTarget={approveTarget}
      onApproveClose={() => setApproveTarget(null)}
      onApproveConfirm={() => { const v = approveTarget; setApproveTarget(null); if (v) void ctl.approve(v.id) }}
      rejectTarget={rejectTarget}
      rejectText={rejectText}
      onRejectText={setRejectText}
      onRejectClose={() => setRejectTarget(null)}
      onRejectConfirm={async () => { if (rejectTarget && (await ctl.reject(rejectTarget.id, rejectText))) setRejectTarget(null) }}
      exceptionText={exceptionText}
      onExceptionText={setExceptionText}
      onExceptionClose={() => ctl.closeException()}
      onExceptionConfirm={() => { const x = snap.exception; if (x) void ctl.approve(x.versionId, exceptionText) }}
    >
      {children}
    </PlanPanelView>
  )
}

/** Self-contained variant for tabs that show only the plan (the «Разбор» tab). */
export function PlanPanelStandalone({ userId }: { userId: string }) {
  const { ctl, snap } = usePlanController(userId)
  return <PlanPanel ctl={ctl} snap={snap} />
}
