import { create } from 'zustand'

interface LocaleStore {
  locale: 'en' | 'ru'
  setLocale: (locale: 'en' | 'ru') => void
  toggleLocale: () => void
}

export const useLocaleStore = create<LocaleStore>((set, get) => ({
  locale:
    (typeof window !== 'undefined'
      ? (document.cookie.match(/aistart360_locale=(\w+)/)?.[1] as 'en' | 'ru')
      : 'en') || 'en',
  setLocale: (locale) => {
    document.cookie = `aistart360_locale=${locale}; path=/; max-age=31536000; SameSite=Lax`
    set({ locale })
    window.location.reload()
  },
  toggleLocale: () => {
    const next = get().locale === 'en' ? 'ru' : 'en'
    get().setLocale(next)
  },
}))
