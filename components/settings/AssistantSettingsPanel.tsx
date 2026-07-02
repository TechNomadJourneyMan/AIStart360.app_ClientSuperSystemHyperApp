'use client'

/**
 * components/settings/AssistantSettingsPanel.tsx — Settings › Ассистент.
 *
 * The return path after «скрыть» (ТЗ §7 scenario 8): master mascot switch,
 * hint frequency, muted hint types and a one-click «показать снова» that
 * clears a timed hide. Reads/writes /api/v1/assistant/settings
 * (profiles.preferences.assistant) and mirrors changes into the local mascot
 * store so the widget reacts immediately without a reload.
 */

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { MascotAvatar, MASCOT_PALETTES, type MascotColorId } from '@/components/assistant/mascot/MascotAvatar'
import { CHARACTERS, CHARACTER_IDS, getCharacter } from '@/lib/assistant/mascot/characters'
import { useMascotStore } from '@/lib/assistant/mascot/state'
import type {
  HintFrequency,
  MascotBehaviorSettings,
  MascotSettings,
} from '@/lib/assistant/mascot/types'

const FREQ_OPTIONS: Array<{ value: HintFrequency; label: string; desc: string }> = [
  { value: 'normal', label: 'Обычная', desc: 'До 8 подсказок за сессию, пауза от 90 секунд' },
  { value: 'rare', label: 'Редкая', desc: 'До 3 подсказок за сессию, паузы втрое длиннее' },
  { value: 'off', label: 'Выключены', desc: 'Только чат по клику — без проактивных подсказок' },
]

const MUTABLE_TYPES: Array<{ key: string; label: string }> = [
  { key: 'education', label: 'Обучающие советы' },
  { key: 'motivation', label: 'Мотивационные сообщения' },
  { key: 'idle', label: 'Предложение помощи при бездействии' },
]

const COLOR_OPTIONS: Array<{ id: MascotColorId; label: string }> = [
  { id: 'ginger', label: 'Рыжий' },
  { id: 'graphite', label: 'Графит' },
  { id: 'snow', label: 'Белый' },
  { id: 'cocoa', label: 'Шоколад' },
]

const BEHAVIOR_OPTIONS: Array<{
  key: keyof MascotBehaviorSettings
  label: string
  desc: string
}> = [
  {
    key: 'walking',
    label: 'Прогулки по экрану',
    desc: 'Иногда прохаживается вдоль нижнего края и трётся спинкой (только на десктопе)',
  },
  {
    key: 'sleep',
    label: 'Сон при бездействии',
    desc: 'Засыпает через ~2 минуты тишины; будит любое движение мыши или важная подсказка',
  },
  {
    key: 'aiInsights',
    label: 'AI-инсайты (OpenRouter)',
    desc: 'Один автоматический инсайт за сессию + пункт «Инсайт от Гри» в меню кота',
  },
]

export function AssistantSettingsPanel() {
  const [settings, setSettings] = useState<MascotSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const applyLocal = useMascotStore((s) => s.applySettings)
  const setSessionHidden = useMascotStore((s) => s.setSessionHidden)

  useEffect(() => {
    let cancelled = false
    fetch('/api/v1/assistant/settings', { credentials: 'include', cache: 'no-store' })
      .then((r) => r.json())
      .then((j: { ok: boolean; settings?: MascotSettings }) => {
        if (!cancelled && j.ok && j.settings) setSettings(j.settings)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  const patch = async (p: Partial<MascotSettings>) => {
    if (!settings) return
    setSaving(true)
    const optimistic = { ...settings, ...p }
    setSettings(optimistic)
    try {
      const res = await fetch('/api/v1/assistant/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(p),
      })
      const json = (await res.json()) as { ok: boolean; settings?: MascotSettings }
      if (json.ok && json.settings) {
        setSettings(json.settings)
        applyLocal(json.settings)
        // Re-enabling from Settings also lifts a session-hide immediately.
        if (p.mascotEnabled === true) setSessionHidden(false)
      } else {
        toast.error('Не удалось сохранить настройки ассистента')
      }
    } catch {
      toast.error('Ошибка сети — настройки не сохранены')
    } finally {
      setSaving(false)
    }
  }

  const hiddenByTimer =
    settings?.hiddenUntil && Date.parse(settings.hiddenUntil) > Date.now()
      ? new Date(settings.hiddenUntil)
      : null

  const toggleType = (key: string) => {
    if (!settings) return
    const muted = settings.dismissedHints.includes(key)
    void patch({
      dismissedHints: muted
        ? settings.dismissedHints.filter((t) => t !== key)
        : [...settings.dismissedHints, key],
    })
  }

  return (
    <div className="bg-surface-container rounded-xl p-6 border border-outline-variant/30 space-y-6">
      <div className="flex items-start gap-4">
        <div className="shrink-0 rounded-2xl bg-surface-container-high p-2">
          <MascotAvatar
            pose="idle"
            character={settings?.character ?? 'cat'}
            color={settings?.color ?? 'ginger'}
            size={64}
            paused
          />
        </div>
        <div>
          <h2 className="text-base font-bold text-on-surface">
            {getCharacter(settings?.character).name} — ваш ассистент
          </h2>
          <p className="text-sm text-on-surface-variant mt-1 leading-relaxed">
            Подсказывает следующий шаг, объясняет разделы и результаты диагностики.
            Отвечает только по вашим данным — без догадок.
          </p>
        </div>
      </div>

      {settings === null ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-10 bg-surface-container-high rounded-lg animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          {/* Master switch */}
          <div className="flex items-center justify-between gap-4 py-1">
            <div>
              <p className="text-sm font-medium text-on-surface">Показывать маскота</p>
              <p className="text-xs text-on-surface-variant mt-0.5">
                Выключите, чтобы полностью скрыть ассистента на всех экранах.
              </p>
            </div>
            <Toggle
              checked={settings.mascotEnabled}
              disabled={saving}
              label="Показывать маскота"
              onChange={() => void patch({ mascotEnabled: !settings.mascotEnabled })}
            />
          </div>

          {hiddenByTimer && settings.mascotEnabled && (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-400/20 bg-amber-400/10 px-4 py-3">
              <p className="text-xs text-amber-300">
                Маскот скрыт до {hiddenByTimer.toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}
              </p>
              <button
                onClick={() => void patch({ mascotEnabled: true })}
                className="shrink-0 px-3 py-1.5 rounded-lg bg-primary text-[#003824] font-semibold text-xs hover:bg-primary/90 transition-colors"
              >
                Показать снова
              </button>
            </div>
          )}

          {/* Frequency */}
          <div>
            <p className="text-sm font-medium text-on-surface mb-2">Частота подсказок</p>
            <div className="space-y-1.5" role="radiogroup" aria-label="Частота подсказок">
              {FREQ_OPTIONS.map((o) => {
                const active = settings.hintFrequency === o.value
                return (
                  <button
                    key={o.value}
                    role="radio"
                    aria-checked={active}
                    disabled={saving}
                    onClick={() => void patch({ hintFrequency: o.value })}
                    className={`w-full text-left rounded-xl border px-4 py-2.5 transition-all ${
                      active
                        ? 'border-primary/40 bg-primary/[0.07]'
                        : 'border-outline-variant/20 hover:border-primary/20 hover:bg-white/[0.02]'
                    }`}
                  >
                    <span className={`text-sm font-medium ${active ? 'text-primary' : 'text-on-surface'}`}>
                      {o.label}
                    </span>
                    <span className="block text-xs text-on-surface-variant mt-0.5">{o.desc}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Character skins */}
          <div>
            <p className="text-sm font-medium text-on-surface mb-1">Персонаж</p>
            <p className="text-xs text-on-surface-variant mb-2">
              Кастомизация ассистента: имя и характер меняются, правила безопасности — нет.
            </p>
            <div className="grid grid-cols-2 gap-2">
              {CHARACTER_IDS.map((id) => {
                const c = CHARACTERS[id]
                const active = settings.character === id
                return (
                  <button
                    key={id}
                    disabled={saving}
                    onClick={() => void patch({ character: id })}
                    aria-pressed={active}
                    className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-all ${
                      active
                        ? 'border-primary/40 bg-primary/[0.07]'
                        : 'border-outline-variant/20 hover:border-primary/20 hover:bg-white/[0.02]'
                    }`}
                  >
                    <span className="shrink-0">
                      <MascotAvatar pose="idle" character={id} color={settings.color} size={44} paused />
                    </span>
                    <span className="min-w-0">
                      <span className={`block text-sm font-semibold ${active ? 'text-primary' : 'text-on-surface'}`}>
                        {c.name}
                      </span>
                      <span className="block text-[11px] text-on-surface-variant leading-snug">
                        {c.species} · {c.tagline}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Fur color */}
          <div>
            <p className="text-sm font-medium text-on-surface mb-2">Цвет</p>
            <div className="flex items-center gap-2 flex-wrap">
              {COLOR_OPTIONS.map((c) => {
                const p = MASCOT_PALETTES[c.id]
                const active = settings.color === c.id
                return (
                  <button
                    key={c.id}
                    disabled={saving}
                    onClick={() => void patch({ color: c.id })}
                    aria-pressed={active}
                    aria-label={`Цвет: ${c.label}`}
                    className={`flex items-center gap-2 rounded-xl border px-2.5 py-1.5 transition-all ${
                      active
                        ? 'border-primary/40 bg-primary/[0.07]'
                        : 'border-outline-variant/20 hover:border-primary/20'
                    }`}
                  >
                    <span
                      aria-hidden
                      className="w-6 h-6 rounded-full border border-white/[0.15]"
                      style={{ background: `linear-gradient(180deg, ${p.body}, ${p.dark})` }}
                    />
                    <span className={`text-xs font-medium ${active ? 'text-primary' : 'text-on-surface'}`}>
                      {c.label}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Coachmark tours reset */}
          <div className="flex items-center justify-between gap-4 py-1">
            <div>
              <p className="text-sm font-medium text-on-surface">Обучение по платформе</p>
              <p className="text-xs text-on-surface-variant mt-0.5">
                Подсказки-стрелочки от {getCharacter(settings.character).name} снова появятся на каждой странице.
              </p>
            </div>
            <button
              onClick={() => {
                void patch({ toursDone: [] })
                window.dispatchEvent(new Event('aistart:tutorial:replay'))
              }}
              className="shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-primary/30 bg-primary/[0.06] text-primary font-semibold text-xs hover:bg-primary/[0.12] transition-colors"
            >
              <span className="material-symbols-outlined text-base">school</span>
              Сбросить обучение
            </button>
          </div>

          {/* Advanced behavior */}
          <div>
            <p className="text-sm font-medium text-on-surface mb-1">Поведение</p>
            <p className="text-xs text-on-surface-variant mb-2">
              Живые повадки Гри — можно выключить любую, кот не обидится.
            </p>
            <div className="divide-y divide-outline-variant/10">
              {BEHAVIOR_OPTIONS.map((b) => (
                <div key={b.key} className="flex items-center justify-between gap-4 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm text-on-surface">{b.label}</p>
                    <p className="text-xs text-on-surface-variant mt-0.5">{b.desc}</p>
                  </div>
                  <Toggle
                    checked={settings.behavior[b.key]}
                    disabled={saving}
                    label={b.label}
                    onChange={() =>
                      void patch({
                        behavior: { ...settings.behavior, [b.key]: !settings.behavior[b.key] },
                      })
                    }
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Muted hint types */}
          <div>
            <p className="text-sm font-medium text-on-surface mb-1">Типы советов</p>
            <p className="text-xs text-on-surface-variant mb-2">
              Отключённые через «Не показывать такие советы» можно вернуть здесь.
            </p>
            <div className="divide-y divide-outline-variant/10">
              {MUTABLE_TYPES.map((t) => (
                <div key={t.key} className="flex items-center justify-between py-2.5">
                  <span className="text-sm text-on-surface">{t.label}</span>
                  <Toggle
                    checked={!settings.dismissedHints.includes(t.key)}
                    disabled={saving}
                    label={t.label}
                    onChange={() => toggleType(t.key)}
                  />
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: () => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`w-11 h-6 rounded-full transition-colors relative shrink-0 disabled:opacity-60 ${
        checked ? 'bg-primary' : 'bg-surface-container-high'
      }`}
    >
      <span
        className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  )
}
