'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ActivityLogClient } from '@/components/activity/ActivityLogClient'
import { BillingPanel } from '@/components/settings/BillingPanel'
import { AssistantSettingsPanel } from '@/components/settings/AssistantSettingsPanel'

export interface SettingsInitial {
  firstName: string
  lastName: string
  email: string
  position: string
  organization: string
  phone: string
}

type Channel = 'in_app' | 'email' | 'telegram'
type NotifPrefs = Record<string, Partial<Record<Channel, boolean>>>
export interface Prefs {
  appearance?: { theme?: string }
  notifications?: NotifPrefs
  socials?: Record<string, string>
}

const TABS = [
  { id: 'profile',       label: 'Профиль',          icon: 'person'        },
  { id: 'security',      label: 'Безопасность',     icon: 'lock'          },
  { id: 'notifications', label: 'Уведомления',      icon: 'notifications' },
  { id: 'appearance',    label: 'Внешний вид',      icon: 'palette'       },
  { id: 'assistant',     label: 'Ассистент',        icon: 'smart_toy'     },
  { id: 'integrations',  label: 'Интеграции',       icon: 'hub'           },
  { id: 'activity',      label: 'Журнал',           icon: 'history'       },
  { id: 'team',          label: 'Команда',          icon: 'group'         },
  { id: 'billing',       label: 'Биллинг',          icon: 'credit_card'   },
] as const

type TabId = (typeof TABS)[number]['id']

export function SettingsClient({ initial, preferences }: { initial: SettingsInitial; preferences: Prefs }) {
  const [tab, setTab] = useState<TabId>('profile')

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
      <div className="lg:col-span-1">
        <nav data-tour="settings-tabs" role="tablist" aria-label="Разделы настроек" className="bg-surface-container rounded-xl overflow-hidden">
          {TABS.map((t, i) => {
            const active = t.id === tab
            return (
              <button key={t.id} role="tab" aria-selected={active} onClick={() => setTab(t.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 text-sm transition-colors text-left ${
                  active
                    ? 'bg-surface-container-high text-primary border-l-2 border-primary'
                    : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high border-l-2 border-transparent'
                } ${i < TABS.length - 1 ? 'border-b border-outline-variant/10' : ''}`}>
                <span className="material-symbols-outlined text-lg">{t.icon}</span>
                <span className="font-medium">{t.label}</span>
              </button>
            )
          })}
        </nav>
      </div>

      <div className="lg:col-span-3 space-y-6" role="tabpanel">
        {tab === 'profile' && <ProfilePanel initial={initial} />}
        {tab === 'security' && <SecurityPanel />}
        {tab === 'notifications' && <NotificationsPanel initial={preferences?.notifications} />}
        {tab === 'appearance' && <AppearancePanel />}
        {tab === 'assistant' && <AssistantSettingsPanel />}
        {tab === 'integrations' && <IntegrationsPanel />}
        {tab === 'activity' && <ActivityLogClient />}
        {tab === 'team' && (
          <ComingSoon icon="group" title="Команда"
            points={['Участники компании', 'Приглашения по email', 'Роли и права', 'Лимиты тарифа']} />
        )}
        {tab === 'billing' && <BillingPanel />}
      </div>
    </div>
  )
}

// ── Профиль ───────────────────────────────────────────────────────────────────
function ProfilePanel({ initial }: { initial: SettingsInitial }) {
  const [form, setForm] = useState<SettingsInitial>(initial)
  const [baseline, setBaseline] = useState<SettingsInitial>(initial)
  const [saving, setSaving] = useState(false)
  const dirty = (['firstName', 'lastName', 'position', 'organization', 'phone'] as const).some((k) => form[k] !== baseline[k])
  const set = (k: keyof SettingsInitial) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const save = async () => {
    if (saving || !dirty) return
    setSaving(true)
    try {
      const res = await fetch('/api/v1/settings/profile', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ full_name: `${form.firstName} ${form.lastName}`.trim(), position: form.position.trim(), organization: form.organization.trim(), phone: form.phone.trim() }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) throw new Error()
      setBaseline(form)
      toast.success('Профиль сохранён')
    } catch { toast.error('Не удалось сохранить профиль.') } finally { setSaving(false) }
  }

  return (
    <>
      <Card title="Фото профиля">
        <div className="flex items-center gap-5">
          <div className="w-16 h-16 rounded-full bg-surface-container-high flex items-center justify-center text-xl font-headline font-bold text-primary">
            {initials(form.firstName, form.lastName, form.email)}
          </div>
          <div>
            <button type="button" disabled title="Загрузка аватара — в разработке"
              className="text-sm text-on-surface-variant border border-outline-variant/30 px-4 py-2 rounded-lg opacity-50 cursor-not-allowed">Загрузить фото</button>
            <p className="text-xs text-on-surface-variant mt-2">JPG, PNG до 2MB · скоро</p>
          </div>
        </div>
      </Card>

      <Card title="Личная информация">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Имя" value={form.firstName} onChange={set('firstName')} placeholder="Иван" />
          <Field label="Фамилия" value={form.lastName} onChange={set('lastName')} placeholder="Иванов" />
          <Field label="Email" value={form.email} onChange={() => {}} type="email" readOnly hint="Смена email — в разделе Безопасность (скоро)" />
          <Field label="Телефон" value={form.phone} onChange={set('phone')} placeholder="+7 700 000 00 00" type="tel" />
          <Field label="Должность" value={form.position} onChange={set('position')} placeholder="Manager" />
          <Field label="Организация" value={form.organization} onChange={set('organization')} placeholder="Компания" />
        </div>
      </Card>

      <div className="flex items-center justify-end gap-3">
        {dirty && <span className="text-xs text-on-surface-variant mr-auto">Есть несохранённые изменения</span>}
        <button type="button" onClick={() => setForm(baseline)} disabled={!dirty || saving}
          className="px-5 py-2 text-sm text-on-surface-variant border border-outline-variant/30 rounded-lg hover:bg-surface-container transition-colors disabled:opacity-40 disabled:cursor-not-allowed">Отменить</button>
        <button type="button" onClick={save} disabled={!dirty || saving} aria-busy={saving}
          className="px-6 py-2 bg-gradient-to-br from-primary to-primary-container text-on-primary text-sm font-semibold rounded-lg shadow-primary-sm hover:scale-[0.98] transition-all disabled:opacity-50 disabled:hover:scale-100">
          {saving ? 'Сохраняем…' : 'Сохранить изменения'}
        </button>
      </div>
    </>
  )
}

// ── Безопасность — полностью проработанный раздел ────────────────────────────
function SecurityPanel() {
  return (
    <>
      <PasswordCard />
      <TwoFactorCard />
      <BiometricsCard />
      <SessionsCard />
      <SecurityEventsCard />
    </>
  )
}

function PasswordCard() {
  const [current, setCurrent] = useState('')
  const [next1, setNext1] = useState('')
  const [next2, setNext2] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async () => {
    setErr(null)
    if (next1.length < 8) return setErr('Новый пароль — минимум 8 символов')
    if (next1 !== next2) return setErr('Пароли не совпадают')
    setSaving(true)
    try {
      const res = await fetch('/api/v1/settings/password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ current, newPassword: next1 }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) {
        setErr(json.error === 'wrong_current_password' ? 'Неверный текущий пароль'
          : json.error === 'same_password' ? 'Новый пароль совпадает с текущим' : 'Не удалось сменить пароль')
        return
      }
      toast.success('Пароль изменён')
      setCurrent(''); setNext1(''); setNext2('')
    } catch { setErr('Ошибка сети.') } finally { setSaving(false) }
  }

  return (
    <Card title="Пароль" subtitle="Требуется текущий пароль для подтверждения." icon="password">
      <div className="space-y-4 max-w-md">
        <Field label="Текущий пароль" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="••••••••" />
        <Field label="Новый пароль" type="password" value={next1} onChange={(e) => setNext1(e.target.value)} placeholder="Минимум 8 символов" />
        <Field label="Повторите новый пароль" type="password" value={next2} onChange={(e) => setNext2(e.target.value)} placeholder="••••••••" />
        {err && <p className="text-xs text-error font-mono">{err}</p>}
        <button type="button" onClick={submit} disabled={saving || !current || !next1 || !next2} aria-busy={saving}
          className="px-6 py-2 bg-gradient-to-br from-primary to-primary-container text-on-primary text-sm font-semibold rounded-lg shadow-primary-sm hover:scale-[0.98] transition-all disabled:opacity-50 disabled:hover:scale-100">
          {saving ? 'Меняем…' : 'Сменить пароль'}
        </button>
      </div>
    </Card>
  )
}

type TwoFAStatus = { enabled: boolean; pending: boolean; backup_codes_remaining: number; encryption_configured: boolean }

function BackupCodesPanel({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const copy = () => {
    navigator.clipboard?.writeText(codes.join('\n')).then(
      () => toast.success('Коды скопированы'),
      () => toast.error('Не удалось скопировать'),
    )
  }
  return (
    <div className="mt-4 p-4 rounded-xl border border-primary/20 bg-primary/5">
      <div className="flex items-start gap-2 mb-3">
        <span className="material-symbols-outlined text-primary text-lg mt-0.5">key</span>
        <div>
          <p className="text-sm font-semibold text-on-surface">Сохраните резервные коды</p>
          <p className="text-xs text-on-surface-variant">Показываются один раз. Каждый код работает однократно — на случай потери телефона.</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 font-mono text-sm text-on-surface bg-surface-container rounded-lg p-3">
        {codes.map((c) => <span key={c} className="tracking-wider">{c}</span>)}
      </div>
      <div className="flex gap-2 mt-3">
        <button type="button" onClick={copy} className="text-xs px-3 py-1.5 rounded-lg bg-surface-container-high border border-white/[0.06] text-on-surface-variant hover:text-on-surface transition-colors">Скопировать</button>
        <button type="button" onClick={onDone} className="text-xs px-3 py-1.5 rounded-lg bg-primary text-on-primary font-semibold hover:bg-primary/90 transition-colors">Я сохранил коды</button>
      </div>
    </div>
  )
}

function TwoFactorCard() {
  const [status, setStatus] = useState<TwoFAStatus | null>(null)
  const [phase, setPhase] = useState<'idle' | 'enrolling'>('idle')
  const [setup, setSetup] = useState<{ qr_svg: string; secret: string } | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null)
  const [disabling, setDisabling] = useState(false)
  const [disableCode, setDisableCode] = useState('')

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/security/2fa/status', { credentials: 'include' })
      const json = await res.json().catch(() => ({}))
      if (json.ok) setStatus(json)
    } catch { /* keep null */ }
  }, [])
  useEffect(() => { loadStatus() }, [loadStatus])

  const beginSetup = async () => {
    setBusy(true); setErr(null)
    try {
      const res = await fetch('/api/v1/security/2fa/setup', { method: 'POST', credentials: 'include' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) {
        setErr(json.error === 'encryption_not_configured'
          ? 'Шифрование не настроено на сервере (SECRETS_ENCRYPTION_KEY). Обратитесь к администратору.'
          : 'Не удалось начать настройку.')
        return
      }
      setSetup({ qr_svg: json.qr_svg, secret: json.secret }); setPhase('enrolling'); setCode('')
    } catch { setErr('Ошибка сети.') } finally { setBusy(false) }
  }

  const confirmSetup = async () => {
    setBusy(true); setErr(null)
    try {
      const res = await fetch('/api/v1/security/2fa/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ code: code.trim() }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) { setErr(json.error === 'invalid_code' ? 'Неверный код.' : 'Не удалось подтвердить.'); return }
      setBackupCodes(json.backup_codes); setPhase('idle'); setSetup(null); setCode('')
      toast.success('2FA включена')
      loadStatus()
    } catch { setErr('Ошибка сети.') } finally { setBusy(false) }
  }

  const disable = async () => {
    setBusy(true); setErr(null)
    try {
      const res = await fetch('/api/v1/security/2fa/disable', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ code: disableCode.trim() }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) { setErr(json.error === 'invalid_code' ? 'Неверный код.' : 'Не удалось отключить.'); return }
      toast.success('2FA отключена'); setDisabling(false); setDisableCode(''); loadStatus()
    } catch { setErr('Ошибка сети.') } finally { setBusy(false) }
  }

  const regenerate = async () => {
    const c = window.prompt('Введите текущий код из приложения, чтобы перевыпустить резервные коды:')
    if (!c) return
    setBusy(true); setErr(null)
    try {
      const res = await fetch('/api/v1/security/backup-codes/regenerate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ code: c.trim() }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) { toast.error(json.error === 'invalid_code' ? 'Неверный код' : 'Не удалось'); return }
      setBackupCodes(json.backup_codes); loadStatus()
    } catch { toast.error('Ошибка сети') } finally { setBusy(false) }
  }

  return (
    <Card title="Двухфакторная аутентификация (2FA)" subtitle="Дополнительный код при входе — защита от кражи пароля." icon="verified_user">
      {status === null ? (
        <div className="h-16 bg-surface-container-high rounded-lg animate-pulse" />
      ) : status.enabled ? (
        <>
          <div className="flex items-center justify-between py-2">
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-xl text-primary">smartphone</span>
              <div>
                <p className="text-sm font-medium text-on-surface">Приложение-аутентификатор</p>
                <p className="text-xs text-on-surface-variant">Резервных кодов осталось: {status.backup_codes_remaining}</p>
              </div>
            </div>
            <span className="text-[10px] font-mono text-primary bg-primary/10 border border-primary/20 px-2 py-0.5 rounded-full">Включено</span>
          </div>
          {backupCodes && <BackupCodesPanel codes={backupCodes} onDone={() => setBackupCodes(null)} />}
          {err && <p className="text-xs text-error font-mono mt-2">{err}</p>}
          <div className="flex flex-wrap gap-2 mt-4">
            <button type="button" onClick={regenerate} disabled={busy} className="text-xs px-3 py-1.5 rounded-lg border border-white/[0.06] text-on-surface-variant hover:text-on-surface transition-colors disabled:opacity-50">Перевыпустить резервные коды</button>
            {!disabling ? (
              <button type="button" onClick={() => { setDisabling(true); setErr(null) }} className="text-xs px-3 py-1.5 rounded-lg border border-error/30 text-error hover:bg-error/10 transition-colors">Отключить 2FA</button>
            ) : (
              <div className="flex items-center gap-2 w-full mt-1">
                <input value={disableCode} onChange={(e) => setDisableCode(e.target.value)} placeholder="Код из приложения или резервный"
                  className="flex-1 h-9 bg-surface-container-high border border-white/[0.06] rounded-lg px-3 text-sm font-mono text-on-surface focus:outline-none focus:border-error/40" />
                <button type="button" onClick={disable} disabled={busy || disableCode.trim().length < 6} className="text-xs px-3 py-2 rounded-lg bg-error text-white font-semibold disabled:opacity-50">Подтвердить</button>
                <button type="button" onClick={() => { setDisabling(false); setDisableCode('') }} className="text-xs px-3 py-2 rounded-lg text-on-surface-variant">Отмена</button>
              </div>
            )}
          </div>
        </>
      ) : phase === 'enrolling' && setup ? (
        <div className="space-y-4">
          <p className="text-sm text-on-surface-variant">Отсканируйте QR‑код в Google Authenticator / 1Password / Authy, затем введите 6‑значный код.</p>
          <div className="flex flex-col sm:flex-row gap-4 items-start">
            {/* Own server-generated SVG (from the qrcode lib) — not user content. */}
            <div className="bg-white rounded-xl p-3 shrink-0" dangerouslySetInnerHTML={{ __html: setup.qr_svg }} />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-on-surface-variant mb-1">Или введите ключ вручную:</p>
              <code className="block text-xs font-mono text-on-surface break-all bg-surface-container-high rounded-lg p-2 mb-3">{setup.secret}</code>
              <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="000000" aria-label="Код из приложения"
                className="w-full h-11 bg-surface-container-high border border-white/[0.06] rounded-lg px-3 text-center text-lg font-mono tracking-[0.3em] text-on-surface focus:outline-none focus:border-primary/40" />
            </div>
          </div>
          {err && <p className="text-xs text-error font-mono">{err}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={confirmSetup} disabled={busy || code.length < 6} className="px-5 py-2 bg-gradient-to-br from-primary to-primary-container text-on-primary text-sm font-semibold rounded-lg disabled:opacity-50">{busy ? 'Проверка…' : 'Подтвердить и включить'}</button>
            <button type="button" onClick={() => { setPhase('idle'); setSetup(null); setErr(null) }} className="px-4 py-2 text-sm text-on-surface-variant">Отмена</button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-start gap-3 py-2">
            <span className="material-symbols-outlined text-xl text-on-surface-variant/60">smartphone</span>
            <div>
              <p className="text-sm font-medium text-on-surface">Приложение‑аутентификатор (TOTP)</p>
              <p className="text-xs text-on-surface-variant">Google Authenticator, 1Password, Authy + резервные коды на случай потери устройства.</p>
            </div>
          </div>
          {status.encryption_configured === false && (
            <div className="mt-2 flex items-center gap-2 text-xs text-tertiary-container bg-surface-container-high rounded-lg px-3 py-2">
              <span className="material-symbols-outlined text-base">warning</span>
              Сервер не настроен для 2FA (нет ключа шифрования). Обратитесь к администратору.
            </div>
          )}
          {backupCodes && <BackupCodesPanel codes={backupCodes} onDone={() => setBackupCodes(null)} />}
          {err && <p className="text-xs text-error font-mono mt-2">{err}</p>}
          <button type="button" onClick={beginSetup} disabled={busy || status.encryption_configured === false}
            className="mt-4 px-5 py-2 bg-gradient-to-br from-primary to-primary-container text-on-primary text-sm font-semibold rounded-lg hover:scale-[0.98] transition-all disabled:opacity-50">
            {busy ? 'Загрузка…' : 'Включить 2FA'}
          </button>
        </>
      )}
      <p className="text-[11px] text-on-surface-variant/60 mt-4">SMS‑коды — в следующем обновлении.</p>
    </Card>
  )
}

type PasskeyRow = { id: string; label: string | null; device_type: string | null; backed_up: boolean; created_at: string; last_used_at: string | null }

function BiometricsCard() {
  const [supported, setSupported] = useState<boolean | null>(null)
  const [creds, setCreds] = useState<PasskeyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/security/webauthn/credentials', { credentials: 'include' })
      const json = await res.json().catch(() => ({}))
      if (json.ok) setCreds(json.credentials)
    } catch { /* keep empty */ } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    let mounted = true
    import('@simplewebauthn/browser')
      .then(({ browserSupportsWebAuthn }) => { if (mounted) setSupported(browserSupportsWebAuthn()) })
      .catch(() => { if (mounted) setSupported(false) })
    load()
    return () => { mounted = false }
  }, [load])

  const addPasskey = async () => {
    setBusy(true); setErr(null)
    try {
      const { startRegistration } = await import('@simplewebauthn/browser')
      const optRes = await fetch('/api/v1/security/webauthn/register/options', { method: 'POST', credentials: 'include' })
      const optJson = await optRes.json().catch(() => ({}))
      if (!optRes.ok || !optJson.ok) { setErr('Не удалось начать регистрацию ключа.'); return }
      let attResp
      try {
        attResp = await startRegistration(optJson.options)
      } catch (e) {
        setErr((e as { name?: string })?.name === 'NotAllowedError' ? 'Операция отменена или превышено время ожидания.' : 'Не удалось создать ключ на устройстве.')
        return
      }
      const verRes = await fetch('/api/v1/security/webauthn/register/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ response: attResp }),
      })
      const verJson = await verRes.json().catch(() => ({}))
      if (!verRes.ok || !verJson.ok) { setErr('Ключ не подтверждён сервером.'); return }
      if (Array.isArray(verJson.backup_codes)) setBackupCodes(verJson.backup_codes)
      toast.success('Ключ доступа добавлен')
      load()
    } catch { setErr('Ошибка сети.') } finally { setBusy(false) }
  }

  const remove = async (id: string, label: string | null) => {
    if (!confirm(`Удалить ключ «${label ?? 'passkey'}»? Если это последний фактор — вход снова будет только по паролю.`)) return
    setBusy(true)
    try {
      const res = await fetch('/api/v1/security/webauthn/credentials', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ id }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) { toast.error('Не удалось удалить'); return }
      toast.success('Ключ удалён'); load()
    } catch { toast.error('Ошибка сети') } finally { setBusy(false) }
  }

  return (
    <Card title="Вход по биометрии и ключам доступа" subtitle="Face ID, Touch ID или аппаратный ключ — как второй фактор при входе." icon="fingerprint">
      {loading ? (
        <div className="h-16 bg-surface-container-high rounded-lg animate-pulse" />
      ) : supported === false ? (
        <p className="text-sm text-on-surface-variant py-1">Этот браузер не поддерживает ключи доступа (WebAuthn). Откройте портал в Safari, Chrome или Edge на поддерживаемом устройстве.</p>
      ) : (
        <>
          {creds.length === 0 ? (
            <p className="text-sm text-on-surface-variant py-1">
              Ключи доступа ещё не добавлены. Добавьте Face ID / Touch ID / аппаратный ключ — на входе он заменит ввод кода из приложения.
            </p>
          ) : (
            <div className="divide-y divide-outline-variant/10">
              {creds.map((c) => (
                <div key={c.id} className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-3">
                    <span className="material-symbols-outlined text-xl text-primary">passkey</span>
                    <div>
                      <p className="text-sm font-medium text-on-surface">{c.label ?? 'Ключ доступа'}</p>
                      <p className="text-xs text-on-surface-variant">
                        Добавлен {fmtDateShort(c.created_at)}{c.last_used_at ? ` · вход ${fmtDateShort(c.last_used_at)}` : ''}
                      </p>
                    </div>
                  </div>
                  <button type="button" onClick={() => remove(c.id, c.label)} disabled={busy}
                    className="text-xs text-error border border-error/30 px-3 py-1.5 rounded-lg hover:bg-error/10 transition-colors disabled:opacity-50">Удалить</button>
                </div>
              ))}
            </div>
          )}
          {backupCodes && <BackupCodesPanel codes={backupCodes} onDone={() => setBackupCodes(null)} />}
          {err && <p className="text-xs text-error font-mono mt-2">{err}</p>}
          <button type="button" onClick={addPasskey} disabled={busy}
            className="mt-4 px-5 py-2 bg-gradient-to-br from-primary to-primary-container text-on-primary text-sm font-semibold rounded-lg hover:scale-[0.98] transition-all disabled:opacity-50 flex items-center gap-2">
            <span className="material-symbols-outlined text-lg">add</span>{busy ? 'Подождите…' : 'Добавить ключ доступа'}
          </button>
        </>
      )}
      <p className="text-xs text-on-surface-variant/70 mt-4">Биометрия остаётся на устройстве и на сервер не передаётся — храним только публичный ключ.</p>
    </Card>
  )
}

function SessionsCard() {
  const [busy, setBusy] = useState(false)
  const [device, setDevice] = useState('Текущее устройство')

  useEffect(() => {
    const ua = navigator.userAgent
    const browser = /Edg/.test(ua) ? 'Edge' : /Chrome/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : /Firefox/.test(ua) ? 'Firefox' : 'Браузер'
    const os = /Mac/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : ''
    setDevice(`${browser}${os ? ' · ' + os : ''}`)
  }, [])

  const revokeAll = async () => {
    if (!confirm('Завершить все сессии на всех устройствах? Вы выйдете из аккаунта и на этом устройстве.')) return
    setBusy(true)
    try {
      const res = await fetch('/api/v1/settings/sessions/revoke-all', { method: 'POST', credentials: 'include' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) throw new Error()
      toast.success('Все сессии завершены')
      window.location.href = '/login'
    } catch { toast.error('Не удалось завершить сессии'); setBusy(false) }
  }

  return (
    <Card title="Активные сессии" subtitle="Устройства, на которых выполнен вход в аккаунт." icon="devices">
      <div className="flex items-center justify-between py-3 border-b border-outline-variant/10">
        <div className="flex items-center gap-3">
          <span className="material-symbols-outlined text-xl text-primary">computer</span>
          <div>
            <p className="text-sm font-medium text-on-surface">{device}</p>
            <p className="text-xs text-on-surface-variant flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" /> Активна сейчас · этот браузер
            </p>
          </div>
        </div>
        <span className="text-[10px] font-mono text-primary bg-primary/10 px-2 py-0.5 rounded-full">текущая</span>
      </div>
      <p className="text-xs text-on-surface-variant/70 mt-3 mb-4">Полный список устройств с гео и временем последнего входа — в разработке.</p>
      <button type="button" onClick={revokeAll} disabled={busy} aria-busy={busy}
        className="text-sm text-error border border-error/30 px-4 py-2 rounded-lg hover:bg-error/10 transition-colors disabled:opacity-50">
        {busy ? 'Завершаем…' : 'Завершить все сессии'}
      </button>
    </Card>
  )
}

function SecurityEventsCard() {
  const [events, setEvents] = useState<Array<{ id: string; action: string; description: string | null; created_at: string }>>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch('/api/v1/activity?category=security&limit=8', { credentials: 'include' })
      .then((r) => r.json())
      .then((j) => { if (!cancelled && j.ok) setEvents(j.data) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  return (
    <Card title="События безопасности" subtitle="Смена пароля, вход, изменения защиты." icon="shield">
      {loading ? (
        <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-10 bg-surface-container-high rounded-lg animate-pulse" />)}</div>
      ) : events.length === 0 ? (
        <p className="text-sm text-on-surface-variant py-2">Событий безопасности пока нет.</p>
      ) : (
        <div className="divide-y divide-outline-variant/10">
          {events.map((e) => (
            <div key={e.id} className="flex items-center justify-between py-2.5">
              <span className="text-sm text-on-surface">{e.description ?? e.action}</span>
              <span className="text-[11px] font-mono text-on-surface-variant">{fmtDateShort(e.created_at)}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

// ── Уведомления (настройки каналов) ──────────────────────────────────────────
const NOTIF_CATEGORIES = [
  { key: 'critical', label: 'Критические алерты', desc: 'Немедленные уведомления о критических событиях' },
  { key: 'gri',      label: 'Обновления GRI',     desc: 'При пересчёте GRI-диагностики' },
  { key: 'reports',  label: 'Отчёты',             desc: 'Загрузка и готовность отчётов' },
  { key: 'security', label: 'Безопасность',       desc: 'Входы, смена пароля, устройства' },
  { key: 'team',     label: 'Команда',            desc: 'Изменения в команде' },
  { key: 'crm',      label: 'CRM-дайджест',       desc: 'Утром: кому звонить + слабый блок GRI' },
  { key: 'digest',   label: 'Еженедельный дайджест', desc: 'Сводка по портфелю' },
] as const

const NOTIF_DEFAULTS: NotifPrefs = {
  critical: { in_app: true, email: true }, gri: { in_app: true, email: false }, reports: { in_app: true, email: false },
  security: { in_app: true, email: true }, team: { in_app: true, email: false },
  crm: { in_app: true, email: false, telegram: true }, digest: { in_app: false, email: true },
}

function NotificationsPanel({ initial }: { initial?: NotifPrefs }) {
  const [prefs, setPrefs] = useState<NotifPrefs>(() => {
    const out: NotifPrefs = {}
    for (const c of NOTIF_CATEGORIES) out[c.key] = { ...NOTIF_DEFAULTS[c.key], ...(initial?.[c.key] ?? {}) }
    return out
  })
  const toggle = async (cat: string, channel: Channel) => {
    const prev = prefs
    const value = !prefs[cat]?.[channel]
    setPrefs((p) => ({ ...p, [cat]: { ...p[cat], [channel]: value } }))
    try {
      const res = await fetch('/api/v1/settings/preferences', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ notifications: { [cat]: { [channel]: value } } }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) throw new Error()
    } catch { setPrefs(prev); toast.error('Не удалось сохранить настройку') }
  }
  return (
    <Card title="Настройки уведомлений" subtitle="Выберите, о чём и куда получать уведомления. Изменения сохраняются сразу.">
      <div className="flex items-center justify-end gap-6 pr-1 pb-2 mb-1 border-b border-outline-variant/10">
        <span className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest w-11 text-center">In-app</span>
        <span className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest w-11 text-center">Email</span>
      </div>
      <div className="divide-y divide-outline-variant/10">
        {NOTIF_CATEGORIES.map((c) => (
          <div key={c.key} className="flex items-center justify-between py-3">
            <div className="pr-4"><p className="text-sm font-medium text-on-surface">{c.label}</p><p className="text-xs text-on-surface-variant">{c.desc}</p></div>
            <div className="flex items-center gap-6 shrink-0">
              <Toggle checked={prefs[c.key]?.in_app} onChange={() => toggle(c.key, 'in_app')} label={`${c.label}: in-app`} />
              <Toggle checked={prefs[c.key]?.email} onChange={() => toggle(c.key, 'email')} label={`${c.label}: email`} />
            </div>
          </div>
        ))}
      </div>
      <TelegramBinding
        telegramOn={prefs.crm?.telegram !== false}
        onToggleTelegram={() => toggle('crm', 'telegram')}
      />
    </Card>
  )
}

// ── Привязка Telegram (Фаза 4A) ──────────────────────────────────────────────
function TelegramBinding({
  telegramOn,
  onToggleTelegram,
}: {
  telegramOn: boolean
  onToggleTelegram: () => void
}) {
  const [linked, setLinked] = useState<boolean | null>(null)
  const [configured, setConfigured] = useState(true)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/settings/telegram', { credentials: 'include' })
      const json = await res.json().catch(() => ({}))
      if (json?.ok) {
        setLinked(Boolean(json.linked))
        setConfigured(Boolean(json.configured))
      }
    } catch {
      /* оставляем как есть */
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const link = async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/v1/settings/telegram', { method: 'POST', credentials: 'include' })
      const json = await res.json().catch(() => ({}))
      if (res.ok && json?.ok && json.url) {
        window.open(json.url, '_blank', 'noopener')
        toast.success('Откройте бота и нажмите «Start» — затем вернитесь и обновите статус')
      } else if (json?.error === 'telegram_not_configured') {
        toast.error('Telegram-бот не настроен на сервере')
      } else {
        toast.error('Не удалось создать ссылку привязки')
      }
    } catch {
      toast.error('Не удалось создать ссылку привязки')
    } finally {
      setBusy(false)
    }
  }

  const unlink = async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/v1/settings/telegram', { method: 'DELETE', credentials: 'include' })
      if (res.ok) {
        setLinked(false)
        toast.success('Telegram отвязан')
      } else {
        toast.error('Не удалось отвязать')
      }
    } catch {
      toast.error('Не удалось отвязать')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-5 pt-4 border-t border-outline-variant/10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-on-surface flex items-center gap-1.5">
            <span className="material-symbols-outlined text-base text-primary">send</span>
            Telegram
          </p>
          <p className="text-xs text-on-surface-variant mt-0.5">
            {!configured
              ? 'Бот не настроен на сервере — обратитесь к администратору.'
              : linked
                ? 'Привязан. CRM-дайджест и инсайты приходят в чат.'
                : 'Привяжите чат, чтобы получать напоминания прямо в Telegram.'}
          </p>
        </div>
        {configured && (
          <div className="shrink-0">
            {linked ? (
              <button
                onClick={unlink}
                disabled={busy}
                className="px-3 py-1.5 rounded-lg border border-white/[0.08] text-xs text-on-surface-variant hover:bg-white/[0.04] disabled:opacity-40 transition-colors"
              >
                Отвязать
              </button>
            ) : (
              <button
                onClick={link}
                disabled={busy}
                className="px-3 py-1.5 rounded-lg bg-primary/15 border border-primary/30 text-xs font-medium text-primary hover:bg-primary/25 disabled:opacity-40 transition-colors"
              >
                Привязать Telegram
              </button>
            )}
          </div>
        )}
      </div>
      {configured && linked && (
        <div className="flex items-center justify-between mt-3">
          <span className="text-xs text-on-surface-variant">Присылать CRM-дайджест в Telegram</span>
          <Toggle
            checked={telegramOn}
            onChange={onToggleTelegram}
            label="CRM-дайджест в Telegram"
          />
        </div>
      )}
    </div>
  )
}

// ── Внешний вид ───────────────────────────────────────────────────────────────
// The portal ships a single dark theme (all colors are absolute dark tokens —
// there are no `dark:` variants), so light/system are honestly marked "скоро"
// rather than shown as working toggles that change nothing. Audit 2026-07-02.
function AppearancePanel() {
  const options = [
    { id: 'dark', label: 'Тёмная', icon: 'dark_mode', available: true },
    { id: 'light', label: 'Светлая', icon: 'light_mode', available: false },
    { id: 'system', label: 'Системная', icon: 'contrast', available: false },
  ]
  return (
    <Card title="Тема оформления" subtitle="Сейчас доступна тёмная тема — фирменный вид портала.">
      <div className="grid grid-cols-3 gap-3">
        {options.map((o) => {
          const active = o.id === 'dark'
          return (
            <button key={o.id} type="button" disabled={!o.available} aria-pressed={active}
              title={o.available ? undefined : 'Скоро'}
              className={`relative flex flex-col items-center gap-2 py-5 rounded-xl border transition-all ${
                active
                  ? 'border-primary text-primary bg-primary/5'
                  : 'border-outline-variant/30 text-on-surface-variant/50 cursor-not-allowed'
              }`}>
              <span className="material-symbols-outlined text-2xl">{o.icon}</span>
              <span className="text-sm font-medium">{o.label}</span>
              {!o.available && (
                <span className="absolute top-2 right-2 text-[9px] font-mono uppercase tracking-wider text-on-surface-variant/40">скоро</span>
              )}
            </button>
          )
        })}
      </div>
      <p className="text-xs text-on-surface-variant/70 mt-4">Светлая тема, плотность интерфейса и размер шрифта — в разработке.</p>
    </Card>
  )
}

// ── Интеграции ────────────────────────────────────────────────────────────────
interface CrmRow { id: string; provider: string; domain: string; isActive: boolean; lastSyncStatus: string | null; syncedDeals: number; syncedContacts: number }

const STUB_INTEGRATIONS = [
  { id: 'telegram', name: 'Telegram', icon: 'send', status: 'coming', desc: 'Уведомления и алерты в Telegram' },
  { id: 'whatsapp', name: 'WhatsApp', icon: 'chat', status: 'coming', desc: 'Уведомления в WhatsApp' },
  { id: 'sheets',   name: 'Google Sheets', icon: 'table_view', status: 'available', desc: 'Экспорт метрик и базы клиентов' },
  { id: 'notion',   name: 'Notion', icon: 'description', status: 'coming', desc: 'Синхронизация заметок и отчётов' },
  { id: 'slack',    name: 'Slack', icon: 'tag', status: 'coming', desc: 'Алерты в рабочий канал' },
  { id: 'webhooks', name: 'Webhooks', icon: 'webhook', status: 'needs_setup', desc: 'Исходящие вебхуки на события' },
  { id: 'apikeys',  name: 'API-ключи', icon: 'key', status: 'available', desc: 'Программный доступ к API портала' },
] as const

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  connected:   { label: 'Подключено',         cls: 'text-primary bg-primary/10 border-primary/20' },
  available:   { label: 'Доступно',           cls: 'text-secondary bg-secondary/10 border-secondary/20' },
  coming:      { label: 'Скоро',              cls: 'text-on-surface-variant bg-surface-container-high border-outline-variant/30' },
  needs_setup: { label: 'Требуется настройка', cls: 'text-tertiary-container bg-tertiary-container/10 border-tertiary-container/20' },
  error:       { label: 'Ошибка',             cls: 'text-error bg-error/10 border-error/20' },
}

function IntegrationsPanel() {
  const [crm, setCrm] = useState<CrmRow[]>([])
  const [noOrg, setNoOrg] = useState(false)
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState<string | null>(null)
  const [form, setForm] = useState({ domain: '', accessToken: '' })
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/crm', { credentials: 'include' })
      if (res.status === 403) { setNoOrg(true); setCrm([]); return }
      const json = await res.json().catch(() => ({}))
      setCrm(Array.isArray(json.integrations) ? json.integrations : [])
    } catch { /* keep empty */ } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const connected = (provider: string) => crm.find((c) => c.provider === provider && c.isActive)

  const connect = async (provider: string) => {
    if (!form.domain || !form.accessToken) return toast.error('Укажите домен и токен')
    setBusy(true)
    try {
      const res = await fetch('/api/crm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ provider, domain: form.domain, accessToken: form.accessToken }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'fail')
      toast.success('Интеграция подключена')
      setConnecting(null); setForm({ domain: '', accessToken: '' }); load()
    } catch (e) { toast.error(e instanceof Error && /organization/i.test(e.message) ? 'Нет организации — обратитесь к администратору' : 'Не удалось подключить (проверьте домен/токен)') } finally { setBusy(false) }
  }

  const sync = async (id: string) => {
    setBusy(true)
    try {
      const res = await fetch('/api/crm/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ id }) })
      if (!res.ok) throw new Error()
      toast.success('Синхронизация запущена'); load()
    } catch { toast.error('Ошибка синхронизации') } finally { setBusy(false) }
  }

  const disconnect = async (id: string) => {
    if (!confirm('Отключить интеграцию?')) return
    setBusy(true)
    try {
      const res = await fetch('/api/crm', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ id }) })
      if (!res.ok) throw new Error()
      toast.success('Интеграция отключена'); load()
    } catch { toast.error('Не удалось отключить') } finally { setBusy(false) }
  }

  const CrmCard = ({ provider, name }: { provider: string; name: string }) => {
    const conn = connected(provider)
    const isOpen = connecting === provider
    return (
      <div className="bg-surface-container-high rounded-xl p-4 border border-white/[0.04]">
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-2xl text-primary/70">hub</span>
            <div><p className="text-sm font-semibold text-on-surface">{name}</p><p className="text-xs text-on-surface-variant">Синхронизация сделок и контактов</p></div>
          </div>
          <Badge status={conn ? 'connected' : 'available'} />
        </div>
        {conn ? (
          <div className="mt-3">
            <p className="text-xs text-on-surface-variant mb-2">{conn.domain} · сделок: {conn.syncedDeals} · контактов: {conn.syncedContacts}</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => sync(conn.id)} disabled={busy} className="text-xs px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/20 text-primary hover:bg-primary/15 transition-colors disabled:opacity-50">Синхронизировать</button>
              <button type="button" onClick={() => disconnect(conn.id)} disabled={busy} className="text-xs px-3 py-1.5 rounded-lg border border-error/30 text-error hover:bg-error/10 transition-colors disabled:opacity-50">Отключить</button>
            </div>
          </div>
        ) : isOpen ? (
          <div className="mt-3 space-y-2">
            <input value={form.domain} onChange={(e) => setForm((f) => ({ ...f, domain: e.target.value }))} placeholder={provider === 'bitrix24' ? 'company.bitrix24.ru' : 'company.amocrm.ru'}
              className="w-full bg-surface-container border border-outline-variant/30 rounded-lg px-3 py-2 text-xs text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:border-primary/50" />
            <input value={form.accessToken} onChange={(e) => setForm((f) => ({ ...f, accessToken: e.target.value }))} placeholder="Access token / webhook key" type="password"
              className="w-full bg-surface-container border border-outline-variant/30 rounded-lg px-3 py-2 text-xs text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:border-primary/50" />
            <div className="flex gap-2">
              <button type="button" onClick={() => connect(provider)} disabled={busy} className="text-xs px-3 py-1.5 rounded-lg bg-primary text-on-primary hover:bg-primary/90 transition-colors disabled:opacity-50">{busy ? 'Проверка…' : 'Подключить'}</button>
              <button type="button" onClick={() => setConnecting(null)} className="text-xs px-3 py-1.5 rounded-lg text-on-surface-variant hover:text-on-surface">Отмена</button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => { setConnecting(provider); setForm({ domain: '', accessToken: '' }) }}
            className="mt-3 text-xs px-3 py-1.5 rounded-lg border border-outline-variant/30 text-on-surface-variant hover:text-on-surface hover:border-primary/30 transition-colors">Подключить</button>
        )}
      </div>
    )
  }

  return (
    <>
      <Card title="CRM" subtitle="Подтяните сделки и контакты для аналитики.">
        {noOrg && (
          <div className="mb-3 flex items-center gap-2 text-xs text-on-surface-variant bg-surface-container-high rounded-lg px-3 py-2">
            <span className="material-symbols-outlined text-base text-tertiary-container">info</span>
            CRM-интеграции доступны на уровне организации — обратитесь к администратору для подключения.
          </div>
        )}
        {loading ? <div className="h-24 bg-surface-container-high rounded-xl animate-pulse" /> : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <CrmCard provider="bitrix24" name="Bitrix24" />
            <CrmCard provider="amocrm" name="AmoCRM" />
          </div>
        )}
      </Card>

      <Card title="Каналы и сервисы" subtitle="Уведомления, экспорт, вебхуки и API.">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {STUB_INTEGRATIONS.map((s) => (
            <div key={s.id} className="bg-surface-container-high rounded-xl p-4 border border-white/[0.04]">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-3">
                  <span className="material-symbols-outlined text-2xl text-on-surface-variant/60">{s.icon}</span>
                  <div><p className="text-sm font-semibold text-on-surface">{s.name}</p><p className="text-xs text-on-surface-variant">{s.desc}</p></div>
                </div>
                <Badge status={s.status} />
              </div>
              <button type="button" disabled title="В разработке"
                className="mt-2 text-xs px-3 py-1.5 rounded-lg border border-outline-variant/30 text-on-surface-variant opacity-50 cursor-not-allowed">
                {s.status === 'available' ? 'Подключить' : s.status === 'needs_setup' ? 'Настроить' : 'Скоро'}
              </button>
            </div>
          ))}
        </div>
      </Card>
    </>
  )
}

// ── shared ────────────────────────────────────────────────────────────────────
function Card({ title, subtitle, icon, children }: { title: string; subtitle?: string; icon?: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface-container rounded-xl p-6">
      <div className="flex items-start gap-3 mb-5">
        {icon && <span className="material-symbols-outlined text-xl text-primary/70 mt-0.5">{icon}</span>}
        <div>
          <h3 className="font-headline text-lg font-bold text-on-surface">{title}</h3>
          {subtitle && <p className="text-sm text-on-surface-variant mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  )
}


function Badge({ status }: { status: string }) {
  const b = STATUS_BADGE[status] ?? STATUS_BADGE.coming
  return <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border shrink-0 ${b.cls}`}>{b.label}</span>
}

function ComingSoon({ icon, title, points }: { icon: string; title: string; points: string[] }) {
  return (
    <div className="bg-surface-container rounded-xl p-8 text-center">
      <span className="material-symbols-outlined text-4xl text-primary/40 mb-3 block">{icon}</span>
      <h3 className="font-headline text-lg font-bold text-on-surface">{title}</h3>
      <p className="text-sm text-on-surface-variant mt-1 mb-5">Раздел в разработке. Здесь появится:</p>
      <ul className="inline-flex flex-col gap-2 text-left">
        {points.map((p) => (
          <li key={p} className="flex items-center gap-2 text-sm text-on-surface-variant">
            <span className="material-symbols-outlined text-base text-primary/50">check_circle</span>{p}
          </li>
        ))}
      </ul>
    </div>
  )
}

function Toggle({ checked, onChange, label }: { checked?: boolean; onChange: () => void; label?: string }) {
  return (
    <button type="button" role="switch" aria-checked={!!checked} aria-label={label} onClick={onChange}
      className={`w-11 h-6 rounded-full transition-colors relative shrink-0 ${checked ? 'bg-primary' : 'bg-surface-container-high'}`}>
      <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  )
}

function Field({ label, value, onChange, placeholder, type = 'text', readOnly = false, hint }: {
  label: string; value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; placeholder?: string; type?: string; readOnly?: boolean; hint?: string
}) {
  return (
    <div>
      <label className="block text-xs font-label text-on-surface-variant uppercase tracking-wider mb-2">{label}</label>
      <input type={type} value={value} onChange={onChange} placeholder={placeholder} readOnly={readOnly}
        className={`w-full bg-surface-container-high border border-outline-variant/30 rounded-lg px-4 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all ${readOnly ? 'opacity-60 cursor-not-allowed' : ''}`} />
      {hint && <p className="text-[11px] text-on-surface-variant/60 mt-1">{hint}</p>}
    </div>
  )
}

function initials(first: string, last: string, email: string) {
  const s = [first, last].filter(Boolean).map((p) => p[0]?.toUpperCase() ?? '').join('')
  return s || (email[0] ?? 'U').toUpperCase()
}

function fmtDateShort(iso: string) {
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
}
