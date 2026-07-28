import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'Settings' }

function mapRoleToPosition(role: string): string {
  switch (role) {
    case 'super_admin':
      return 'Владелец системы'
    case 'admin':
      return 'Администратор'
    case 'expert':
      return 'Эксперт роста'
    case 'owner':
      return 'Владелец бизнеса'
    case 'client':
      return 'Клиент'
    default:
      return 'Пользователь'
  }
}

const SECTIONS = [
  { id: 'profile',       label: 'Профиль',       icon: 'person'        },
  { id: 'security',      label: 'Безопасность',  icon: 'lock'          },
  { id: 'notifications', label: 'Уведомления',   icon: 'notifications' },
  { id: 'appearance',    label: 'Внешний вид',   icon: 'palette'       },
  { id: 'team',          label: 'Команда',       icon: 'group'         },
  { id: 'billing',       label: 'Биллинг',       icon: 'credit_card'   },
  { id: 'api',           label: 'API & Интеграции', icon: 'api'        },
]

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return (
      <div className="space-y-4">
        <h1 className="font-headline text-3xl font-bold text-on-surface">Настройки</h1>
        <div className="bg-surface-container rounded-xl p-6 border border-outline-variant/30">
          <p className="text-on-surface">Не удалось загрузить профиль пользователя.</p>
          <p className="text-sm text-on-surface-variant mt-2">Войдите снова и попробуйте открыть страницу повторно.</p>
        </div>
      </div>
    )
  }

  // Fetch from profiles table for more data
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle()

  const meta = user.user_metadata ?? {}
  const fullName = (profile?.full_name ?? meta.full_name ?? meta.name ?? user.email ?? 'Пользователь') as string
  const email = user.email ?? ''
  
  const role = (profile?.role ?? meta.role ?? 'client') as string
  const position = (profile?.position ?? meta.position ?? mapRoleToPosition(role)) as string
  const organization = (profile?.organization ?? meta.organization ?? '—') as string

  const [firstName = '', ...lastNameParts] = fullName.trim().split(/\s+/)
  const lastName = lastNameParts.join(' ')
  
  const initials = fullName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || (email[0] ?? 'U').toUpperCase()

  const fields = [
    { id: 'settings-first-name', label: 'Имя', placeholder: 'Иван', value: firstName, type: 'text' },
    { id: 'settings-last-name', label: 'Фамилия', placeholder: 'Иванов', value: lastName, type: 'text' },
    { id: 'settings-email', label: 'Email', placeholder: 'you@company.com', value: email, type: 'email' },
    { id: 'settings-position', label: 'Должность', placeholder: 'Manager', value: position, type: 'text' },
    { id: 'settings-organization', label: 'Организация', placeholder: 'Компания', value: organization, type: 'text' },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-headline text-3xl font-bold text-on-surface">Настройки</h1>
        <p className="text-on-surface-variant text-sm mt-1">Управление аккаунтом и системой</p>
      </div>

      <div
        id="settings-read-only-notice"
        role="status"
        className="flex items-start gap-3 rounded-xl border border-secondary/25 bg-secondary/5 px-4 py-3"
      >
        <span className="material-symbols-outlined mt-0.5 text-xl text-secondary">visibility</span>
        <div>
          <p className="text-sm font-semibold text-on-surface">Настройки доступны только для просмотра</p>
          <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">
            Данные профиля загружены из аккаунта. Редактирование, загрузка фото и сохранение предпочтений пока не подключены.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Settings Nav */}
        <div className="lg:col-span-1">
          <nav aria-label="Разделы настроек" className="bg-surface-container rounded-xl overflow-hidden">
            {SECTIONS.map((section, i) => {
              const borderClass = i < SECTIONS.length - 1
                ? 'border-b border-outline-variant/10'
                : ''

              if (section.id === 'profile') {
                return (
                  <div
                    key={section.id}
                    aria-current="page"
                    title="Профиль доступен только для просмотра"
                    className={`flex w-full items-center gap-3 border-l-2 border-primary bg-surface-container-high px-4 py-3 text-left text-sm text-primary ${borderClass}`}
                  >
                    <span className="material-symbols-outlined text-lg">{section.icon}</span>
                    <span className="font-medium">{section.label}</span>
                    <span className="sr-only">, только просмотр</span>
                  </div>
                )
              }

              return (
                <button
                  key={section.id}
                  type="button"
                  disabled
                  aria-label={`${section.label}: раздел пока недоступен`}
                  title="Раздел пока недоступен"
                  className={`flex w-full cursor-not-allowed items-center gap-3 border-l-2 border-transparent px-4 py-3 text-left text-sm text-on-surface-variant opacity-55 ${borderClass}`}
                >
                  <span className="material-symbols-outlined text-lg">{section.icon}</span>
                  <span className="font-medium">{section.label}</span>
                  <span className="material-symbols-outlined ml-auto text-sm" aria-hidden="true">lock</span>
                </button>
              )
            })}
          </nav>
        </div>

        {/* Profile Settings */}
        <div className="lg:col-span-3 space-y-6">
          {/* Avatar */}
          <div className="bg-surface-container rounded-xl p-6">
            <h3 className="font-headline text-lg font-bold text-on-surface mb-5">Фото профиля</h3>
            <div className="flex items-center gap-5">
              <div className="w-16 h-16 rounded-full bg-surface-container-high flex items-center justify-center text-xl font-headline font-bold text-primary">
                {initials}
              </div>
              <div>
                <button
                  type="button"
                  disabled
                  aria-label="Загрузить фото: функция пока недоступна"
                  aria-describedby="settings-read-only-notice"
                  title="Загрузка фото пока недоступна"
                  className="cursor-not-allowed rounded-lg border border-outline-variant/30 px-4 py-2 text-sm text-on-surface-variant opacity-55"
                >
                  Загрузить фото
                </button>
                <p className="text-xs text-on-surface-variant mt-2">JPG, PNG до 2MB</p>
              </div>
            </div>
          </div>

          {/* Personal Info */}
          <div className="bg-surface-container rounded-xl p-6">
            <h3 className="font-headline text-lg font-bold text-on-surface mb-5">Личная информация</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {fields.map((field) => (
                <div key={field.label}>
                  <label
                    htmlFor={field.id}
                    className="block text-xs font-label text-on-surface-variant uppercase tracking-wider mb-2"
                  >
                    {field.label}
                  </label>
                  <input
                    id={field.id}
                    type={field.type}
                    value={field.value}
                    readOnly
                    aria-readonly="true"
                    aria-describedby="settings-read-only-notice"
                    title={`${field.label}: только просмотр`}
                    placeholder={field.placeholder}
                    className="w-full cursor-default rounded-lg border border-outline-variant/30 bg-surface-container-high px-4 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:border-outline-variant/50 focus:outline-none"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Notification preferences */}
          <div className="bg-surface-container rounded-xl p-6">
            <h3 className="font-headline text-lg font-bold text-on-surface mb-5">Уведомления</h3>
            <div className="space-y-4">
              {[
                { label: 'Критические алерты', desc: 'Немедленные уведомления о критических событиях', enabled: true  },
                { label: 'Обновления GRI',    desc: 'При пересчёте GRI для клиентов',                 enabled: true  },
                { label: 'Загрузка отчётов',   desc: 'При загрузке новых отчётов',                     enabled: false },
                { label: 'Еженедельный дайджест', desc: 'Еженедельная сводка по портфелю',                enabled: true  },
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between py-2 border-b border-outline-variant/10 last:border-0">
                  <div>
                    <p className="text-sm font-medium text-on-surface">{item.label}</p>
                    <p className="text-xs text-on-surface-variant">{item.desc}</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={item.enabled}
                    aria-label={`${item.label}: ${item.enabled ? 'включено' : 'выключено'}, изменение недоступно`}
                    aria-describedby="settings-read-only-notice"
                    title="Изменение уведомлений пока недоступно"
                    disabled
                    className={`relative h-6 w-11 shrink-0 cursor-not-allowed rounded-full opacity-55 ${
                      item.enabled ? 'bg-primary' : 'bg-surface-container-high'
                    }`}
                  >
                    <span className={`absolute left-0 top-1 h-4 w-4 rounded-full bg-white ${
                      item.enabled ? 'translate-x-6' : 'translate-x-1'
                    }`} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Save Button */}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              disabled
              aria-label="Отменить изменения: редактирование недоступно"
              aria-describedby="settings-read-only-notice"
              title="Редактирование пока недоступно"
              className="cursor-not-allowed rounded-lg border border-outline-variant/30 px-5 py-2 text-sm text-on-surface-variant opacity-50"
            >
              Отменить
            </button>
            <button
              type="button"
              disabled
              aria-label="Сохранить изменения: сохранение недоступно"
              aria-describedby="settings-read-only-notice"
              title="Сохранение настроек пока недоступно"
              className="cursor-not-allowed rounded-lg bg-surface-container-high px-6 py-2 text-sm font-semibold text-on-surface-variant opacity-50"
            >
              Сохранить изменения
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
