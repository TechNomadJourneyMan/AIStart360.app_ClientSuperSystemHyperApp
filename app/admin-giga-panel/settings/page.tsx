'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  Activity, AlertTriangle, Bell, CheckCircle2, Database, ExternalLink, Eraser, KeyRound, LayoutGrid,
  Megaphone, RefreshCw, ScrollText, Send, ShieldCheck, Siren, Sparkles, UserPlus, Users2, Wrench, XCircle,
} from 'lucide-react'
import { RequirePermission, useStaff } from '@/components/giga-panel/StaffContext'
import {
  Badge, Button, ConfirmDialog, ErrorState, Field, PageHeader, Panel, Skeleton, cx, fmtAgo, fmtDateTime,
  gigaFetch, inputClass, useGigaQuery,
} from '@/components/giga-panel/kit'
import { NOTIFICATION_TYPES, SETTINGS, type AdminNotificationType, type SettingKey, type SettingValue } from '@/lib/settings/registry'

type Values = { [K in SettingKey]: SettingValue<K> }
interface SettingsResponse {
  values: Values
  meta: Record<string, { updated_at: string; updated_by: string | null }>
  actor: { kind: 'session' | 'staff_cookie' | 'break_glass'; canEdit: boolean }
}

// Confirmation copy for switches whose change affects every user.
const CONFIRM: Partial<Record<SettingKey, (next: boolean) => string>> = {
  access_gates: (on) => on
    ? 'Бесплатные пользователи потеряют доступ к PDF, AI-чату, бенчмаркам и повторным GRI сверх лимита.'
    : 'Все пользователи получат полный доступ независимо от тарифа.',
  insight_moderation: (on) => on
    ? 'Новые ИИ-инсайты будут попадать клиентам только после проверки.'
    : 'ИИ-инсайты начнут публиковаться клиентам без проверки эксперта.',
  staff_require_mfa: (on) => on
    ? 'Сотрудники без 2FA не смогут открыть панель, пока не включат её в своём профиле. Убедитесь, что у вас 2FA уже включена.'
    : 'Сотрудники смогут входить в панель без второго фактора.',
}

export default function SettingsPage() {
  const { can } = useStaff()
  const q = useGigaQuery<SettingsResponse>('/api/giga-admin/settings')
  const canEdit = can('settings.manage') && !!q.data?.actor.canEdit
  const [saving, setSaving] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ key: SettingKey; next: boolean } | null>(null)

  const save = async (patch: Partial<Values>, label: string): Promise<boolean> => {
    const tag = Object.keys(patch).join(',')
    setSaving(tag)
    try {
      const res = await gigaFetch<SettingsResponse & { changed: string[] }>('/api/giga-admin/settings', { method: 'PUT', json: { values: patch } })
      q.setData((d) => (d ? { ...d, values: res.values, meta: res.meta ?? d.meta } : d))
      toast.success(res.changed.length ? `${label}: сохранено` : `${label}: без изменений`)
      return true
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось сохранить')
      return false
    } finally {
      setSaving(null)
    }
  }

  const toggle = (key: SettingKey, next: boolean) => {
    if (CONFIRM[key]) setConfirm({ key, next })
    else void save({ [key]: next } as Partial<Values>, SETTINGS[key].label)
  }

  const v = q.data?.values
  const meta = q.data?.meta ?? {}

  return (
    <RequirePermission permission="users.manage">
      <PageHeader
        crumbs={[{ label: 'GIGA-CRM', href: '/admin-giga-panel' }, { label: 'Настройки' }]}
        title="Настройки платформы"
        description="Регистрация, тарифы, кабинет клиента, безопасность, аналитика и уведомления. Каждое изменение записывается в журнал аудита."
        actions={<Button size="sm" variant="ghost" icon={<RefreshCw size={13} />} onClick={() => void q.reload()}>Обновить</Button>}
      />
      {!canEdit && q.data && (
        <p className="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/[0.06] px-4 py-2.5 text-xs text-amber-200">
          У вас доступ только на просмотр: изменения сохранит только Super Admin.
        </p>
      )}

      {q.error && <ErrorState error={q.error} onRetry={() => void q.reload()} />}
      {q.loading && !v && (
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-48" />)}
        </div>
      )}

      {v && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title={<Title icon={<UserPlus size={14} />}>Регистрация и доступ</Title>}>
            <SettingRow k="registration_mode" meta={meta} stacked>
              <Segmented
                value={v.registration_mode}
                disabled={!canEdit || !!saving}
                options={[
                  { value: 'open', label: 'Открытая' },
                  { value: 'approval', label: 'По подтверждению' },
                  { value: 'invite', label: 'По приглашению' },
                ]}
                onChange={(mode) => void save({ registration_mode: mode }, 'Режим регистрации')}
              />
            </SettingRow>
            <SettingRow k="auto_approve_clients" meta={meta} note={v.registration_mode !== 'approval' ? 'Действует только в режиме «По подтверждению».' : undefined}>
              <Toggle checked={v.auto_approve_clients} disabled={!canEdit || !!saving} onChange={(n) => toggle('auto_approve_clients', n)} label={SETTINGS.auto_approve_clients.label} />
            </SettingRow>
            <SettingRow k="access_gates" meta={meta}>
              <Toggle checked={v.access_gates} disabled={!canEdit || !!saving} onChange={(n) => toggle('access_gates', n)} label={SETTINGS.access_gates.label} />
            </SettingRow>
            <SettingRow k="gri_free_runs" meta={meta} note={!v.access_gates ? 'Начнёт действовать после включения тарифных ограничений.' : undefined}>
              <NumberSetting
                value={v.gri_free_runs} min={0} max={20} suffix="шт."
                disabled={!canEdit} saving={saving === 'gri_free_runs'}
                onSave={(n) => save({ gri_free_runs: n }, 'Лимит GRI')}
              />
            </SettingRow>
            <Links items={[{ href: '/admin-giga-panel/requests', label: 'Заявки на доступ' }, { href: '/admin-giga-panel/users', label: 'Пользователи и тарифы' }]} />
          </Panel>

          <Panel title={<Title icon={<Sparkles size={14} />}>Контент и ИИ</Title>}>
            <SettingRow k="insight_moderation" meta={meta}>
              <Toggle checked={v.insight_moderation} disabled={!canEdit || !!saving} onChange={(n) => toggle('insight_moderation', n)} label={SETTINGS.insight_moderation.label} />
            </SettingRow>
            {(['ai_daily_budget_usd_free', 'ai_daily_budget_usd_pro', 'ai_daily_budget_usd_staff'] as const).map((k) => (
              <SettingRow key={k} k={k} meta={meta}>
                <NumberSetting
                  value={v[k]} min={0} max={1000} step={0.5} integer={false} suffix="$ в сутки"
                  disabled={!canEdit} saving={saving === k}
                  onSave={(n) => save({ [k]: n }, 'Дневной лимит ИИ')}
                />
              </SettingRow>
            ))}
            <Links items={[
              { href: '/admin-giga-panel/moderation', label: 'Очередь модерации' },
              { href: '/admin-giga-panel/sections', label: 'Разделы кабинета' },
              { href: '/admin-giga-panel/content', label: 'Материалы (CMS)' },
            ]} />
          </Panel>

          <AnnouncementCard value={v.announcement} meta={meta} disabled={!canEdit} saving={saving === 'announcement'} onSave={(a) => save({ announcement: a }, 'Объявление')} />
          <MaintenanceCard value={v.maintenance} meta={meta} disabled={!canEdit} saving={saving === 'maintenance'} onSave={(m) => save({ maintenance: m }, 'Технические работы')} />

          <Panel title={<Title icon={<ShieldCheck size={14} />}>Безопасность</Title>}>
            <SettingRow k="impersonation_edit_enabled" meta={meta}>
              <Toggle checked={v.impersonation_edit_enabled} disabled={!canEdit || !!saving} onChange={(n) => toggle('impersonation_edit_enabled', n)} label={SETTINGS.impersonation_edit_enabled.label} />
            </SettingRow>
            <SettingRow k="impersonation_ttl_minutes" meta={meta}>
              <NumberSetting
                value={v.impersonation_ttl_minutes} min={5} max={120} step={5} suffix="мин"
                disabled={!canEdit} saving={saving === 'impersonation_ttl_minutes'}
                onSave={(n) => save({ impersonation_ttl_minutes: n }, 'Длительность сессии')}
              />
            </SettingRow>
            <SettingRow k="staff_require_mfa" meta={meta} >
              <Toggle checked={v.staff_require_mfa} disabled={!canEdit || !!saving} onChange={(n) => toggle('staff_require_mfa', n)} label={SETTINGS.staff_require_mfa.label} />
            </SettingRow>
            <Links items={[
              { href: '/admin-giga-panel/staff', label: 'Сотрудники и роли' },
              { href: '/admin-giga-panel/impersonation', label: 'Сессии «от имени»' },
              { href: '/admin-giga-panel/audit', label: 'Журнал аудита' },
            ]} />
          </Panel>

          <AnalyticsCard values={v} meta={meta} disabled={!canEdit} saving={saving} onToggle={(n) => toggle('analytics_enabled', n)} onSaveRetention={(n) => save({ events_retention_days: n }, 'Срок хранения')} onSave={save} />

          <Panel title={<Title icon={<Siren size={14} />}>Эскалации</Title>} description={SETTINGS.escalation_sla_hours.help}>
            {([
              ['critical', 'Критичный приоритет'],
              ['high', 'Высокий приоритет'],
              ['medium', 'Средний приоритет'],
              ['low', 'Низкий приоритет'],
            ] as const).map(([p, title]) => (
              <div key={p} className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.05] py-2.5 last:border-0">
                <span className="text-xs text-slate-300">{title}</span>
                <NumberSetting
                  value={v.escalation_sla_hours[p]} min={1} max={720} suffix="ч"
                  disabled={!canEdit} saving={saving === 'escalation_sla_hours'}
                  onSave={(n) => save({ escalation_sla_hours: { ...v.escalation_sla_hours, [p]: n } }, 'SLA эскалаций')}
                />
              </div>
            ))}
            <Links items={[{ href: '/admin-giga-panel/cases', label: 'Очередь эскалаций' }, { href: '/admin-giga-panel/experts', label: 'Эксперты' }]} />
          </Panel>

          <NotificationsCard value={v.admin_notifications} meta={meta} disabled={!canEdit} saving={saving === 'admin_notifications'} onSave={(n) => save({ admin_notifications: n }, 'Уведомления')} />

          <Panel title={<Title icon={<Send size={14} />}>Автоматические касания</Title>}>
            <SettingRow k="auto_reminders_enabled" meta={meta}>
              <Toggle checked={v.auto_reminders_enabled} disabled={!canEdit || !!saving} onChange={(n) => toggle('auto_reminders_enabled', n)} label={SETTINGS.auto_reminders_enabled.label} />
            </SettingRow>
            <SettingRow k="auto_touch_weekly_cap" meta={meta} note={!v.auto_reminders_enabled ? 'Напоминания выключены — лимит сейчас не действует.' : undefined}>
              <NumberSetting
                value={v.auto_touch_weekly_cap} min={0} max={14} suffix="в неделю"
                disabled={!canEdit} saving={saving === 'auto_touch_weekly_cap'}
                onSave={(n) => save({ auto_touch_weekly_cap: n }, 'Лимит касаний')}
              />
            </SettingRow>
            <SettingRow k="client_digest_enabled" meta={meta}>
              <Toggle checked={v.client_digest_enabled} disabled={!canEdit || !!saving} onChange={(n) => toggle('client_digest_enabled', n)} label={SETTINGS.client_digest_enabled.label} />
            </SettingRow>
            <SettingRow k="request_sla_hours" meta={meta}>
              <NumberSetting
                value={v.request_sla_hours} min={1} max={168} suffix="ч"
                disabled={!canEdit} saving={saving === 'request_sla_hours'}
                onSave={(n) => save({ request_sla_hours: n }, 'Срок ответа на заявку')}
              />
            </SettingRow>
            <Links items={[{ href: '/admin-giga-panel/requests', label: 'Заявки на доступ' }]} />
          </Panel>

          {canEdit && <HealthCard />}
        </div>
      )}

      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        tone={confirm && confirm.key === 'staff_require_mfa' && confirm.next ? 'danger' : 'warning'}
        title={confirm ? `${SETTINGS[confirm.key].label}: ${confirm.next ? 'включить' : 'выключить'}?` : ''}
        text={confirm ? CONFIRM[confirm.key]?.(confirm.next) : null}
        confirmLabel={confirm?.next ? 'Включить' : 'Выключить'}
        loading={!!saving}
        onConfirm={async () => {
          if (!confirm) return
          const ok = await save({ [confirm.key]: confirm.next } as Partial<Values>, SETTINGS[confirm.key].label)
          if (ok) setConfirm(null)
        }}
      />
    </RequirePermission>
  )
}

// ─── Building blocks ─────────────────────────────────────────────────────────

function Title({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return <span className="flex items-center gap-2"><span className="text-blue-300">{icon}</span>{children}</span>
}

function SettingRow({ k, meta, note, stacked, children }: { k: SettingKey; meta: SettingsResponse['meta']; note?: string; stacked?: boolean; children: ReactNode }) {
  const m = meta[k]
  return (
    <div className={cx('flex flex-col gap-2 border-b border-white/[0.05] py-3 first:pt-0 last:border-0', !stacked && 'sm:flex-row sm:items-start sm:justify-between')}>
      <div className={cx('min-w-0', !stacked && 'sm:max-w-[60%]')}>
        <p className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-slate-200">
          {SETTINGS[k].label}
          {SETTINGS[k].critical && <Badge tone="amber">важно</Badge>}
        </p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{SETTINGS[k].help}</p>
        {note && <p className="mt-1 text-[11px] text-amber-300/80">{note}</p>}
        {m && <p className="mt-1 text-[10px] text-slate-600" title={fmtDateTime(m.updated_at)}>Изменено {fmtAgo(m.updated_at)}{m.updated_by ? ` · ${shortActor(m.updated_by)}` : ''}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function shortActor(id: string): string {
  if (id.startsWith('giga:')) return 'общий пароль'
  return /^[0-9a-f-]{36}$/i.test(id) ? `сотрудник ${id.slice(0, 8)}` : id
}

function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative inline-flex h-6 w-11 items-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'border-emerald-400/40 bg-emerald-500/60' : 'border-white/[0.12] bg-white/[0.08]',
      )}
    >
      <span className={cx('inline-block h-4 w-4 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-6' : 'translate-x-1')} />
    </button>
  )
}

function Segmented<T extends string>({ value, options, onChange, disabled }: {
  value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void; disabled?: boolean
}) {
  return (
    <div role="radiogroup" className="inline-flex flex-wrap gap-1 rounded-xl border border-white/[0.08] bg-white/[0.03] p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          disabled={disabled || o.value === value}
          onClick={() => onChange(o.value)}
          className={cx(
            'rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-colors disabled:cursor-default',
            o.value === value ? 'bg-blue-500 text-white' : 'text-slate-400 hover:bg-white/[0.06] hover:text-slate-200 disabled:opacity-50',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function NumberSetting({ value, min, max, step = 1, integer = true, suffix, disabled, saving, onSave }: {
  value: number; min: number; max: number; step?: number; integer?: boolean; suffix: string; disabled?: boolean; saving?: boolean
  onSave: (n: number) => Promise<boolean>
}) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const n = Number(draft.replace(',', '.'))
  const valid = draft.trim() !== '' && Number.isFinite(n) && (!integer || Number.isInteger(n)) && n >= min && n <= max
  const dirty = valid && n !== value
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        inputMode={integer ? 'numeric' : 'decimal'}
        min={min}
        max={max}
        step={step}
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        aria-invalid={!valid}
        className={cx(inputClass, 'w-24 py-1.5 text-right', !valid && 'border-red-500/50')}
      />
      <span className="text-[11px] text-slate-500">{suffix}</span>
      {(dirty || !valid) && (
        <Button size="sm" variant="primary" disabled={!valid || disabled} loading={saving} onClick={() => void onSave(n)}>
          Сохранить
        </Button>
      )}
      {!valid && <span className="sr-only">Допустимо от {min} до {max}</span>}
    </div>
  )
}

function Links({ items }: { items: Array<{ href: string; label: string }> }) {
  return (
    <div className="mt-3 flex flex-wrap gap-2 border-t border-white/[0.05] pt-3">
      {items.map((i) => (
        <Link key={i.href} href={i.href} className="inline-flex items-center gap-1 rounded-lg border border-white/[0.08] px-2.5 py-1 text-[11px] text-slate-400 transition-colors hover:border-blue-500/30 hover:text-blue-200">
          {i.label} <ExternalLink size={11} />
        </Link>
      ))}
    </div>
  )
}

// ─── Cabinet: announcement & maintenance ─────────────────────────────────────

const TONE_OPTIONS = [
  { value: 'info', label: 'Инфо' },
  { value: 'success', label: 'Успех' },
  { value: 'warning', label: 'Важно' },
] as const
const TONE_PREVIEW = {
  info: 'border-sky-400/25 bg-sky-400/[0.08] text-sky-100',
  success: 'border-emerald-400/25 bg-emerald-400/[0.08] text-emerald-100',
  warning: 'border-amber-400/30 bg-amber-400/[0.1] text-amber-100',
} as const

function AnnouncementCard({ value, meta, disabled, saving, onSave }: {
  value: Values['announcement']; meta: SettingsResponse['meta']; disabled: boolean; saving: boolean
  onSave: (a: Values['announcement']) => Promise<boolean>
}) {
  const [d, setD] = useState(value)
  useEffect(() => setD(value), [value])
  const dirty = JSON.stringify(d) !== JSON.stringify(value)
  const hrefOk = d.link_href === '' || (d.link_href.startsWith('/') && !d.link_href.startsWith('//')) || d.link_href.startsWith('https://')
  const error = d.enabled && !d.text.trim() ? 'Введите текст объявления' : !hrefOk ? 'Ссылка должна начинаться с https:// или /' : (d.link_href && !d.link_label.trim()) ? 'Добавьте подпись к ссылке' : null
  const m = meta.announcement

  return (
    <Panel
      title={<Title icon={<Megaphone size={14} />}>Объявление в кабинете</Title>}
      description={SETTINGS.announcement.help}
      actions={<Toggle checked={d.enabled} disabled={disabled || saving} label="Показывать объявление" onChange={(enabled) => {
        const next = { ...d, enabled }
        setD(next)
        if (!enabled || next.text.trim()) void onSave(next)
      }} />}
    >
      <div className="space-y-3">
        <Field label="Текст" hint={`${d.text.length}/300`}>
          <textarea value={d.text} maxLength={300} rows={2} disabled={disabled} onChange={(e) => setD({ ...d, text: e.target.value })} className={inputClass} placeholder="Например: 1 октября — вебинар по росту выручки" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Тон">
            <select value={d.tone} disabled={disabled} onChange={(e) => setD({ ...d, tone: e.target.value as typeof d.tone })} className={cx(inputClass, 'bg-[#0b1128]')}>
              {TONE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="Подпись ссылки">
            <input value={d.link_label} maxLength={40} disabled={disabled} onChange={(e) => setD({ ...d, link_label: e.target.value })} className={inputClass} placeholder="Подробнее" />
          </Field>
          <Field label="Ссылка">
            <input value={d.link_href} maxLength={300} disabled={disabled} onChange={(e) => setD({ ...d, link_href: e.target.value.trim() })} className={cx(inputClass, !hrefOk && 'border-red-500/50')} placeholder="/client/content" />
          </Field>
        </div>
        {d.text.trim() && (
          <div>
            <p className="mb-1 text-[10px] uppercase tracking-wide text-slate-600">Предпросмотр</p>
            <div className={cx('rounded-xl border px-4 py-2.5 text-sm', TONE_PREVIEW[d.tone])}>
              {d.text}{d.link_label && d.link_href && <span className="ml-2 font-semibold underline">{d.link_label}</span>}
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[10px] text-slate-600">
            {d.enabled ? <Badge tone="green">показывается</Badge> : <Badge>скрыто</Badge>}
            {m && <span className="ml-2">Изменено {fmtAgo(m.updated_at)}</span>}
          </p>
          <div className="flex gap-2">
            {dirty && <Button size="sm" variant="ghost" disabled={saving} onClick={() => setD(value)}>Отменить</Button>}
            <Button size="sm" variant="primary" disabled={disabled || !dirty || !!error} loading={saving} onClick={() => void onSave(d)}>Сохранить</Button>
          </div>
        </div>
        {error && dirty && <p className="text-[11px] text-red-300">{error}</p>}
      </div>
    </Panel>
  )
}

function MaintenanceCard({ value, meta, disabled, saving, onSave }: {
  value: Values['maintenance']; meta: SettingsResponse['meta']; disabled: boolean; saving: boolean
  onSave: (m: Values['maintenance']) => Promise<boolean>
}) {
  const [d, setD] = useState(value)
  const [ask, setAsk] = useState(false)
  useEffect(() => setD(value), [value])
  const dirtyText = d.message !== value.message || d.until !== value.until
  const m = meta.maintenance

  return (
    <Panel
      title={<Title icon={<Wrench size={14} />}>Режим технических работ</Title>}
      description={SETTINGS.maintenance.help}
      actions={value.enabled ? <Badge tone="red">кабинет закрыт</Badge> : <Badge tone="green">кабинет работает</Badge>}
    >
      <div className="space-y-3">
        <Field label="Сообщение для клиентов">
          <textarea value={d.message} maxLength={500} rows={2} disabled={disabled} onChange={(e) => setD({ ...d, message: e.target.value })} className={inputClass} />
        </Field>
        <Field label="Ожидаемое окончание" hint="Свободный текст, например «сегодня до 18:00»">
          <input value={d.until} maxLength={40} disabled={disabled} onChange={(e) => setD({ ...d, until: e.target.value })} className={inputClass} />
        </Field>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[10px] text-slate-600">
            <Link href="/maintenance" target="_blank" className="text-blue-300 hover:underline">Открыть страницу</Link>
            {m && <span className="ml-2">Изменено {fmtAgo(m.updated_at)}</span>}
          </p>
          <div className="flex gap-2">
            {dirtyText && <Button size="sm" disabled={disabled} loading={saving && !ask} onClick={() => void onSave({ ...d, enabled: value.enabled })}>Сохранить текст</Button>}
            <Button size="sm" variant={value.enabled ? 'primary' : 'danger'} disabled={disabled} onClick={() => setAsk(true)}>
              {value.enabled ? 'Открыть кабинет' : 'Закрыть на работы'}
            </Button>
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={ask}
        onClose={() => setAsk(false)}
        tone={value.enabled ? 'primary' : 'danger'}
        title={value.enabled ? 'Открыть кабинет для клиентов?' : 'Закрыть кабинет на технические работы?'}
        text={value.enabled
          ? 'Клиенты снова смогут пользоваться кабинетом.'
          : 'Клиенты и владельцы увидят страницу «Ведутся работы». Панель управления и кабинет «от имени» продолжат работать.'}
        requireText={value.enabled ? undefined : 'РАБОТЫ'}
        confirmLabel={value.enabled ? 'Открыть' : 'Закрыть кабинет'}
        loading={saving}
        onConfirm={async () => {
          if (await onSave({ ...d, enabled: !value.enabled })) setAsk(false)
        }}
      />
    </Panel>
  )
}

// ─── Analytics ───────────────────────────────────────────────────────────────

const ACTIVATION_EVENTS: Array<{ value: Values['activation_event']; label: string }> = [
  { value: 'GRI_COMPLETED', label: 'GRI пройден' },
  { value: 'QUESTIONNAIRE_COMPLETED', label: 'Анкета заполнена' },
  { value: 'POINT_A_CALCULATED', label: 'Точка А рассчитана' },
]

function AnalyticsCard({ values, meta, disabled, saving, onToggle, onSaveRetention, onSave }: {
  values: Values; meta: SettingsResponse['meta']; disabled: boolean; saving: string | null
  onToggle: (n: boolean) => void; onSaveRetention: (n: number) => Promise<boolean>
  onSave: (patch: Partial<Values>, label: string) => Promise<boolean>
}) {
  const stats = useGigaQuery<{ days: number; old: number; total: number; before: string }>(disabled ? null : '/api/giga-admin/system/purge-events')
  const [ask, setAsk] = useState(false)
  const [purging, setPurging] = useState(false)
  const { reload } = stats

  const purge = async () => {
    setPurging(true)
    try {
      const r = await gigaFetch<{ deleted: number }>('/api/giga-admin/system/purge-events', { method: 'POST' })
      toast.success(`Удалено событий: ${r.deleted.toLocaleString('ru-RU')}`)
      setAsk(false)
      void reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось очистить')
    } finally {
      setPurging(false)
    }
  }

  return (
    <Panel title={<Title icon={<Activity size={14} />}>Аналитика</Title>}>
      <SettingRow k="analytics_enabled" meta={meta}>
        <Toggle checked={values.analytics_enabled} disabled={disabled || !!saving} onChange={onToggle} label={SETTINGS.analytics_enabled.label} />
      </SettingRow>
      <SettingRow k="events_retention_days" meta={meta}>
        <NumberSetting
          value={values.events_retention_days} min={30} max={1825} step={30} suffix="дн."
          disabled={disabled} saving={saving === 'events_retention_days'}
          onSave={async (n) => {
            const ok = await onSaveRetention(n)
            if (ok) void reload()
            return ok
          }}
        />
      </SettingRow>
      <SettingRow k="activation_event" meta={meta} stacked>
        <Segmented
          value={values.activation_event}
          options={ACTIVATION_EVENTS}
          disabled={disabled || !!saving}
          onChange={(v) => void onSave({ activation_event: v }, SETTINGS.activation_event.label)}
        />
      </SettingRow>
      <SettingRow k="activation_window_days" meta={meta}>
        <NumberSetting
          value={values.activation_window_days} min={1} max={90} suffix="дн."
          disabled={disabled} saving={saving === 'activation_window_days'}
          onSave={(n) => onSave({ activation_window_days: n }, SETTINGS.activation_window_days.label)}
        />
      </SettingRow>
      {!disabled && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
          <p className="text-[11px] text-slate-400">
            {stats.data
              ? <>Всего событий: <b className="text-slate-200">{stats.data.total.toLocaleString('ru-RU')}</b> · старше {stats.data.days} дн.: <b className="text-slate-200">{stats.data.old.toLocaleString('ru-RU')}</b></>
              : stats.error ? 'Не удалось получить статистику' : 'Считаем события…'}
          </p>
          <Button size="sm" variant="warning" icon={<Eraser size={12} />} disabled={!stats.data || stats.data.old === 0} onClick={() => setAsk(true)}>
            Очистить старые события
          </Button>
        </div>
      )}
      <Links items={[{ href: '/admin-giga-panel/activity', label: 'Аналитика активности' }, { href: '/admin-giga-panel/cjm', label: 'CJM' }]} />
      <ConfirmDialog
        open={ask}
        onClose={() => setAsk(false)}
        title="Удалить старые события?"
        text={stats.data ? `Будет удалено ${stats.data.old.toLocaleString('ru-RU')} событий старше ${fmtDateTime(stats.data.before)}. Это необратимо; журнал аудита не затрагивается.` : ''}
        requireText="УДАЛИТЬ"
        confirmLabel="Удалить события"
        loading={purging}
        onConfirm={() => void purge()}
      />
    </Panel>
  )
}

// ─── Notifications ───────────────────────────────────────────────────────────

function NotificationsCard({ value, meta, disabled, saving, onSave }: {
  value: Values['admin_notifications']; meta: SettingsResponse['meta']; disabled: boolean; saving: boolean
  onSave: (n: Values['admin_notifications']) => Promise<boolean>
}) {
  const types = Object.keys(NOTIFICATION_TYPES) as AdminNotificationType[]
  const onCount = types.filter((t) => value[t]).length
  const m = meta.admin_notifications
  const setAll = (on: boolean) => void onSave(Object.fromEntries(types.map((t) => [t, on])) as Values['admin_notifications'])
  return (
    <Panel
      title={<Title icon={<Bell size={14} />}>Уведомления администраторам</Title>}
      description={SETTINGS.admin_notifications.help}
      actions={<Badge tone={onCount ? 'blue' : 'neutral'}>{onCount} из {types.length}</Badge>}
    >
      <div className="grid gap-1 sm:grid-cols-2">
        {types.map((t) => (
          <label key={t} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 hover:bg-white/[0.03]">
            <span className="text-xs text-slate-300">{NOTIFICATION_TYPES[t]}</span>
            <Toggle checked={value[t]} disabled={disabled || saving} label={NOTIFICATION_TYPES[t]} onChange={(on) => void onSave({ ...value, [t]: on })} />
          </label>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.05] pt-3">
        <p className="text-[10px] text-slate-600">{m ? `Изменено ${fmtAgo(m.updated_at)}` : 'По умолчанию все включены'}</p>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" disabled={disabled || saving || onCount === types.length} onClick={() => setAll(true)}>Включить все</Button>
          <Button size="sm" variant="ghost" disabled={disabled || saving || onCount === 0} onClick={() => setAll(false)}>Выключить все</Button>
        </div>
      </div>
    </Panel>
  )
}

// ─── System health ───────────────────────────────────────────────────────────

interface Health {
  checkedAt: string
  runtime: { node: string; env: string; commit: string | null }
  db: { ok: boolean; ms: number }
  env: Array<{ key: string; label: string; required: boolean; configured: boolean }>
  tables: Array<{ name: string; ok: boolean; rows: number | null; error: string | null }>
  buckets: Array<{ name: string; ok: boolean }>
}

function HealthCard() {
  const h = useGigaQuery<Health>('/api/giga-admin/system/health')
  const problems = useMemo(() => {
    if (!h.data) return 0
    return h.data.env.filter((e) => e.required && !e.configured).length + h.data.tables.filter((t) => !t.ok).length + h.data.buckets.filter((b) => !b.ok).length
  }, [h.data])

  return (
    <Panel
      className="lg:col-span-2"
      title={<Title icon={<Database size={14} />}>Состояние системы</Title>}
      description="Секреты не показываются — только признак «настроено»."
      actions={
        <>
          {h.data && (problems ? <Badge tone="red">проблем: {problems}</Badge> : <Badge tone="green">всё в порядке</Badge>)}
          <Button size="sm" variant="ghost" icon={<RefreshCw size={12} />} loading={h.loading} onClick={() => void h.reload()}>Проверить</Button>
        </>
      }
    >
      {h.error && <ErrorState error={h.error} onRetry={() => void h.reload()} />}
      {!h.data && h.loading && <Skeleton className="h-40" />}
      {h.data && (
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500"><KeyRound size={12} /> Переменные окружения</p>
            <ul className="space-y-1">
              {h.data.env.map((e) => (
                <li key={e.key} className="flex items-center justify-between gap-2 text-[11px]" title={e.key}>
                  <span className={cx('truncate', e.configured ? 'text-slate-300' : e.required ? 'text-red-300' : 'text-slate-500')}>{e.label}</span>
                  <Status ok={e.configured} warn={!e.required} />
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500"><Database size={12} /> База данных · {h.data.db.ms} мс</p>
            <ul className="space-y-1">
              {h.data.tables.map((t) => (
                <li key={t.name} className="flex items-center justify-between gap-2 text-[11px]" title={t.error ?? undefined}>
                  <span className={cx('truncate font-mono', t.ok ? 'text-slate-300' : 'text-red-300')}>{t.name}</span>
                  <span className="flex items-center gap-2">
                    {t.rows !== null && <span className="tabular-nums text-slate-500">≈{t.rows.toLocaleString('ru-RU')}</span>}
                    <Status ok={t.ok} />
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500"><LayoutGrid size={12} /> Хранилище и среда</p>
            <ul className="space-y-1">
              {h.data.buckets.map((b) => (
                <li key={b.name} className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="font-mono text-slate-300">bucket: {b.name}</span>
                  <Status ok={b.ok} />
                </li>
              ))}
              <li className="flex justify-between text-[11px]"><span className="text-slate-500">Среда</span><span className="text-slate-300">{h.data.runtime.env}</span></li>
              <li className="flex justify-between text-[11px]"><span className="text-slate-500">Node.js</span><span className="text-slate-300">{h.data.runtime.node}</span></li>
              {h.data.runtime.commit && <li className="flex justify-between text-[11px]"><span className="text-slate-500">Сборка</span><span className="font-mono text-slate-300">{h.data.runtime.commit}</span></li>}
              <li className="flex justify-between text-[11px]"><span className="text-slate-500">Проверено</span><span className="text-slate-300">{fmtDateTime(h.data.checkedAt)}</span></li>
            </ul>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link href="/admin-giga-panel/audit" className="inline-flex items-center gap-1 text-[11px] text-blue-300 hover:underline"><ScrollText size={11} /> Журнал аудита</Link>
              <Link href="/admin-giga-panel/staff" className="inline-flex items-center gap-1 text-[11px] text-blue-300 hover:underline"><Users2 size={11} /> Сотрудники</Link>
            </div>
          </div>
        </div>
      )}
    </Panel>
  )
}

function Status({ ok, warn }: { ok: boolean; warn?: boolean }) {
  if (ok) return <CheckCircle2 size={13} className="shrink-0 text-emerald-400" aria-label="ок" />
  if (warn) return <AlertTriangle size={13} className="shrink-0 text-slate-500" aria-label="не настроено (необязательно)" />
  return <XCircle size={13} className="shrink-0 text-red-400" aria-label="ошибка" />
}
