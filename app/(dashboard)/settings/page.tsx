import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'Settings' }

export default async function SettingsPage() {
  const t = await getTranslations()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const mapRoleToPosition = (role: string): string => {
    const roles: Record<string, string> = {
      super_admin: t('settings.roles.super_admin'),
      admin: t('settings.roles.admin'),
      expert: t('settings.roles.expert'),
      owner: t('settings.roles.owner'),
      client: t('settings.roles.client'),
    }
    return roles[role] ?? t('settings.roles.default')
  }

  const SECTIONS = [
    { id: 'profile',       label: t('settings.sections.profile'),       icon: 'person'        },
    { id: 'security',      label: t('settings.sections.security'),      icon: 'lock'          },
    { id: 'notifications', label: t('settings.sections.notifications'), icon: 'notifications' },
    { id: 'appearance',    label: t('settings.sections.appearance'),    icon: 'palette'       },
    { id: 'team',          label: t('settings.sections.team'),          icon: 'group'         },
    { id: 'billing',       label: t('settings.sections.billing'),       icon: 'credit_card'   },
    { id: 'api',           label: t('settings.sections.api'),           icon: 'api'           },
  ]

  if (!user) {
    return (
      <div className="space-y-4">
        <h1 className="font-headline text-3xl font-bold text-on-surface">{t('settings.title')}</h1>
        <div className="bg-surface-container rounded-xl p-6 border border-outline-variant/30">
          <p className="text-on-surface">{t('settings.profileLoadError')}</p>
          <p className="text-sm text-on-surface-variant mt-2">{t('settings.profileLoadErrorHint')}</p>
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
  const fullName = (profile?.full_name ?? meta.full_name ?? meta.name ?? user.email ?? t('settings.roles.default')) as string
  const email = user.email ?? ''

  const role = (profile?.role ?? meta.role ?? 'client') as string
  const position = (profile?.position ?? meta.position ?? mapRoleToPosition(role)) as string
  const organization = (profile?.organization ?? meta.organization ?? '—') as string

  const [firstName = fullName.split(' ')[0], lastName = fullName.split(' ').slice(1).join(' ')] = fullName.split(' ')

  const initials = fullName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || (email[0] ?? 'U').toUpperCase()

  const fields = [
    { label: t('settings.firstName'), placeholder: 'Ivan', value: firstName, type: 'text' },
    { label: t('settings.lastName'), placeholder: 'Ivanov', value: lastName, type: 'text' },
    { label: t('auth.email'), placeholder: 'you@company.com', value: email, type: 'email' },
    { label: t('settings.position'), placeholder: 'Manager', value: position, type: 'text' },
    { label: t('settings.organization'), placeholder: 'Company', value: organization, type: 'text' },
  ]

  const notificationItems = [
    { label: t('settings.notificationItems.criticalAlerts'), desc: t('settings.notificationItems.criticalAlertsDesc'), enabled: true  },
    { label: t('settings.notificationItems.griUpdates'),     desc: t('settings.notificationItems.griUpdatesDesc'),     enabled: true  },
    { label: t('settings.notificationItems.reportUploads'),  desc: t('settings.notificationItems.reportUploadsDesc'),  enabled: false },
    { label: t('settings.notificationItems.weeklyDigest'),   desc: t('settings.notificationItems.weeklyDigestDesc'),   enabled: true  },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-headline text-3xl font-bold text-on-surface">{t('settings.title')}</h1>
        <p className="text-on-surface-variant text-sm mt-1">{t('settings.subtitle')}</p>
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

        {/* Profile Settings */}
        <div className="lg:col-span-3 space-y-6">
          {/* Avatar */}
          <div className="bg-surface-container rounded-xl p-6">
            <h3 className="font-headline text-lg font-bold text-on-surface mb-5">{t('settings.profilePhoto')}</h3>
            <div className="flex items-center gap-5">
              <div className="w-16 h-16 rounded-full bg-surface-container-high flex items-center justify-center text-xl font-headline font-bold text-primary">
                {initials}
              </div>
              <div>
                <button className="text-sm text-on-surface border border-outline-variant/30 px-4 py-2 rounded-lg hover:bg-surface-container-high transition-colors">
                  {t('settings.uploadPhoto')}
                </button>
                <p className="text-xs text-on-surface-variant mt-2">{t('settings.photoHint')}</p>
              </div>
            </div>
          </div>

          {/* Personal Info */}
          <div className="bg-surface-container rounded-xl p-6">
            <h3 className="font-headline text-lg font-bold text-on-surface mb-5">{t('settings.personalInfo')}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {fields.map((field) => (
                <div key={field.label}>
                  <label className="block text-xs font-label text-on-surface-variant uppercase tracking-wider mb-2">
                    {field.label}
                  </label>
                  <input
                    type={field.type}
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
            <h3 className="font-headline text-lg font-bold text-on-surface mb-5">{t('settings.sections.notifications')}</h3>
            <div className="space-y-4">
              {notificationItems.map((item) => (
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
              {t('common.cancel')}
            </button>
            <button className="px-6 py-2 bg-gradient-to-br from-primary to-primary-container text-on-primary text-sm font-semibold rounded-lg shadow-primary-sm hover:scale-[0.98] transition-all">
              {t('common.saveChanges')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
