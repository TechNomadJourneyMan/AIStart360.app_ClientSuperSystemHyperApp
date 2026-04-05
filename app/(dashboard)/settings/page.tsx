import type { Metadata } from 'next'
import { getSettingsUserData } from '@/lib/settings-data'

export const metadata: Metadata = { title: 'Settings' }

function mapRoleToPosition(role: string): string {
  switch (role) {
    case 'SUPER_ADMIN':
      return 'Владелец'
    case 'ADMIN':
      return 'Администратор'
    case 'MANAGER':
      return 'Менеджер'
    case 'ANALYST':
      return 'Аналитик'
    case 'CLIENT':
      return 'Клиент'
    default:
      return 'Пользователь'
  }
}

const SECTIONS = [
  { id: 'profile', label: 'Профиль', icon: 'person' },
  { id: 'security', label: 'Безопасность', icon: 'lock' },
  { id: 'notifications', label: 'Уведомления', icon: 'notifications' },
  { id: 'appearance', label: 'Внешний вид', icon: 'palette' },
  { id: 'team', label: 'Команда', icon: 'group' },
  { id: 'billing', label: 'Биллинг', icon: 'credit_card' },
  { id: 'api', label: 'API & Интеграции', icon: 'api' },
]

export default async function SettingsPage() {
  const user = await getSettingsUserData()

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

  const [firstName = user.name, lastName = ''] = user.name.split(' ')
  const initials = user.name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || 'U'

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-headline text-3xl font-bold text-on-surface">Настройки</h1>
        <p className="text-on-surface-variant text-sm mt-1">Управление аккаунтом и системой</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Settings Nav */}
        <div className="lg:col-span-1">
          <nav className="bg-surface-container rounded-xl overflow-hidden">
            {SECTIONS.map((section, i) => (
              <button
                key={section.id}
                className={`w-full flex items-center gap-3 px-4 py-3 text-sm transition-colors text-left ${
                  i === 0
                    ? 'bg-surface-container-high text-primary border-l-2 border-primary'
                    : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high border-l-2 border-transparent'
                } ${i < SECTIONS.length - 1 ? 'border-b border-outline-variant/10' : ''}`}
              >
                <span className="material-symbols-outlined text-lg">{section.icon}</span>
                <span className="font-medium">{section.label}</span>
              </button>
            ))}
          </nav>
        </div>

        {/* Profile Settings (default view) */}
        <div className="lg:col-span-3 space-y-6">
          {/* Avatar */}
          <div className="bg-surface-container rounded-xl p-6">
            <h3 className="font-headline text-lg font-bold text-on-surface mb-5">Фото профиля</h3>
            <div className="flex items-center gap-5">
              <div className="w-16 h-16 rounded-full bg-surface-container-high flex items-center justify-center text-xl font-headline font-bold text-primary">
                {initials}
              </div>
              <div>
                <button className="text-sm text-on-surface border border-outline-variant/30 px-4 py-2 rounded-lg hover:bg-surface-container-high transition-colors">
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
              {[
                { label: 'Имя', placeholder: 'Иван', value: firstName },
                { label: 'Фамилия', placeholder: 'Иванов', value: lastName },
                { label: 'Email', placeholder: 'you@company.com', value: user.email, type: 'email' },
                { label: 'Должность', placeholder: 'Manager', value: mapRoleToPosition(user.role) },
                { label: 'Организация', placeholder: 'Компания', value: user.organizationName },
              ].map((field) => (
                <div key={field.label}>
                  <label className="block text-xs font-label text-on-surface-variant uppercase tracking-wider mb-2">
                    {field.label}
                  </label>
                  <input
                    type={field.type ?? 'text'}
                    defaultValue={field.value}
                    placeholder={field.placeholder}
                    className="w-full bg-surface-container-high border border-outline-variant/30 rounded-lg px-4 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
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
                { label: 'Critical Alerts', desc: 'Немедленные уведомления о критических событиях', enabled: true },
                { label: 'GRI Updates', desc: 'При пересчёте GRI для клиентов', enabled: true },
                { label: 'Report Uploads', desc: 'При загрузке новых отчётов', enabled: false },
                { label: 'Weekly Digest', desc: 'Еженедельная сводка по портфелю', enabled: true },
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between py-2 border-b border-outline-variant/10 last:border-0">
                  <div>
                    <p className="text-sm font-medium text-on-surface">{item.label}</p>
                    <p className="text-xs text-on-surface-variant">{item.desc}</p>
                  </div>
                  <div
                    className={`w-11 h-6 rounded-full cursor-pointer transition-colors relative ${
                      item.enabled ? 'bg-primary' : 'bg-surface-container-high'
                    }`}
                  >
                    <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                      item.enabled ? 'translate-x-6' : 'translate-x-1'
                    }`} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Save Button */}
          <div className="flex justify-end gap-3">
            <button className="px-5 py-2 text-sm text-on-surface-variant border border-outline-variant/30 rounded-lg hover:bg-surface-container transition-colors">
              Отменить
            </button>
            <button className="px-6 py-2 bg-gradient-to-br from-primary to-primary-container text-on-primary text-sm font-semibold rounded-lg shadow-primary-sm hover:scale-[0.98] transition-all">
              Сохранить изменения
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
