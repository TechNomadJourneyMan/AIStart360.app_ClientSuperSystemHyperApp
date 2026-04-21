'use client'

// WhatsApp-scenarios library — read-only viewer for the catalogue in
// lib/whatsapp-scenarios.ts. Клиент видит ~18 сценариев по 6 категориям,
// фильтрует по связке и сегменту, копирует WhatsApp-скрипт в буфер обмена.

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  SCENARIO_CATEGORIES,
  SCENARIOS,
  type Scenario,
  type ScenarioCategory,
} from '@/lib/whatsapp-scenarios'
import { SEGMENT_LABELS } from '@/lib/rfm-segmentation'

export default function ScenariosPage() {
  const [selectedCat, setSelectedCat] = useState<ScenarioCategory | 'all'>('all')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const filtered = useMemo(
    () => (selectedCat === 'all' ? SCENARIOS : SCENARIOS.filter((s) => s.category === selectedCat)),
    [selectedCat],
  )

  const copy = async (scenario: Scenario) => {
    try {
      await navigator.clipboard.writeText(scenario.whatsapp_script)
      setCopiedId(scenario.id)
      setTimeout(() => setCopiedId(null), 2000)
    } catch { /* clipboard permissions denied */ }
  }

  return (
    <div className="min-h-screen bg-surface py-8 px-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <Link
          href="/client/dashboard-medical"
          className="inline-flex items-center gap-1 text-xs text-on-surface-variant hover:text-primary"
        >
          <span className="material-symbols-outlined text-[16px]">arrow_back</span>
          Назад в кабинет
        </Link>

        <header>
          <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-2">
            Библиотека WhatsApp-сценариев
          </p>
          <h1 className="font-headline text-3xl font-extrabold text-on-surface">
            Готовые шаблоны рассылок
          </h1>
          <p className="text-sm text-on-surface-variant mt-2 max-w-2xl">
            {SCENARIOS.length} сценариев по 6 категориям. Каждый содержит условие, триггер,
            WhatsApp-скрипт с кнопками, акционный оффер и follow-up логику. Копируйте и адаптируйте
            под голос вашей клиники.
          </p>
        </header>

        {/* Category tabs */}
        <nav className="flex flex-wrap gap-2 border-b border-white/[0.06] pb-3">
          <Chip
            active={selectedCat === 'all'}
            onClick={() => setSelectedCat('all')}
            label={`Все (${SCENARIOS.length})`}
          />
          {SCENARIO_CATEGORIES.map((cat) => {
            const count = SCENARIOS.filter((s) => s.category === cat.id).length
            return (
              <Chip
                key={cat.id}
                active={selectedCat === cat.id}
                onClick={() => setSelectedCat(cat.id)}
                label={`${cat.id}. ${cat.label} (${count})`}
              />
            )
          })}
        </nav>

        {selectedCat !== 'all' && (
          <p className="text-sm text-on-surface-variant italic">
            {SCENARIO_CATEGORIES.find((c) => c.id === selectedCat)?.description}
          </p>
        )}

        <div className="space-y-3">
          {filtered.map((s) => (
            <ScenarioCard
              key={s.id}
              scenario={s}
              onCopy={copy}
              copied={copiedId === s.id}
            />
          ))}
        </div>

        <div className="rounded-2xl bg-amber-500/5 border border-amber-500/20 p-5 text-sm text-on-surface">
          <p className="font-medium mb-1">⚠ Phase 1 — только библиотека шаблонов</p>
          <p className="text-on-surface-variant">
            Автоматическая отправка через WhatsApp Business API — это Phase 2 и требует Meta
            business verification (~2-4 недели) + BSP-провайдера. Сейчас шаблоны можно использовать
            вручную или в CRM клиники.
          </p>
        </div>
      </div>
    </div>
  )
}

function Chip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
        active
          ? 'bg-primary/15 border-primary/30 text-primary'
          : 'bg-white/[0.02] border-white/[0.06] text-on-surface-variant hover:bg-white/[0.05]'
      }`}
    >
      {label}
    </button>
  )
}

function ScenarioCard({ scenario, onCopy, copied }: { scenario: Scenario; onCopy: (s: Scenario) => void; copied: boolean }) {
  return (
    <article className="bg-surface-container-low rounded-2xl border border-white/[0.06] p-5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-primary mb-1">
            <span>#{scenario.id}</span>
            <span className="text-on-surface-variant">·</span>
            <span className="text-on-surface-variant">{scenario.category}</span>
          </div>
          <h3 className="font-headline text-base font-bold text-on-surface">{scenario.condition}</h3>
          <p className="text-xs text-on-surface-variant mt-1">{scenario.reasoning}</p>
        </div>
        {scenario.price_note && (
          <span className="inline-flex items-center gap-1 text-xs font-mono text-primary bg-primary/10 border border-primary/20 rounded-full px-2.5 py-1 flex-shrink-0">
            {scenario.price_note}
          </span>
        )}
      </div>

      <div className="space-y-2 mb-3">
        <MetaLine label="Триггер" value={scenario.trigger} />
        <MetaLine
          label="Сегменты"
          value={scenario.linked_segments.map((s) => SEGMENT_LABELS[s]).join(', ')}
        />
      </div>

      {/* WhatsApp script */}
      <div className="rounded-xl bg-emerald-500/5 border border-emerald-500/20 p-4 mb-2">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-mono uppercase tracking-widest text-emerald-400 inline-flex items-center gap-1">
            <span className="material-symbols-outlined text-[12px]">chat</span>
            WhatsApp
          </span>
          <button
            onClick={() => onCopy(scenario)}
            className="inline-flex items-center gap-1 text-[11px] text-emerald-400 hover:text-emerald-300"
          >
            <span className="material-symbols-outlined text-[13px]">
              {copied ? 'check' : 'content_copy'}
            </span>
            {copied ? 'Скопировано' : 'Копировать'}
          </button>
        </div>
        <p className="text-sm text-on-surface whitespace-pre-wrap">{scenario.whatsapp_script}</p>
        {scenario.buttons.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {scenario.buttons.map((b) => (
              <span
                key={b}
                className="text-[11px] bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 px-2 py-0.5 rounded"
              >
                {b}
              </span>
            ))}
          </div>
        )}
      </div>

      {scenario.flash_offer && (
        <div className="rounded-xl bg-orange-500/5 border border-orange-500/20 p-3 mb-2">
          <p className="text-[10px] font-mono uppercase tracking-widest text-orange-400 mb-1">
            🔥 Акционный оффер
          </p>
          <p className="text-xs text-on-surface">{scenario.flash_offer}</p>
        </div>
      )}

      {scenario.family_package && (
        <div className="rounded-xl bg-violet-500/5 border border-violet-500/20 p-3 mb-2">
          <p className="text-[10px] font-mono uppercase tracking-widest text-violet-400 mb-1">
            👨‍👩‍👧‍👦 Семейный пакет
          </p>
          <p className="text-xs text-on-surface">{scenario.family_package}</p>
        </div>
      )}

      {scenario.voice_script && (
        <div className="rounded-xl bg-blue-500/5 border border-blue-500/20 p-3 mb-2">
          <p className="text-[10px] font-mono uppercase tracking-widest text-blue-400 mb-1">
            📞 Голосовой скрипт
          </p>
          <p className="text-xs text-on-surface">{scenario.voice_script}</p>
        </div>
      )}

      {scenario.follow_up && (
        <p className="text-[11px] text-on-surface-variant italic mt-2">
          <span className="material-symbols-outlined text-[12px] align-middle mr-1">schedule</span>
          Follow-up: {scenario.follow_up}
        </p>
      )}
    </article>
  )
}

function MetaLine({ label, value }: { label: string; value: string }) {
  return (
    <p className="text-xs">
      <span className="text-on-surface-variant/70">{label}: </span>
      <span className="text-on-surface">{value}</span>
    </p>
  )
}
