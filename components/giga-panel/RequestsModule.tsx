'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  CheckCircle,
  XCircle,
  Archive,
  Clock,
  UserPlus,
  KeyRound,
  HeadphonesIcon,
  Building2,
  Mail,
  CalendarDays,
  ChevronDown,
  RefreshCw,
  Loader2,
  Crown,
  AlarmClock,
  UserRound,
  MessageCircle,
  Send,
  Phone,
} from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import { useGigaPanelStore, type RequestCategory, type GigaRequest } from '@/stores/gigaPanel.store'
import { RejectModal } from './RejectModal'
import { UserDetailPanel } from './UserDetailPanel'
import { RegistrationModeControl } from './RegistrationModeControl'
import { useStaff } from './StaffContext'
import { Button, ConfirmDialog, Field, GigaApiError, cx, gigaFetch, inputClass } from './kit'
import {
  ASSIGN_PRO_LABEL,
  ASSIGN_PRO_PERIOD_ERROR,
  ASSIGN_PRO_PERMISSION,
  DEFAULT_ASSIGN_PRO_FORM,
  PAID_DECIDERS_ONLY,
  assignProBlockedReason,
  assignProBody,
  assignProPeriodText,
  isTariffRequest,
  OPEN_CLIENT_LABEL,
  requestClientLinks,
  requestSlaView,
  sendAssignPro,
  WRITE_CLIENT_LABEL,
  type AssignProForm,
} from './assign-pro-model'
import { NAV_BADGES_CHANGED } from './agents/model'
import {
  BULK_INVITE_NOTE,
  BULK_REJECT_INVITE_NOTE,
  INVITE_REQUEST_BADGE,
  SEND_INVITE_LABEL,
  SEND_INVITE_NO_RIGHT,
  SEND_INVITE_PERMISSION,
  isInviteRequest,
  otherRequestText,
  sendInviteDialogText,
  sendInviteFromRequest,
} from './invite-request-model'
import { decidesPaidRequests } from '@/lib/admin/rbac'

// ─── Tab config ───────────────────────────────────────────────────────────────

const TABS: { id: RequestCategory; label: string; icon: React.ReactNode }[] = [
  { id: 'registration', label: 'Регистрация', icon: <UserPlus size={15} /> },
  { id: 'access', label: 'Доступы', icon: <KeyRound size={15} /> },
  { id: 'support', label: 'Поддержка', icon: <HeadphonesIcon size={15} /> },
]

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: GigaRequest['status'] }) {
  const map = {
    pending: 'bg-amber-500/15 text-amber-300 border-amber-500/25',
    approved: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25',
    rejected: 'bg-red-500/15 text-red-300 border-red-500/25',
    archived: 'bg-slate-500/15 text-slate-400 border-slate-500/20',
  }
  const labels = {
    pending: 'Ожидает',
    approved: 'Принято',
    rejected: 'Отклонено',
    archived: 'Архив',
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${map[status]}`}>
      {labels[status]}
    </span>
  )
}


// ─── Single request card ──────────────────────────────────────────────────────

export function RequestCard({
  request,
  onApprove,
  onReject,
  onArchive,
  onAssignPro,
  canAssignPro = false,
  paidDecider = true,
  selected,
  onToggleSelect,
  onSendInvite,
  canInvite = false,
}: {
  request: GigaRequest
  onApprove: (id: string) => void
  onReject: (req: GigaRequest) => void
  onArchive: (id: string) => void
  /** R4 B3: a request for an invitation is accepted by sending the invitation. */
  onSendInvite?: (req: GigaRequest) => void
  canInvite?: boolean
  /** R2-C (M-5): a request for paid access is approved by assigning Pro. */
  onAssignPro?: (req: GigaRequest) => void
  canAssignPro?: boolean
  /** R4 (review WB-9): the actor is Admin / Super Admin — only they decide on a request for paid access. */
  paidDecider?: boolean
  selected?: boolean
  onToggleSelect?: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const isPending = request.status === 'pending'
  const tariff = isTariffRequest(request)
  const assignBlocked = assignProBlockedReason(canAssignPro && !!onAssignPro, request, paidDecider)
  // WB-9: «Отклонить» / «Архив» of a request for paid access — Admin / Super Admin only.
  const decisionBlocked = tariff && !paidDecider ? PAID_DECIDERS_ONLY : null
  // R4 (N4B-1 / N4B-9): the answer deadline (4 h) and the way to the client.
  const sla = tariff ? requestSlaView(request) : null
  const links = tariff ? requestClientLinks(request.userId) : null
  // R4 B3 (N4B-3): «Запрос приглашения» — no account yet; accepted by sending the invitation.
  const invite = isInviteRequest(request)
  const inviteBlocked = invite && !(canInvite && onSendInvite) ? SEND_INVITE_NO_RIGHT : null

  const initials = request.userName
    .split(' ')
    .slice(0, 2)
    .map((n) => n[0])
    .join('')
    .toUpperCase()

  const formattedDate = new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(request.createdAt))

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      className="rounded-2xl bg-white/[0.04] border border-white/[0.07]
        backdrop-blur-sm hover:border-white/[0.12] transition-all duration-200 overflow-hidden"
    >
      {/* Card header */}
      <div className="p-4">
        <div className="flex items-start gap-3">
          {onToggleSelect && isPending && !decisionBlocked && (
            <input
              type="checkbox"
              checked={!!selected}
              onChange={() => onToggleSelect(request.id)}
              aria-label={`Выбрать заявку: ${request.userName}`}
              className="mt-2.5 h-3.5 w-3.5 flex-shrink-0 cursor-pointer accent-blue-500"
            />
          )}
          {/* Avatar */}
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500/30 to-violet-500/30
            border border-white/[0.1] flex items-center justify-center flex-shrink-0
            text-[13px] font-bold text-blue-300">
            {initials}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-slate-100 leading-tight">
                  {request.userName}
                </p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <Mail size={11} className="text-slate-600" />
                  <p className="text-[11px] text-slate-500 truncate">{request.userEmail}</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {invite && (
                  <span
                    data-invite-request
                    title="Человек без аккаунта просит приглашение: регистрация по приглашению"
                    className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-blue-500/15 border border-blue-500/25 text-blue-300 text-[9px] font-mono tracking-wide"
                  >
                    {INVITE_REQUEST_BADGE}
                  </span>
                )}
                {(request.source === 'upgrade_modal' || request.source === 'paywall') && (
                  <span
                    title="Заявка на платный доступ: «Назначить Pro» назначает тариф и закрывает заявку"
                    className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/25 text-amber-400 text-[9px] font-mono tracking-wide"
                  >
                    Pro
                  </span>
                )}
                <StatusBadge status={request.status} />
              </div>
            </div>

            <p className="text-xs font-medium text-slate-300 mt-2 leading-snug">
              {request.subject}
            </p>

            <div className="flex items-center gap-3 mt-2">
              {request.company && (
                <div className="flex items-center gap-1">
                  <Building2 size={11} className="text-slate-600" />
                  <span className="text-[10px] text-slate-500">{request.company}</span>
                </div>
              )}
              <div className="flex items-center gap-1">
                <CalendarDays size={11} className="text-slate-600" />
                <span className="text-[10px] text-slate-500">{formattedDate}</span>
              </div>
            </div>

            {invite && (request.contact || request.accountExists || (request.repeats ?? 1) > 1 || !!request.otherRequests?.length) && (
              <div className="mt-2 space-y-1 text-[11px] text-slate-400" data-invite-details>
                {request.contact && (
                  <p className="inline-flex items-center gap-1.5">
                    <Phone size={11} className="text-slate-600" aria-hidden />
                    Телефон или Telegram: <span className="text-slate-300">{request.contact}</span>
                  </p>
                )}
                {request.accountExists && <p>Аккаунт с этой почтой уже есть — приглашение придёт как ссылка для входа.</p>}
                {(request.repeats ?? 1) > 1 && <p>Запросов с этой почты: {request.repeats} — заявка одна.</p>}
                {/* Review W3A-5: a repeat with other data never replaces the first request — it is shown apart. */}
                {(request.otherRequests ?? []).map((o, i) => (
                  <p key={`${o.at ?? ''}-${i}`} data-invite-other className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-2 py-1 text-amber-200">
                    {otherRequestText(o)}
                  </p>
                ))}
              </div>
            )}

            {sla && (
              <p
                data-request-sla={sla.overdue ? 'overdue' : 'due'}
                className={cx(
                  'mt-2 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium',
                  sla.overdue ? 'border border-red-500/30 bg-red-500/15 text-red-200' : 'border border-white/[0.06] bg-white/[0.03] text-slate-400',
                )}
              >
                <AlarmClock size={12} aria-hidden />
                {sla.text}
              </p>
            )}

            {links && (
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]" data-request-links>
                <Link href={links.user360} className="inline-flex items-center gap-1 text-blue-300 hover:text-blue-200 hover:underline">
                  <UserRound size={12} aria-hidden />
                  {OPEN_CLIENT_LABEL}
                </Link>
                <Link href={links.messages} className="inline-flex items-center gap-1 text-blue-300 hover:text-blue-200 hover:underline">
                  <MessageCircle size={12} aria-hidden />
                  {WRITE_CLIENT_LABEL}
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* Expand toggle */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 mt-3 text-[11px] text-slate-600
            hover:text-slate-400 transition-colors"
        >
          <ChevronDown
            size={13}
            className={`transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
          />
          {expanded ? 'Скрыть' : 'Читать подробнее'}
        </button>
      </div>

      {/* Expanded description + survey data */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4">
              <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.05]">
                <p className="text-xs text-slate-400 leading-relaxed">{request.description}</p>
                {request.rejectionReason && (
                  <div className="mt-2 pt-2 border-t border-red-500/15">
                    <p className="text-[10px] font-semibold text-red-400 mb-1">Причина отклонения:</p>
                    <p className="text-xs text-red-300/70">{request.rejectionReason}</p>
                  </div>
                )}
              </div>

              {/* Full user detail: survey (editable) + diagnostics + documents + portal.
                  A request for an invitation has no account yet — nothing to show. */}
              {request.category === 'registration' && !invite && (
                <UserDetailPanel userId={request.id} />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Actions (only for pending) */}
      {isPending && tariff && assignBlocked && (
        <p className="px-3 md:px-4 pb-1.5 text-[10px] text-slate-500" data-assign-blocked>{assignBlocked}</p>
      )}
      {isPending && inviteBlocked && (
        <p className="px-3 md:px-4 pb-1.5 text-[10px] text-slate-500" data-invite-blocked>{inviteBlocked}</p>
      )}
      {isPending && (
        <div className="px-3 md:px-4 pb-3 md:pb-4 flex flex-wrap items-center gap-1.5 md:gap-2">
          {invite ? (
            <motion.button
              onClick={() => onSendInvite?.(request)}
              disabled={!!inviteBlocked}
              title={inviteBlocked ?? 'Письмо-приглашение на почту из заявки — заявка закроется как принятая'}
              data-action="send-invite"
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold
                bg-emerald-500/15 border border-emerald-500/25 text-emerald-300
                hover:bg-emerald-500/25 hover:border-emerald-500/40 transition-all
                disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Send size={13} />
              {SEND_INVITE_LABEL}
            </motion.button>
          ) : tariff ? (
            <motion.button
              onClick={() => onAssignPro?.(request)}
              disabled={!!assignBlocked}
              title={assignBlocked ?? 'Назначить тариф Pro (срок и примечание) — заявка закроется, клиент получит уведомление'}
              data-action="assign-pro"
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold
                bg-emerald-500/15 border border-emerald-500/25 text-emerald-300
                hover:bg-emerald-500/25 hover:border-emerald-500/40 transition-all
                disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Crown size={13} />
              {ASSIGN_PRO_LABEL}
            </motion.button>
          ) : (
            <motion.button
              onClick={() => onApprove(request.id)}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold
                bg-emerald-500/15 border border-emerald-500/25 text-emerald-300
                hover:bg-emerald-500/25 hover:border-emerald-500/40 transition-all"
            >
              <CheckCircle size={13} />
              Принять
            </motion.button>
          )}

          <motion.button
            onClick={() => onReject(request)}
            disabled={!!decisionBlocked}
            title={decisionBlocked ?? undefined}
            data-action="reject"
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold
              bg-red-500/15 border border-red-500/25 text-red-300
              hover:bg-red-500/25 hover:border-red-500/40 transition-all
              disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <XCircle size={13} />
            Отклонить
          </motion.button>

          <motion.button
            onClick={() => onArchive(request.id)}
            disabled={!!decisionBlocked}
            title={decisionBlocked ?? undefined}
            data-action="archive"
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold
              bg-white/[0.05] border border-white/[0.08] text-slate-400
              hover:bg-white/[0.08] hover:text-slate-300 transition-all ml-auto
              disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Archive size={13} />
            Архив
          </motion.button>
        </div>
      )}
    </motion.div>
  )
}

/**
 * R2-C (M-5): the dialog «Назначить Pro» — period (N months / until a date / open-ended)
 * and a note. While the period is incomplete the action is LOCKED and the form says why
 * (review L-3), instead of a button that silently does nothing.
 */
export function AssignProDialog({ target, form, setForm, busy, onClose, onConfirm }: {
  target: GigaRequest | null
  form: AssignProForm
  setForm: (f: (prev: AssignProForm) => AssignProForm) => void
  busy: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  const complete = assignProBody(form) !== null
  return (
      <ConfirmDialog
        open={!!target}
        onClose={onClose}
        onConfirm={onConfirm}
        loading={busy}
        disabled={!complete}
        tone="primary"
        title={`${ASSIGN_PRO_LABEL}: ${target?.userName ?? ''}`}
        confirmLabel={`${ASSIGN_PRO_LABEL} ${assignProPeriodText(form)}`}
        text={
          <div className="space-y-1">
            <p>Тариф Pro назначается так же, как в User 360 → Биллинг: запись в журнал до изменения, оплата не списывается.</p>
            <p>Заявка закроется как одобренная, клиент получит уведомление «Доступ открыт»: в ленте кабинета, на почту и в Telegram, если он его привязал.</p>
            {target?.subject && <p className="text-slate-300">{target.subject}</p>}
          </div>
        }
      >
        <div className="space-y-3">
          <Field label="Срок">
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={form.mode}
                onChange={(e) => setForm((f) => ({ ...f, mode: e.target.value as AssignProForm['mode'] }))}
                className={cx(inputClass, 'w-auto')}
                aria-label="Срок"
              >
                <option value="months">на N месяцев</option>
                <option value="date">до даты</option>
                <option value="none">бессрочно</option>
              </select>
              {form.mode === 'months' && (
                <input type="number" min={1} max={36} value={form.months} onChange={(e) => setForm((f) => ({ ...f, months: e.target.value }))} className={cx(inputClass, 'w-24')} aria-label="Месяцев" />
              )}
              {form.mode === 'date' && (
                <input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} className={cx(inputClass, 'w-auto')} aria-label="Дата окончания" />
              )}
            </div>
          </Field>
          <Field label="Примечание (видно только персоналу)">
            <textarea value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} maxLength={500} rows={2} className={cx(inputClass, 'resize-none')} />
          </Field>
          {!complete && <p role="alert" className="text-[11px] text-red-300">{ASSIGN_PRO_PERIOD_ERROR}</p>}
        </div>
      </ConfirmDialog>
  )
}

// ─── Main module ──────────────────────────────────────────────────────────────

export function RequestsModule() {
  const {
    activeRequestTab,
    setActiveRequestTab,
    requests,
    isLoadingRequests,
    requestsError,
    setRequests,
    setLoadingRequests,
    setRequestsError,
    approveRequest,
    rejectRequest,
    archiveRequest,
  } = useGigaPanelStore()

  const [rejectTarget, setRejectTarget] = useState<GigaRequest | null>(null)
  const { can, me } = useStaff()
  const canDecide = can('users.approve')
  // R4 (review WB-9, PO): requests for paid access — Admin / Super Admin only (the server checks it too).
  const paidDecider = decidesPaidRequests(me?.role)
  // R2-C (M-5): «Назначить Pro» — the rights of the plan editor (User 360 → Биллинг).
  const canAssignPro = can(ASSIGN_PRO_PERMISSION)
  // R4 B3: «Отправить приглашение» by a request for an invitation.
  const canInvite = can(SEND_INVITE_PERMISSION)
  const [inviteTarget, setInviteTarget] = useState<GigaRequest | null>(null)
  const [inviteBusy, setInviteBusy] = useState(false)
  const [proTarget, setProTarget] = useState<GigaRequest | null>(null)
  const [proForm, setProForm] = useState<AssignProForm>(DEFAULT_ASSIGN_PRO_FORM)
  const [proBusy, setProBusy] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [bulk, setBulk] = useState<null | 'approve' | 'reject'>(null)
  const [bulkReason, setBulkReason] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)
  const togglePick = (id: string) => setPicked((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const fetchRequests = useCallback(async () => {
    setLoadingRequests(true)
    setRequestsError(null)
    try {
      const res = await fetch('/api/giga-admin/requests')
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `Ошибка загрузки заявок (HTTP ${res.status})`)
      }
      const data = await res.json()
      setRequests(data.requests ?? [])
      // The «Заявки» badge in the menu follows the list (R4 N4B-1).
      window.dispatchEvent(new Event(NAV_BADGES_CHANGED))
    } catch (err) {
      setRequestsError(err instanceof Error ? err.message : 'Неизвестная ошибка')
    } finally {
      setLoadingRequests(false)
    }
  }, [setRequests, setLoadingRequests, setRequestsError])

  useEffect(() => { fetchRequests() }, [fetchRequests])

  // API-backed actions.
  // Every action optimistically updates the card, then RECONCILES with the DB in
  // `finally`: on failure `fetchRequests()` re-reads the real status (reverting
  // the optimistic flip) and a toast surfaces the error; on success it confirms
  // the persisted status. This removes the "green but still pending" illusion.
  const runAction = async (
    id: string,
    payload: { action: 'approve' | 'reject' | 'archive'; reason?: string },
    successMsg: string,
    failMsg: string,
  ) => {
    try {
      const res = await fetch(`/api/giga-admin/requests/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `${failMsg} (HTTP ${res.status})`)
      toast.success(successMsg)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : failMsg)
    } finally {
      await fetchRequests() // reconcile with the DB — source of truth
    }
  }

  const handleApprove = async (id: string) => {
    approveRequest(id) // optimistic
    await runAction(id, { action: 'approve' }, 'Пользователь принят — доступ открыт', 'Не удалось принять заявку')
  }

  const handleReject = async (id: string, reason: string) => {
    rejectRequest(id, reason) // optimistic
    await runAction(id, { action: 'reject', reason }, 'Заявка отклонена', 'Не удалось отклонить заявку')
  }

  const handleArchive = async (id: string) => {
    archiveRequest(id) // optimistic
    await runAction(id, { action: 'archive' }, 'Заявка отправлена в архив', 'Не удалось архивировать заявку')
  }

  const openAssignPro = (r: GigaRequest) => {
    setProForm(DEFAULT_ASSIGN_PRO_FORM)
    setProTarget(r)
  }

  const runAssignPro = async () => {
    if (!proTarget) return
    const body = assignProBody(proForm)
    if (!body) return
    setProBusy(true)
    try {
      const r = await sendAssignPro(fetch, proTarget.id, body)
      if (r.ok) {
        toast.success(r.text)
        setProTarget(null)
      } else {
        toast.error(r.text)
      }
    } finally {
      setProBusy(false)
      await fetchRequests() // reconcile with the DB — source of truth
    }
  }

  const runSendInvite = async () => {
    if (!inviteTarget) return
    setInviteBusy(true)
    try {
      const r = await sendInviteFromRequest(fetch, inviteTarget.id)
      if (r.ok) {
        toast.success(r.text)
        setInviteTarget(null)
      } else {
        toast.error(r.text)
      }
    } finally {
      setInviteBusy(false)
      await fetchRequests() // reconcile with the DB — source of truth
    }
  }

  const filtered = requests.filter((r) => r.category === activeRequestTab)
  const pendingFiltered = filtered.filter((r) => r.status === 'pending')
  // WB-9: a request for paid access is selectable for bulk only by Admin / Super Admin.
  const selectable = pendingFiltered.filter((r) => paidDecider || !isTariffRequest(r))
  const pickedHere = selectable.filter((r) => picked.has(r.id))
  // R2-C (M-5): a request for paid access is approved only by «Назначить Pro» — no bulk «Принять» for it.
  const pickedTariff = pickedHere.some((r) => isTariffRequest(r))
  // R4 B3: a request for an invitation is accepted only by «Отправить приглашение».
  const pickedInvite = pickedHere.some((r) => isInviteRequest(r))
  const allPicked = selectable.length > 0 && selectable.every((r) => picked.has(r.id))

  // Массовое решение: каждая заявка решается тем же кодом, что и одиночная,
  // отчёт — по каждой. После — сверка с базой, как и у одиночных действий.
  const runBulk = async () => {
    if (!bulk || !pickedHere.length) return
    setBulkBusy(true)
    try {
      const r = await gigaFetch<{ results: Array<{ id: string; ok: boolean; error: string | null }>; done: number }>('/api/giga-admin/requests/bulk', {
        method: 'POST',
        json: { action: bulk, ids: pickedHere.map((x) => x.id), ...(bulkReason.trim() ? { reason: bulkReason.trim() } : {}) },
      })
      const failed = r.results.filter((x) => !x.ok)
      const nameOf = new Map(pickedHere.map((x) => [x.id, x.userName]))
      const verb = bulk === 'approve' ? 'Принято' : 'Отклонено'
      if (failed.length) {
        toast.warning(`${verb}: ${r.done} из ${r.results.length}`, {
          description: failed.slice(0, 5).map((f) => `${nameOf.get(f.id) ?? f.id}: ${f.error ?? 'ошибка'}`).join('\n'),
          duration: 12_000,
        })
      } else {
        toast.success(`${verb} заявок: ${r.done}`)
      }
      setPicked(new Set())
      setBulk(null)
      setBulkReason('')
    } catch (e) {
      toast.error(e instanceof GigaApiError ? e.message : 'Массовое действие не выполнено')
    } finally {
      setBulkBusy(false)
      await fetchRequests()
    }
  }
  const doneFiltered = filtered.filter((r) => r.status !== 'pending')

  const tabCounts = {
    registration: requests.filter((r) => r.category === 'registration' && r.status === 'pending').length,
    access: requests.filter((r) => r.category === 'access' && r.status === 'pending').length,
    support: requests.filter((r) => r.category === 'support' && r.status === 'pending').length,
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-100 tracking-tight">Управление заявками</h1>
          <p className="text-sm text-slate-500 mt-1">
            Все входящие запросы — регистрации, доступы и тикеты поддержки
          </p>
        </div>
        <div className="flex items-center gap-3">
          <RegistrationModeControl />
          <motion.button
            onClick={fetchRequests}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            disabled={isLoadingRequests}
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium
              text-slate-400 bg-white/[0.05] border border-white/[0.08]
              hover:text-slate-200 hover:bg-white/[0.08] transition-all
              disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw size={13} className={isLoadingRequests ? 'animate-spin' : ''} />
            Обновить
          </motion.button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 p-1 rounded-xl bg-white/[0.04] border border-white/[0.07] w-full md:w-fit mb-6 overflow-x-auto">
        {TABS.map((tab) => {
          const isActive = activeRequestTab === tab.id
          return (
            <motion.button
              key={tab.id}
              onClick={() => setActiveRequestTab(tab.id)}
              whileHover={!isActive ? { scale: 1.02 } : {}}
              whileTap={{ scale: 0.97 }}
              className={`
                relative flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
                transition-all duration-200
                ${isActive
                  ? 'bg-blue-500/20 text-blue-300 border border-blue-500/25 shadow-[0_0_15px_rgba(59,130,246,0.1)]'
                  : 'text-slate-500 hover:text-slate-300'
                }
              `}
            >
              {tab.icon}
              {tab.label}
              {tabCounts[tab.id] > 0 && (
                <span className={`
                  flex items-center justify-center h-4 min-w-4 px-1 rounded-full text-[9px] font-bold
                  ${isActive ? 'bg-blue-400 text-slate-900' : 'bg-slate-700 text-slate-300'}
                `}>
                  {tabCounts[tab.id]}
                </span>
              )}
            </motion.button>
          )
        })}
      </div>

      {/* Content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeRequestTab}
          initial={{ opacity: 0, x: 8 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -8 }}
          transition={{ duration: 0.18 }}
        >
          {isLoadingRequests ? (
            <div className="flex items-center justify-center py-16">
              <RefreshCw size={20} className="text-slate-600 animate-spin mr-2" />
              <span className="text-sm text-slate-600">Загрузка заявок из Supabase...</span>
            </div>
          ) : requestsError ? (
            <div className="flex flex-col items-center justify-center py-16
              rounded-2xl bg-white/[0.02] border border-red-500/10 border-dashed">
              <p className="text-sm text-red-400">{requestsError}</p>
              <button onClick={fetchRequests} className="mt-2 text-xs text-blue-400 hover:text-blue-300">
                Повторить
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16
              rounded-2xl bg-white/[0.02] border border-white/[0.06] border-dashed">
              <Clock size={32} className="text-slate-700 mb-3" />
              <p className="text-sm text-slate-600">
                {requests.length === 0 ? 'Заявок пока нет в базе данных' : 'Нет заявок в этой категории'}
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Pending section */}
              {pendingFiltered.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    {canDecide && (
                      <input
                        type="checkbox"
                        checked={allPicked}
                        onChange={() => setPicked(allPicked ? new Set() : new Set(selectable.map((r) => r.id)))}
                        aria-label="Выбрать все ожидающие заявки"
                        className="h-3.5 w-3.5 cursor-pointer accent-blue-500"
                      />
                    )}
                    <span className="text-xs font-semibold text-amber-400 uppercase tracking-widest">
                      Ожидают обработки
                    </span>
                    <div className="flex-1 h-px bg-amber-500/15" />
                    <span className="text-xs text-slate-600">{pendingFiltered.length}</span>
                  </div>
                  {pickedHere.length > 0 && (
                    <div className="sticky top-2 z-20 mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-blue-500/25 bg-slate-950/95 px-3 py-2 backdrop-blur" role="region" aria-label="Массовые действия с заявками">
                      <span className="text-xs font-semibold text-slate-100">Выбрано {pickedHere.length}</span>
                      <div className="ml-auto flex flex-wrap gap-1.5">
                        {pickedTariff
                          ? <span className="self-center text-[11px] text-slate-500">Заявки на платный доступ одобряются кнопкой «{ASSIGN_PRO_LABEL}»</span>
                          : pickedInvite
                            ? <span className="self-center text-[11px] text-slate-500" data-bulk-invite-note>{BULK_INVITE_NOTE}</span>
                            : <Button size="sm" variant="primary" icon={<CheckCircle size={12} />} onClick={() => setBulk('approve')}>Принять все</Button>}
                        <Button size="sm" variant="danger" icon={<XCircle size={12} />} onClick={() => setBulk('reject')}>Отклонить все</Button>
                        <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>Снять</Button>
                      </div>
                    </div>
                  )}
                  <div className="grid gap-3">
                    <AnimatePresence>
                      {pendingFiltered.map((req) => (
                        <RequestCard
                          key={req.id}
                          request={req}
                          onApprove={handleApprove}
                          onReject={setRejectTarget}
                          onArchive={handleArchive}
                          onAssignPro={openAssignPro}
                          canAssignPro={canAssignPro}
                          onSendInvite={setInviteTarget}
                          canInvite={canInvite}
                          selected={picked.has(req.id)}
                          paidDecider={paidDecider}
                          onToggleSelect={canDecide ? togglePick : undefined}
                        />
                      ))}
                    </AnimatePresence>
                  </div>
                </div>
              )}

              {/* Done section */}
              {doneFiltered.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-xs font-semibold text-slate-600 uppercase tracking-widest">
                      Обработанные
                    </span>
                    <div className="flex-1 h-px bg-white/[0.05]" />
                    <span className="text-xs text-slate-600">{doneFiltered.length}</span>
                  </div>
                  <div className="grid gap-3 opacity-60">
                    {doneFiltered.map((req) => (
                      <RequestCard
                        key={req.id}
                        request={req}
                        onApprove={handleApprove}
                        onReject={setRejectTarget}
                        onArchive={handleArchive}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      <ConfirmDialog
        open={!!bulk}
        onClose={() => { setBulk(null); setBulkReason('') }}
        onConfirm={() => void runBulk()}
        loading={bulkBusy}
        tone={bulk === 'reject' ? 'danger' : 'primary'}
        title={bulk === 'approve' ? `Принять заявки: ${pickedHere.length}` : `Отклонить заявки: ${pickedHere.length}`}
        confirmLabel={bulk === 'approve' ? `Принять (${pickedHere.length})` : `Отклонить (${pickedHere.length})`}
        text={
          <div className="space-y-2">
            <p>{bulk === 'approve'
              ? 'Каждый получит доступ к порталу и письмо «доступ открыт».'
              : 'Каждый получит письмо об отклонении с причиной, если она указана.'}</p>
            {bulk === 'reject' && pickedInvite && <p>{BULK_REJECT_INVITE_NOTE}</p>}
            <ul className="max-h-40 space-y-0.5 overflow-y-auto text-[11px] text-slate-300">
              {pickedHere.slice(0, 30).map((r) => <li key={r.id} className="truncate">· {r.userName} — {r.userEmail}</li>)}
              {pickedHere.length > 30 && <li className="text-slate-500">…и ещё {pickedHere.length - 30}</li>}
            </ul>
          </div>
        }
      >
        {bulk === 'reject' && (
          <Field label="Причина (попадёт в письмо)">
            <textarea value={bulkReason} onChange={(e) => setBulkReason(e.target.value)} maxLength={500} rows={2} className={cx(inputClass, 'resize-none')} />
          </Field>
        )}
      </ConfirmDialog>

      {/* R4 B3: «Отправить приглашение» from a request for an invitation */}
      <ConfirmDialog
        open={!!inviteTarget}
        onClose={() => setInviteTarget(null)}
        onConfirm={() => void runSendInvite()}
        loading={inviteBusy}
        tone="primary"
        title={`${SEND_INVITE_LABEL}: ${inviteTarget?.userName ?? ''}`}
        confirmLabel={SEND_INVITE_LABEL}
        text={
          <div className="space-y-1">
            {(inviteTarget ? sendInviteDialogText(inviteTarget) : []).map((t) => <p key={t}>{t}</p>)}
            {inviteTarget?.company && <p className="text-slate-300">{inviteTarget.company}</p>}
          </div>
        }
      />

      {/* R2-C (M-5): «Назначить Pro» from a request for paid access */}
      <AssignProDialog target={proTarget} form={proForm} setForm={setProForm} busy={proBusy} onClose={() => setProTarget(null)} onConfirm={() => void runAssignPro()} />

      {/* Reject modal */}
      <RejectModal
        isOpen={!!rejectTarget}
        requestId={rejectTarget?.id ?? ''}
        userName={rejectTarget?.userName ?? ''}
        onConfirm={handleReject}
        onClose={() => setRejectTarget(null)}
      />
    </div>
  )
}
