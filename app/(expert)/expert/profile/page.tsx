'use client'

import { useAuthStore } from '@/stores/auth.store'
import { useCallback, useEffect, useState } from 'react'
import { getAvatarGradient, getInitials } from '@/lib/expert-blocks'

interface ExpertProfile {
  id: string
  full_name: string | null
  email: string | null
  avatar_url: string | null
  role: string | null
  expert_title: string | null
}

export default function ExpertProfilePage() {
  const { user } = useAuthStore()

  const [profile, setProfile] = useState<ExpertProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const [fullName, setFullName] = useState('')
  const [expertTitle, setExpertTitle] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/expert/profile')
      if (!res.ok) throw new Error('Не удалось загрузить профиль')
      const json = (await res.json()) as { data: ExpertProfile | null }
      if (json.data) {
        setProfile(json.data)
        setFullName(json.data.full_name ?? '')
        setExpertTitle(json.data.expert_title ?? '')
        setAvatarUrl(json.data.avatar_url ?? '')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Неизвестная ошибка')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const save = async () => {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const res = await fetch('/api/expert/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: fullName.trim() || undefined,
          expertTitle: expertTitle.trim(),
          avatarUrl: avatarUrl.trim() || null,
        }),
      })
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(json.error ?? 'Не удалось сохранить')
      }
      const json = (await res.json()) as { data: ExpertProfile }
      setProfile(json.data)
      setFullName(json.data.full_name ?? '')
      setExpertTitle(json.data.expert_title ?? '')
      setAvatarUrl(json.data.avatar_url ?? '')
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Неизвестная ошибка')
    } finally {
      setSaving(false)
    }
  }

  const previewName = fullName.trim() || profile?.full_name || user?.name || 'Эксперт'
  const previewTitle = expertTitle.trim() || profile?.expert_title || null
  const previewAvatar = avatarUrl.trim() || profile?.avatar_url || null
  const previewInitials = getInitials(previewName)
  const gradient = getAvatarGradient(profile?.id ?? user?.id ?? previewName)

  return (
    <div className="space-y-8 max-w-3xl">
      <section>
        <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-3">
          Expert Portal
        </p>
        <h1 className="font-headline text-3xl font-extrabold text-on-surface">
          Мой профиль
        </h1>
        <p className="text-on-surface-variant mt-2 text-sm">
          Управление личными данными и настройками
        </p>
      </section>

      {/* Preview card — the way clients see the expert in comments */}
      <section className="bg-surface-container-low rounded-2xl border border-white/[0.04] overflow-hidden">
        <div className="px-6 py-4 border-b border-white/[0.04] flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px] text-primary/70">
            visibility
          </span>
          <h2 className="text-sm font-headline font-bold text-on-surface">
            Как вас увидят клиенты
          </h2>
        </div>
        <div className="p-5">
          <div className="flex items-start gap-3 rounded-xl bg-white/[0.02] border border-white/[0.04] p-4">
            {previewAvatar ? (
              <img
                src={previewAvatar}
                alt={previewName}
                className="w-11 h-11 rounded-xl border border-white/[0.08] object-cover flex-shrink-0"
              />
            ) : (
              <div
                className={`w-11 h-11 rounded-xl border border-white/[0.08] bg-gradient-to-br ${gradient} flex items-center justify-center text-sm font-bold text-on-surface flex-shrink-0`}
              >
                {previewInitials}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-on-surface truncate">
                  {previewName}
                </span>
                {previewTitle && (
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                    {previewTitle}
                  </span>
                )}
              </div>
              <p className="mt-2 text-sm text-on-surface-variant">
                Пример: «Рекомендую пересмотреть юнит-экономику — возврат на маркетинг ниже рынка.»
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Editor */}
      <section className="bg-surface-container-low rounded-2xl border border-white/[0.04] overflow-hidden">
        <div className="px-6 py-4 border-b border-white/[0.04] flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px] text-primary/70">
            edit
          </span>
          <h2 className="text-sm font-headline font-bold text-on-surface">
            Редактор профиля
          </h2>
        </div>

        <div className="p-6 space-y-5">
          {loading ? (
            <div className="py-6 flex items-center justify-center gap-2 text-on-surface-variant text-sm">
              <span className="material-symbols-outlined text-[18px] animate-spin">
                progress_activity
              </span>
              Загрузка...
            </div>
          ) : (
            <>
              <div>
                <label className="block text-[10px] font-mono uppercase tracking-widest text-on-surface-variant mb-1.5">
                  Email
                </label>
                <input
                  type="email"
                  value={profile?.email ?? user?.email ?? ''}
                  readOnly
                  className="w-full rounded-xl bg-surface-container border border-white/[0.04] text-sm text-on-surface-variant px-3 py-2.5 cursor-not-allowed"
                />
              </div>

              <div>
                <label className="block text-[10px] font-mono uppercase tracking-widest text-on-surface-variant mb-1.5">
                  Полное имя
                </label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  disabled={saving}
                  maxLength={200}
                  placeholder="Имя Фамилия"
                  className="w-full rounded-xl bg-surface-container border border-white/[0.06] text-sm text-on-surface px-3 py-2.5 focus:outline-none focus:border-primary/40 transition-all"
                />
              </div>

              <div>
                <label className="block text-[10px] font-mono uppercase tracking-widest text-on-surface-variant mb-1.5">
                  Специализация
                </label>
                <input
                  type="text"
                  value={expertTitle}
                  onChange={(e) => setExpertTitle(e.target.value)}
                  disabled={saving}
                  maxLength={120}
                  placeholder="Напр.: Маркетолог, Growth hacker, Финансист..."
                  className="w-full rounded-xl bg-surface-container border border-white/[0.06] text-sm text-on-surface placeholder:text-on-surface-variant/60 px-3 py-2.5 focus:outline-none focus:border-primary/40 transition-all"
                />
                <p className="text-[10px] text-on-surface-variant/70 mt-1.5">
                  Этот тег клиенты увидят рядом с вашим именем в комментариях.
                </p>
              </div>

              <div>
                <label className="block text-[10px] font-mono uppercase tracking-widest text-on-surface-variant mb-1.5">
                  Аватар (URL)
                </label>
                <input
                  type="url"
                  value={avatarUrl}
                  onChange={(e) => setAvatarUrl(e.target.value)}
                  disabled={saving}
                  placeholder="https://..."
                  className="w-full rounded-xl bg-surface-container border border-white/[0.06] text-sm text-on-surface placeholder:text-on-surface-variant/60 px-3 py-2.5 focus:outline-none focus:border-primary/40 transition-all"
                />
                <p className="text-[10px] text-on-surface-variant/70 mt-1.5">
                  Публичная ссылка на изображение. Если пусто — показываются инициалы.
                </p>
              </div>

              {error && (
                <div className="p-3 rounded-xl bg-error/5 border border-error/20 text-xs text-error">
                  {error}
                </div>
              )}

              <div className="flex items-center gap-2">
                <button
                  onClick={save}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-primary/15 hover:bg-primary/25 border border-primary/30 text-primary text-sm font-medium px-4 py-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving ? (
                    <>
                      <span className="material-symbols-outlined text-[16px] animate-spin">
                        progress_activity
                      </span>
                      Сохранение...
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-[16px]">save</span>
                      Сохранить
                    </>
                  )}
                </button>
                {saved && (
                  <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
                    <span className="material-symbols-outlined text-[14px]">check_circle</span>
                    Сохранено
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  )
}
