'use client'

/**
 * «Новая рассылка» — the wizard of GIGA «Рассылки»:
 *   1. текст      название (внутреннее + заголовок уведомления), тема письма, текст;
 *   2. каналы     платформа / почта / Telegram / WhatsApp;
 *   3. аудитория  фильтры списка пользователей (те же, что в «Пользователях»:
 *                 поиск, сегмент — в т.ч. анкета и GRI, статус, роль,
 *                 ответственный) или выбранные вручную;
 *   4. проверка   сколько получателей по каналам и почему кому-то не дойдёт →
 *                 «Сохранить черновик» / «Запустить».
 * Profanity in a field is refused by the server (400 with the field) — the
 * wizard jumps back to the text and marks the field.
 */
import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, Megaphone, Rocket, Save, Trash2, UserPlus, Users } from 'lucide-react'
import { toast } from 'sonner'
import {
  Badge, Button, ConfirmDialog, ErrorState, Field, Modal, SearchInput, Select, Skeleton, cx, inputClass, useDebounced, useGigaQuery,
} from '@/components/giga-panel/kit'
import { PROFILE_ROLE, PROFILE_STATUS, USER_SEGMENT_LABELS } from '@/lib/admin/labels'
import { deliveryReasonLabel } from '@/lib/comm/labels'
import { CHANNEL_LABELS, COMM_CHANNELS, MAX_BODY, type CommChannel } from '@/lib/comm/types'

export interface CampaignSchedule {
  window: string
  open: boolean
  nextAt: string | null
  intervalSeconds: number
  jitterSeconds: number
}

interface ChannelPlan { send: number; skipped: number; reasons: Record<string, number> }
interface Preview {
  users: number
  perChannel: Partial<Record<CommChannel, ChannelPlan>>
  truncated: boolean
  outOfScope: number
  max: number
}

type Step = 'text' | 'channels' | 'audience' | 'preview'
const STEPS: Array<{ key: Step; label: string }> = [
  { key: 'text', label: 'Текст' },
  { key: 'channels', label: 'Каналы' },
  { key: 'audience', label: 'Аудитория' },
  { key: 'preview', label: 'Проверка' },
]

const SEGMENTS = [{ value: '', label: 'Все сегменты' }, ...Object.entries(USER_SEGMENT_LABELS).map(([value, label]) => ({ value, label }))]
const STATUSES = [{ value: '', label: 'Любой статус' }, ...Object.entries(PROFILE_STATUS).map(([value, v]) => ({ value, label: v.label }))]
const ROLES = [{ value: '', label: 'Любая роль' }, ...['client', 'expert', 'admin', 'super_admin'].map((value) => ({ value, label: PROFILE_ROLE[value] }))]
const ASSIGNEE = [
  { value: '', label: 'Все клиенты' },
  { value: 'me', label: 'Мои клиенты' },
  { value: 'none', label: 'Без ответственного' },
]

const CHANNEL_HINTS: Record<CommChannel, string> = {
  app: 'Колокольчик и «Сообщения» в кабинете — доходит до всех',
  email: 'Письмо в фирменной вёрстке (Resend)',
  telegram: 'Только тем, кто привязал Telegram-бота',
  whatsapp: 'С QR-номера AIStart360; не тем, кто отписался',
}

export function reasonLabel(code: string): string {
  if (code === 'blocked') return 'заблокирован в сообщениях'
  return deliveryReasonLabel(code) ?? code
}

interface Filters { q: string; segment: string; status: string; role: string; assignee: string }
interface PickedUser { id: string; name: string; hint: string }
interface UserRow { id: string; full_name: string | null; email: string | null; company_name?: string | null }

/** POST that keeps the error body (field of a profanity refusal). */
async function postJson<T>(url: string, json: unknown): Promise<{ ok: boolean; status: number; body: T & { error?: string; field?: string } }> {
  try {
    const res = await fetch(url, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(json) })
    const body = await res.json().catch(() => ({}))
    return { ok: res.ok && body?.ok !== false, status: res.status, body }
  } catch {
    return { ok: false, status: 0, body: { error: 'Нет связи с сервером. Проверьте соединение и повторите.' } as T & { error?: string } }
  }
}

/** Rough sending time in working hours: users × (interval + jitter / 2). */
export function estimateDuration(users: number, s: Pick<CampaignSchedule, 'intervalSeconds' | 'jitterSeconds'> | null): string {
  if (!s || users <= 0) return '—'
  const sec = users * (s.intervalSeconds + s.jitterSeconds / 2)
  if (sec < 90) return `≈ ${Math.max(1, Math.round(sec))} с`
  if (sec < 5400) return `≈ ${Math.round(sec / 60)} мин`
  return `≈ ${(sec / 3600).toFixed(1).replace('.', ',')} ч рабочего времени`
}

export function CampaignWizard({ open, onClose, onCreated, schedule }: {
  open: boolean
  onClose: () => void
  onCreated: (id: string) => void
  schedule: CampaignSchedule | null
}) {
  const [step, setStep] = useState<Step>('text')
  const [title, setTitle] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [channels, setChannels] = useState<CommChannel[]>(['app'])
  const [kind, setKind] = useState<'filters' | 'users'>('filters')
  const [filters, setFilters] = useState<Filters>({ q: '', segment: '', status: 'approved', role: 'client', assignee: '' })
  const [picked, setPicked] = useState<Map<string, PickedUser>>(new Map())
  const [preview, setPreview] = useState<Preview | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [saving, setSaving] = useState<null | 'draft' | 'start'>(null)
  const [confirm, setConfirm] = useState(false)
  const [fieldError, setFieldError] = useState<{ field: string; message: string } | null>(null)

  useEffect(() => {
    if (open) return
    setStep('text'); setTitle(''); setSubject(''); setBody(''); setChannels(['app']); setKind('filters')
    setFilters({ q: '', segment: '', status: 'approved', role: 'client', assignee: '' }); setPicked(new Map())
    setPreview(null); setPreviewError(null); setFieldError(null); setConfirm(false)
  }, [open])

  const audience = useMemo(() => (kind === 'filters'
    ? { kind: 'filters' as const, filters }
    : { kind: 'users' as const, userIds: Array.from(picked.keys()) }), [kind, filters, picked])

  // Any change of channels / audience invalidates the numbers.
  useEffect(() => { setPreview(null); setPreviewError(null) }, [channels, audience])

  const textOk = title.trim().length > 0 && body.trim().length > 0 && body.length <= MAX_BODY
  const audienceOk = kind === 'filters' || picked.size > 0
  const canGo: Record<Step, boolean> = { text: textOk, channels: textOk && channels.length > 0, audience: textOk && channels.length > 0 && audienceOk, preview: !!preview }
  const index = STEPS.findIndex((s) => s.key === step)

  const runPreview = async () => {
    setPreviewing(true)
    setPreviewError(null)
    const res = await postJson<{ data: Preview }>('/api/giga-admin/comm/campaigns/preview', { channels, audience })
    setPreviewing(false)
    if (res.ok) setPreview(res.body.data)
    else setPreviewError(res.body.error || `Ошибка сервера (${res.status})`)
  }
  useEffect(() => { if (open && step === 'preview' && !preview && !previewing && !previewError) void runPreview() }, [open, step, preview]) // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (start: boolean) => {
    setSaving(start ? 'start' : 'draft')
    setFieldError(null)
    const res = await postJson<{ data: { id: string; status: string } }>('/api/giga-admin/comm/campaigns', {
      title: title.trim(), subject: channels.includes('email') && subject.trim() ? subject.trim() : null, body, channels, audience, start,
    })
    setSaving(null)
    setConfirm(false)
    if (res.body.field) {
      setFieldError({ field: res.body.field, message: res.body.error || 'Уберите нецензурные слова' })
      setStep('text')
      return
    }
    if (!res.ok) {
      // A failed start keeps the draft: open it so it can be fixed and started from the card.
      if (res.body.data?.id) {
        toast.error(res.body.error || 'Рассылка сохранена как черновик, но не запущена')
        onCreated(res.body.data.id)
        return
      }
      toast.error(res.body.error || `Ошибка сервера (${res.status})`)
      return
    }
    toast.success(start ? 'Рассылка запущена — сообщения уходят по одному в рабочие часы' : 'Черновик сохранён')
    onCreated(res.body.data.id)
  }

  const next = () => { if (canGo[step] && index < STEPS.length - 1) setStep(STEPS[index + 1].key) }

  return (
    <Modal
      open={open}
      onClose={saving ? () => {} : onClose}
      wide
      title={<span className="flex items-center gap-2"><Megaphone size={14} className="text-blue-300" /> Новая рассылка</span>}
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <Button variant="ghost" size="sm" icon={<ArrowLeft size={12} />} disabled={index === 0 || !!saving} onClick={() => setStep(STEPS[Math.max(0, index - 1)].key)}>Назад</Button>
          {step !== 'preview' ? (
            <Button variant="primary" size="sm" icon={<ArrowRight size={12} />} disabled={!canGo[step]} onClick={next}>Далее</Button>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" icon={<Save size={12} />} loading={saving === 'draft'} disabled={!!saving} onClick={() => void submit(false)}>Сохранить черновик</Button>
              <Button variant="primary" size="sm" icon={<Rocket size={12} />} disabled={!preview || !!saving || preview.truncated || !hasRecipients(preview)} onClick={() => setConfirm(true)}>Запустить</Button>
            </div>
          )}
        </div>
      }
    >
      <ol className="mb-4 flex flex-wrap gap-1.5" aria-label="Шаги">
        {STEPS.map((s, i) => (
          <li key={s.key}>
            <button
              type="button"
              onClick={() => { if (i <= index || STEPS.slice(0, i).every((p) => canGo[p.key])) setStep(s.key) }}
              aria-current={step === s.key ? 'step' : undefined}
              className={cx(
                'rounded-lg border px-2.5 py-1 text-[11px] font-medium',
                step === s.key ? 'border-blue-500/40 bg-blue-500/15 text-blue-200' : i < index ? 'border-white/[0.08] text-slate-300' : 'border-white/[0.05] text-slate-600',
              )}
            >
              {i + 1}. {s.label}
            </button>
          </li>
        ))}
      </ol>

      {step === 'text' && (
        <div className="space-y-3">
          <Field label="Название рассылки" hint="Видно в списке рассылок и заголовком уведомления в кабинете.">
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className={cx(inputClass, fieldError?.field === 'title' && 'border-red-500/50')} placeholder="Например: Новые отчёты Точки А" />
          </Field>
          <Field label="Тема письма (для почты)" hint="Пусто — темой станет название.">
            <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} className={cx(inputClass, fieldError?.field === 'subject' && 'border-red-500/50')} placeholder="Тема письма" />
          </Field>
          <Field label="Текст" hint={`${body.length}/${MAX_BODY}. Придёт от имени AIStart360; ответы пользователей попадут в «Сообщения».`}>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={7} maxLength={MAX_BODY} className={cx(inputClass, 'resize-y', fieldError?.field === 'body' && 'border-red-500/50')} placeholder="Текст рассылки…" />
          </Field>
          {fieldError && <p role="alert" className="text-[11px] text-red-300">{fieldError.message} (поле: {fieldError.field === 'title' ? 'название' : fieldError.field === 'subject' ? 'тема' : 'текст'})</p>}
        </div>
      )}

      {step === 'channels' && (
        <div className="space-y-2">
          {COMM_CHANNELS.map((c) => (
            <label key={c} className={cx('flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5', channels.includes(c) ? 'border-blue-500/30 bg-blue-500/[0.07]' : 'border-white/[0.07] bg-white/[0.02]')}>
              <input type="checkbox" checked={channels.includes(c)} onChange={() => setChannels((p) => (p.includes(c) ? p.filter((x) => x !== c) : [...p, c]))} className="mt-0.5 accent-blue-500" />
              <span>
                <span className="block text-xs font-medium text-slate-200">{CHANNEL_LABELS[c]}</span>
                <span className="block text-[11px] text-slate-500">{CHANNEL_HINTS[c]}</span>
              </span>
            </label>
          ))}
          <p className="text-[11px] text-slate-500">Один человек получает рассылку по каждому каналу не больше одного раза.</p>
        </div>
      )}

      {step === 'audience' && (
        <AudienceStep kind={kind} setKind={setKind} filters={filters} setFilters={setFilters} picked={picked} setPicked={setPicked} />
      )}

      {step === 'preview' && (
        <div className="space-y-3">
          {previewing && <Skeleton className="h-40" />}
          {previewError && <ErrorState error={{ message: previewError }} onRetry={() => void runPreview()} />}
          {preview && <PreviewView preview={preview} channels={channels} schedule={schedule} />}
        </div>
      )}

      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => void submit(true)}
        loading={saving === 'start'}
        tone="primary"
        title="Запустить рассылку?"
        confirmLabel="Запустить"
        text={preview && (
          <>
            {preview.users} получател{plural(preview.users, 'ь', 'я', 'ей')}. Сообщения уходят по одному, с паузой {schedule?.intervalSeconds ?? 10} с + до {schedule?.jitterSeconds ?? 5} с,
            только в рабочие часы{schedule ? ` (${schedule.window})` : ''}. Остановить можно в карточке рассылки.
          </>
        )}
      />
    </Modal>
  )
}

function hasRecipients(p: Preview): boolean {
  return Object.values(p.perChannel).some((c) => (c?.send ?? 0) > 0)
}

export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}

function AudienceStep({ kind, setKind, filters, setFilters, picked, setPicked }: {
  kind: 'filters' | 'users'
  setKind: (k: 'filters' | 'users') => void
  filters: Filters
  setFilters: (f: Filters) => void
  picked: Map<string, PickedUser>
  setPicked: (m: Map<string, PickedUser>) => void
}) {
  const [q, setQ] = useState(filters.q)
  const debounced = useDebounced(q, 350)
  useEffect(() => { if (debounced !== filters.q) setFilters({ ...filters, q: debounced }) }, [debounced]) // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: keyof Filters) => (v: string) => setFilters({ ...filters, [k]: v })

  // The same request as the users list → the same number of people.
  const listParams = useMemo(() => {
    const p = new URLSearchParams()
    for (const k of ['q', 'segment', 'status', 'role', 'assignee'] as const) if (filters[k]) p.set(k, filters[k])
    return p.toString()
  }, [filters])
  const count = useGigaQuery<{ total: number }>(kind === 'filters' ? `/api/giga-admin/users?pageSize=5&${listParams}` : null)

  const [search, setSearch] = useState('')
  const sq = useDebounced(search, 300)
  const found = useGigaQuery<{ data: UserRow[] }>(kind === 'users' && sq.trim().length >= 2 ? `/api/giga-admin/users?q=${encodeURIComponent(sq.trim())}&pageSize=10` : null)

  const add = (u: UserRow) => {
    const next = new Map(picked)
    next.set(u.id, { id: u.id, name: u.full_name || u.email || u.id, hint: [u.company_name, u.email].filter(Boolean).join(' · ') })
    setPicked(next)
  }
  const remove = (id: string) => { const next = new Map(picked); next.delete(id); setPicked(next) }

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5">
        {([['filters', 'По фильтрам списка пользователей', <Users key="f" size={12} />], ['users', 'Выбрать вручную', <UserPlus key="u" size={12} />]] as const).map(([k, label, icon]) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            aria-pressed={kind === k}
            className={cx('flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium', kind === k ? 'border-blue-500/40 bg-blue-500/15 text-blue-200' : 'border-white/[0.08] text-slate-400 hover:text-slate-200')}
          >
            {icon}{label}
          </button>
        ))}
      </div>

      {kind === 'filters' ? (
        <div className="space-y-2">
          <SearchInput value={q} onChange={setQ} placeholder="Имя, email или компания" />
          <div className="flex flex-wrap gap-2">
            <Select label="Сегмент" value={filters.segment} onChange={set('segment')} options={SEGMENTS} />
            <Select label="Статус" value={filters.status} onChange={set('status')} options={STATUSES} />
            <Select label="Роль" value={filters.role} onChange={set('role')} options={ROLES} />
            <Select label="Ответственный" value={filters.assignee} onChange={set('assignee')} options={ASSIGNEE} />
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2 text-[11px] text-slate-400">
            {count.loading ? 'Считаем…' : count.error ? count.error.message : <>В списке пользователей с этими фильтрами: <b className="text-slate-200">{count.data?.total ?? 0}</b></>}
            <a href={`/admin-giga-panel/users?${listParams}`} target="_blank" rel="noreferrer" className="ml-auto text-blue-300 hover:underline">Открыть список</a>
          </div>
          <p className="text-[10px] text-slate-600">Те же фильтры, что в разделе «Пользователи»: анкета и GRI — в «Сегменте». «Мои клиенты» — ваши клиенты на момент сохранения.</p>
        </div>
      ) : (
        <div className="space-y-2">
          <SearchInput value={search} onChange={setSearch} placeholder="Найти пользователя: имя, email или компания" />
          {sq.trim().length >= 2 && (
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {found.loading && <Skeleton className="h-9" />}
              {found.error && <ErrorState error={found.error} />}
              {found.data && found.data.data.length === 0 && <p className="text-[11px] text-slate-500">Никого не нашли.</p>}
              {(found.data?.data ?? []).map((u) => (
                <button key={u.id} type="button" disabled={picked.has(u.id)} onClick={() => add(u)} className="flex w-full items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-1.5 text-left hover:bg-white/[0.06] disabled:opacity-40">
                  <span className="min-w-0">
                    <span className="block truncate text-xs text-slate-200">{u.full_name || u.email || u.id}</span>
                    <span className="block truncate text-[10px] text-slate-500">{[u.company_name, u.email].filter(Boolean).join(' · ')}</span>
                  </span>
                  <UserPlus size={12} className="shrink-0 text-slate-500" />
                </button>
              ))}
            </div>
          )}
          <p className="text-[11px] text-slate-400">Выбрано: <b className="text-slate-200">{picked.size}</b></p>
          <div className="flex flex-wrap gap-1.5">
            {Array.from(picked.values()).map((u) => (
              <span key={u.id} title={u.hint} className="inline-flex items-center gap-1 rounded-full border border-white/[0.08] bg-white/[0.04] py-0.5 pl-2 pr-1 text-[11px] text-slate-300">
                {u.name}
                <button type="button" onClick={() => remove(u.id)} aria-label={`Убрать ${u.name}`} className="rounded-full p-0.5 text-slate-500 hover:text-red-300"><Trash2 size={10} /></button>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function PreviewView({ preview, channels, schedule }: { preview: Preview; channels: CommChannel[]; schedule: CampaignSchedule | null }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-2xl font-bold tabular-nums text-slate-100">{preview.users}</span>
        <span className="text-xs text-slate-400">получател{plural(preview.users, 'ь', 'я', 'ей')} · время отправки {estimateDuration(preview.users, schedule)}</span>
      </div>
      {preview.truncated && (
        <p role="alert" className="rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">
          Под фильтры подходит больше {preview.max} человек — сузьте аудиторию, чтобы запустить.
        </p>
      )}
      {preview.outOfScope > 0 && (
        <p className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
          {preview.outOfScope} из выбранных — не ваши клиенты, им рассылка не уйдёт.
        </p>
      )}
      <div className="overflow-hidden rounded-xl border border-white/[0.07]">
        {channels.map((c) => {
          const p = preview.perChannel[c] ?? { send: 0, skipped: 0, reasons: {} }
          return (
            <div key={c} className="border-b border-white/[0.05] px-3 py-2.5 last:border-b-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-24 text-xs font-medium text-slate-200">{CHANNEL_LABELS[c]}</span>
                <Badge tone="green">уйдёт {p.send}</Badge>
                {p.skipped > 0 && <Badge tone="amber">не дойдёт {p.skipped}</Badge>}
              </div>
              {p.skipped > 0 && (
                <ul className="mt-1 space-y-0.5 text-[10px] text-slate-500 sm:pl-[6.5rem]">
                  {Object.entries(p.reasons).sort((a, b) => b[1] - a[1]).map(([r, n]) => <li key={r}>{reasonLabel(r)} — {n}</li>)}
                </ul>
              )}
            </div>
          )
        })}
      </div>
      {schedule && (
        <p className="text-[11px] text-slate-500">
          Отправка — только в рабочие часы: {schedule.window}, по одному сообщению с паузой {schedule.intervalSeconds} с + до {schedule.jitterSeconds} с.
          {!schedule.open && schedule.nextAt && <> Сейчас нерабочее время — первые сообщения уйдут {new Date(schedule.nextAt).toLocaleString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.</>}
        </p>
      )}
    </div>
  )
}
