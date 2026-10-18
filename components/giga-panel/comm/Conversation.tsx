'use client'

/**
 * One user's conversation in GIGA «Сообщения» and in User 360 → «Сообщения»:
 * header (who answers, status, auto mode, WhatsApp, block), the feed (one
 * bubble per send with a delivery status per channel; profanity masked with
 * «Показать»), and the composer (channels or «Авто»).
 * Data: /api/giga-admin/comm/users/:userId (refreshed every 20 s while visible).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Ban, Bot, CheckCircle2, Eye, EyeOff, Lock, MessageSquareText, RefreshCw, RotateCcw, Send, ShieldAlert, UserRound } from 'lucide-react'
import {
  Badge, Button, ConfirmDialog, ErrorState, Field, Skeleton, cx, fmtAgo, fmtDateTime, gigaFetch, inputClass, useGigaQuery,
  type Tone,
} from '@/components/giga-panel/kit'
import type { MessageDTO, ThreadDTO } from '@/lib/comm/admin'
import type { ChannelAvailability } from '@/lib/comm/channels'
import { deliveryReasonLabel, MESSAGE_STATUS_LABELS } from '@/lib/comm/labels'
import { CHANNEL_LABELS, COMM_CHANNELS, MAX_BODY, THREAD_STATUS_LABELS, type CommChannel } from '@/lib/comm/types'

export interface ConversationData {
  user: { id: string; name: string; email: string | null; phone: string | null; company: string | null; telegramLinked: boolean }
  thread: ThreadDTO | null
  assignee: { id: string; name: string } | null
  channels: ChannelAvailability
  messages: MessageDTO[]
  can: { manage: boolean }
}

interface Assignee { id: string; name: string; roleLabel: string; canAnswer: boolean }

const POLL_MS = 20_000

const STATUS_TONE: Record<MessageDTO['status'], Tone> = {
  queued: 'neutral', sending: 'blue', sent: 'green', delivered: 'green', failed: 'red', skipped: 'amber',
}
const THREAD_TONE: Record<ThreadDTO['status'], Tone> = { open: 'neutral', waiting_staff: 'amber', waiting_user: 'blue', closed: 'neutral' }

/** Group rows of one send (same group_id) into a bubble. */
function bubbles(messages: MessageDTO[]): MessageDTO[][] {
  const map = new Map<string, MessageDTO[]>()
  for (const m of messages) {
    const g = map.get(m.groupId)
    if (g) g.push(m)
    else map.set(m.groupId, [m])
  }
  return Array.from(map.values())
}

export function Conversation({ userId, onChanged, className }: { userId: string; onChanged?: () => void; className?: string }) {
  const url = `/api/giga-admin/comm/users/${userId}`
  const q = useGigaQuery<{ data: ConversationData }>(url)
  const d = q.data?.data
  const reload = q.reload

  // Quiet refresh while the tab is visible (no poll in a hidden tab).
  useEffect(() => {
    const id = setInterval(() => { if (document.visibilityState === 'visible') void reload() }, POLL_MS)
    return () => clearInterval(id)
  }, [reload])

  // Opening the conversation marks it read for staff.
  const unread = d?.thread?.unreadStaff ?? 0
  useEffect(() => {
    if (unread > 0) void gigaFetch(url, { method: 'PATCH', json: { action: 'read' } }).then(() => onChanged?.()).catch(() => {})
  }, [unread, url, onChanged])

  const feedRef = useRef<HTMLDivElement>(null)
  const count = d?.messages.length ?? 0
  useEffect(() => { feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight }) }, [count])

  const patch = useCallback(async (json: Record<string, unknown>, done: string) => {
    try {
      await gigaFetch(url, { method: 'PATCH', json })
      toast.success(done)
      await reload()
      onChanged?.()
      return true
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось сохранить')
      return false
    }
  }, [url, reload, onChanged])

  if (q.error && !d) return <ErrorState error={q.error} onRetry={() => void reload()} />
  if (!d) return <Skeleton className={cx('h-[480px]', className)} />

  return (
    <section className={cx('flex min-h-[480px] flex-col rounded-2xl border border-white/[0.07] bg-white/[0.03]', className)}>
      <Header data={d} onPatch={patch} onReload={() => void reload()} />
      <div ref={feedRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4" style={{ maxHeight: 520 }}>
        {d.messages.length === 0 && (
          <p className="py-10 text-center text-xs text-slate-500">
            Сообщений пока нет. Напишите первым — пользователь получит сообщение в выбранных каналах.
          </p>
        )}
        {bubbles(d.messages).map((g) => <Bubble key={g[0].groupId} rows={g} />)}
      </div>
      {d.can.manage
        ? d.thread?.blockedAt
          ? <p className="border-t border-white/[0.06] px-4 py-3 text-xs text-red-300">Пользователь заблокирован в сообщениях — писать ему нельзя. Разблокируйте, чтобы ответить.</p>
          : <Composer userId={userId} channels={d.channels} onSent={() => { void reload(); onChanged?.() }} />
        : <p className="border-t border-white/[0.06] px-4 py-3 text-xs text-slate-500">Только просмотр: отвечать могут сотрудники с правом «Inbox: ответы и настройки».</p>}
    </section>
  )
}

// ─── Header ─────────────────────────────────────────────────────────────────

function Header({ data, onPatch, onReload }: { data: ConversationData; onPatch: (json: Record<string, unknown>, done: string) => Promise<boolean>; onReload: () => void }) {
  const t = data.thread
  const manage = data.can.manage
  const staff = useGigaQuery<{ data: Assignee[] }>(manage ? '/api/giga-admin/comm/assignees' : null)
  const [blockOpen, setBlockOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const run = async (json: Record<string, unknown>, done: string) => {
    setBusy(true)
    try { return await onPatch(json, done) } finally { setBusy(false) }
  }

  return (
    <header className="space-y-3 border-b border-white/[0.06] px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-100">{data.user.name}</p>
          <p className="truncate text-[11px] text-slate-500">
            {[data.user.company, data.user.email, data.user.phone].filter(Boolean).join(' · ') || '—'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {t && <Badge tone={THREAD_TONE[t.status]}>{THREAD_STATUS_LABELS[t.status]}</Badge>}
          {t?.overdue && <Badge tone="red" title={t.dueAt ? `Ответить нужно было до ${fmtDateTime(t.dueAt)}` : undefined}>просрочен</Badge>}
          {t?.mode === 'auto' && <Badge tone="violet"><Bot size={10} /> авто</Badge>}
          {!!t?.profanityCount && <Badge tone="red" title="Сообщений с нецензурной лексикой"><ShieldAlert size={10} /> нарушений: {t.profanityCount}</Badge>}
          {t?.blockedAt && <Badge tone="red" title={t.blockReason ?? undefined}><Lock size={10} /> заблокирован</Badge>}
          <Button size="sm" variant="ghost" icon={<RefreshCw size={12} />} onClick={onReload} aria-label="Обновить" />
        </div>
      </div>

      {manage && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-[11px] text-slate-500">
            <UserRound size={12} />
            <select
              aria-label="Ответственный"
              value={data.assignee?.id ?? ''}
              disabled={busy}
              onChange={(e) => void run({ action: 'assign', assigneeId: e.target.value || null }, e.target.value ? 'Ответственный назначен' : 'Ответственный снят')}
              className="rounded-lg border border-white/[0.08] bg-[#0b1128] px-2 py-1 text-[11px] text-slate-200 focus:outline-none"
            >
              <option value="">Без ответственного</option>
              {data.assignee && !(staff.data?.data ?? []).some((s) => s.id === data.assignee!.id) && <option value={data.assignee.id}>{data.assignee.name}</option>}
              {(staff.data?.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name} · {s.roleLabel}</option>)}
            </select>
          </label>
          {t?.status === 'closed'
            ? <Button size="sm" icon={<RotateCcw size={12} />} disabled={busy} onClick={() => void run({ action: 'reopen' }, 'Диалог открыт')}>Открыть снова</Button>
            : <Button size="sm" icon={<CheckCircle2 size={12} />} disabled={busy} onClick={() => void run({ action: 'close' }, 'Диалог закрыт')}>Закрыть</Button>}
          <Button
            size="sm"
            variant={t?.mode === 'auto' ? 'primary' : 'secondary'}
            icon={<Bot size={12} />}
            disabled={busy}
            title="Автоответ бота для этого диалога (бот всегда представляется ботом и зовёт эксперта)"
            onClick={() => void run({ action: 'mode', mode: t?.mode === 'auto' ? 'manual' : 'auto' }, t?.mode === 'auto' ? 'Автоответ выключен' : 'Автоответ включён')}
          >
            Авто: {t?.mode === 'auto' ? 'вкл' : 'выкл'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            title="Не отправлять этому пользователю сообщения в WhatsApp"
            onClick={() => void run({ action: 'whatsapp_opt_out', value: !t?.whatsappOptOut }, t?.whatsappOptOut ? 'WhatsApp снова разрешён' : 'WhatsApp выключен для пользователя')}
          >
            WhatsApp: {t?.whatsappOptOut ? 'отписан' : 'разрешён'}
          </Button>
          {t?.blockedAt
            ? <Button size="sm" variant="warning" icon={<Ban size={12} />} disabled={busy} onClick={() => void run({ action: 'unblock' }, 'Пользователь разблокирован')}>Разблокировать</Button>
            : <Button size="sm" variant="danger" icon={<Ban size={12} />} disabled={busy} onClick={() => setBlockOpen(true)}>Заблокировать пользователя</Button>}
        </div>
      )}

      <ConfirmDialog
        open={blockOpen}
        onClose={() => setBlockOpen(false)}
        title="Заблокировать пользователя в сообщениях?"
        text="Его сообщения будут сохраняться, но сотрудникам не придут уведомления, бот не ответит, а отправить ему ничего будет нельзя. Аккаунт и доступ к кабинету не меняются."
        confirmLabel="Заблокировать"
        loading={busy}
        onConfirm={async () => {
          if (await run({ action: 'block', reason: reason.trim() || null }, 'Пользователь заблокирован в сообщениях')) {
            setBlockOpen(false)
            setReason('')
          }
        }}
      >
        <Field label="Причина (видна сотрудникам)">
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} className={inputClass} placeholder="Например: оскорбления" />
        </Field>
      </ConfirmDialog>
    </header>
  )
}

// ─── Feed ───────────────────────────────────────────────────────────────────

function Bubble({ rows }: { rows: MessageDTO[] }) {
  const m = rows[0]
  const inbound = m.direction === 'in'
  const [original, setOriginal] = useState<string | null>(null)
  const [showOriginal, setShowOriginal] = useState(false)
  const [loading, setLoading] = useState(false)

  const toggleOriginal = async () => {
    if (showOriginal) { setShowOriginal(false); return }
    if (original === null) {
      setLoading(true)
      try {
        const res = await gigaFetch<{ data: { body: string } }>(`/api/giga-admin/comm/messages/${m.id}/original`)
        setOriginal(res.data.body)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Не удалось загрузить оригинал')
        return
      } finally {
        setLoading(false)
      }
    }
    setShowOriginal(true)
  }

  const author = inbound ? 'Пользователь' : m.authorKind === 'bot' ? 'Бот' : m.authorKind === 'system' ? 'Система' : m.authorName || 'Сотрудник'
  return (
    <div className={cx('flex', inbound ? 'justify-start' : 'justify-end')}>
      <div className={cx(
        'max-w-[85%] rounded-2xl border px-3.5 py-2.5',
        inbound ? 'border-white/[0.08] bg-white/[0.04]' : m.authorKind === 'system' ? 'border-white/[0.06] bg-white/[0.02]' : 'border-blue-500/25 bg-blue-500/10',
      )}>
        <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[10px] text-slate-500">
          <span className="font-medium text-slate-400">{author}</span>
          <span title={fmtDateTime(m.createdAt)}>{fmtAgo(m.createdAt)}</span>
          {m.profanity && <Badge tone="red">нецензурное</Badge>}
        </div>
        {m.subject && <p className="mb-1 text-xs font-semibold text-slate-200">{m.subject}</p>}
        <p className="whitespace-pre-wrap break-words text-sm text-slate-200">{showOriginal && original !== null ? original : m.body}</p>
        {m.masked && (
          <button type="button" onClick={() => void toggleOriginal()} disabled={loading} className="mt-1 inline-flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-300">
            {showOriginal ? <EyeOff size={10} /> : <Eye size={10} />}
            {loading ? 'Загрузка…' : showOriginal ? 'Скрыть' : 'Показать'}
          </button>
        )}
        <div className="mt-1.5 flex flex-wrap gap-1">
          {rows.map((r) => (
            <Badge key={r.id} tone={inbound ? 'neutral' : STATUS_TONE[r.status]} title={deliveryReasonLabel(r.error) ?? undefined}>
              {CHANNEL_LABELS[r.channel]}{inbound ? '' : ` · ${MESSAGE_STATUS_LABELS[r.status]}`}
            </Badge>
          ))}
        </div>
        {!inbound && rows.some((r) => r.error) && (
          <p className="mt-1 text-[10px] text-amber-300/80">
            {rows.filter((r) => r.error).map((r) => `${CHANNEL_LABELS[r.channel]}: ${deliveryReasonLabel(r.error)}`).join(' · ')}
          </p>
        )}
      </div>
    </div>
  )
}

// ─── Composer ───────────────────────────────────────────────────────────────

function Composer({ userId, channels, onSent }: { userId: string; channels: ChannelAvailability; onSent: () => void }) {
  const [body, setBody] = useState('')
  const [subject, setSubject] = useState('')
  const [auto, setAuto] = useState(true)
  const [picked, setPicked] = useState<CommChannel[]>(['app'])
  const [important, setImportant] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const showSubject = auto ? channels.email.ok : picked.includes('email')
  // The pop-up lives on the in-app copy: «важное» needs the «Платформа» channel.
  const appIncluded = auto ? channels.app.ok : picked.includes('app')
  const canSend = body.trim().length > 0 && body.length <= MAX_BODY && (auto || picked.length > 0) && !sending

  const toggle = (c: CommChannel) => setPicked((p) => (p.includes(c) ? p.filter((x) => x !== c) : [...p, c]))
  const hint = useMemo(() => (auto ? 'Авто: каналы из настроек уведомлений пользователя + тот, откуда он писал последним' : null), [auto])

  const send = async () => {
    if (!canSend) return
    setSending(true)
    setError(null)
    try {
      const res = await gigaFetch<{ data: { ok: boolean; messages: Array<{ channel: CommChannel; status: string; error: string | null }> } }>(
        `/api/giga-admin/comm/users/${userId}/messages`,
        { method: 'POST', json: { body, subject: showSubject && subject.trim() ? subject.trim() : null, channels: auto ? 'auto' : picked, ...(important && appIncluded ? { important: true } : {}) } },
      )
      const failed = res.data.messages.filter((m) => m.status === 'failed' || m.status === 'skipped')
      if (res.data.ok) toast.success(failed.length ? `Отправлено, но не во все каналы: ${failed.map((f) => CHANNEL_LABELS[f.channel]).join(', ')}` : 'Сообщение отправлено')
      else toast.error('Сообщение не дошло ни до одного канала — причины в ленте')
      setBody('')
      setSubject('')
      setImportant(false)
      onSent()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось отправить')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-2 border-t border-white/[0.06] px-4 py-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => setAuto((a) => !a)}
          aria-pressed={auto}
          className={cx('rounded-lg border px-2.5 py-1 text-[11px] font-medium', auto ? 'border-blue-500/40 bg-blue-500/15 text-blue-200' : 'border-white/[0.08] text-slate-400 hover:text-slate-200')}
        >
          Авто
        </button>
        {COMM_CHANNELS.map((c) => {
          const a = channels[c]
          const reason = a.ok ? null : deliveryReasonLabel(a.reason)
          return (
            <label key={c} title={reason ?? undefined} className={cx('flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px]', auto ? 'opacity-40' : '', a.ok ? 'border-white/[0.08] text-slate-300' : 'border-white/[0.05] text-slate-600')}>
              <input type="checkbox" disabled={auto} checked={!auto && picked.includes(c)} onChange={() => toggle(c)} className="accent-blue-500" />
              {CHANNEL_LABELS[c]}
              {!a.ok && <span className="text-[9px]">({reason})</span>}
            </label>
          )
        })}
      </div>
      {hint && <p className="text-[10px] text-slate-600">{hint}</p>}
      {showSubject && (
        <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} placeholder="Тема письма (необязательно)" className={cx(inputClass, 'py-1.5 text-xs')} />
      )}
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send() } }}
        rows={3}
        maxLength={MAX_BODY}
        placeholder="Сообщение пользователю… (Ctrl+Enter — отправить)"
        className={cx(inputClass, 'resize-y')}
      />
      <label className={cx('flex items-start gap-2 text-[11px]', appIncluded ? 'text-slate-300' : 'text-slate-600')} title={appIncluded ? undefined : 'Окно показывается в кабинете — выберите канал «Платформа»'}>
        <input type="checkbox" checked={important && appIncluded} disabled={!appIncluded} onChange={(e) => setImportant(e.target.checked)} className="mt-0.5 accent-blue-500" />
        <span>
          Важное — показать окном, требует ответа
          <span className="block text-[10px] text-slate-600">Пользователь увидит сообщение поверх страницы кабинета, не только в «Сообщениях».</span>
        </span>
      </label>
      {error && <p role="alert" className="text-[11px] text-red-300">{error}</p>}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-slate-600">{body.length}/{MAX_BODY}</span>
        <Button variant="primary" size="sm" icon={sending ? undefined : <Send size={12} />} loading={sending} disabled={!canSend} onClick={() => void send()}>
          Отправить
        </Button>
      </div>
    </div>
  )
}

export function ConversationEmpty() {
  return (
    <div className="flex min-h-[480px] flex-col items-center justify-center rounded-2xl border border-white/[0.07] bg-white/[0.03] p-8 text-center">
      <MessageSquareText size={28} className="text-slate-600" />
      <p className="mt-3 text-sm text-slate-300">Выберите диалог слева</p>
      <p className="mt-1 text-xs text-slate-500">или начните новый — кнопка «Новый диалог».</p>
    </div>
  )
}
