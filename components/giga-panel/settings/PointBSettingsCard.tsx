'use client'

/**
 * GIGA → Настройки → «Точка Б»: the pop-up layer of the cabinet, the schedule of the plan-fact recompute
 * (`pb_recompute_cron` as day checkboxes + an hour in UTC, the Almaty time shown next to it) and the verdict
 * tolerances. Saving goes through the page's `onSave` (PUT /api/giga-admin/settings: validated by the registry,
 * written to the audit log). Editing needs the page's `settings.manage` (disabled otherwise).
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Target } from 'lucide-react'
import { Button, Panel, cx, fmtAgo, fmtDateTime, inputClass } from '@/components/giga-panel/kit'
import {
  FORM_DAYS, describeRecomputeSchedule, parseTolerancesDraft, scheduleFromCron, validateScheduleDraft, type RecomputeSchedule,
} from '@/lib/point-b/planfact/schedule-form'
import { DEFAULT_RECOMPUTE_CRON } from '@/lib/point-b/planfact/cron'
import { SETTINGS, type SettingKey, type SettingValue } from '@/lib/settings/registry'
import { actionLabel } from '@/lib/ui/pending'

type PbKey = 'pb_popups_enabled' | 'pb_popup_cards_per_day' | 'pb_recompute_cron' | 'pb_verdict_tolerances'
export type PointBValues = { [K in PbKey]: SettingValue<K> }
type Meta = Record<string, { updated_at: string; updated_by: string | null }>

export interface PointBSettingsCardProps {
  values: PointBValues
  meta: Meta
  disabled: boolean
  /** The key list of the request in flight (the page's `saving`), or null. */
  saving: string | null
  onSave: (patch: Partial<PointBValues>, label: string) => Promise<boolean>
}

const HOURS = Array.from({ length: 24 }, (_, h) => h)

function Row({ k, meta, children, note }: { k: SettingKey; meta: Meta; children: ReactNode; note?: string | null }) {
  const m = meta[k]
  return (
    <div className="flex flex-col gap-2 border-b border-white/[0.05] py-3 first:pt-0 last:border-0">
      <div className="min-w-0">
        <p className="text-xs font-medium text-slate-200">{SETTINGS[k].label}</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{SETTINGS[k].help}</p>
        {note && <p className="mt-1 text-[11px] text-amber-300/80">{note}</p>}
        {m && <p className="mt-1 text-[10px] text-slate-600" title={fmtDateTime(m.updated_at)}>Изменено {fmtAgo(m.updated_at)}</p>}
      </div>
      <div>{children}</div>
    </div>
  )
}

export function PointBSettingsCard({ values: v, meta, disabled, saving, onSave }: PointBSettingsCardProps) {
  // ── Schedule ──
  const stored = useMemo(() => scheduleFromCron(v.pb_recompute_cron), [v.pb_recompute_cron])
  const initial = stored ?? scheduleFromCron(DEFAULT_RECOMPUTE_CRON)!
  const [sched, setSched] = useState<RecomputeSchedule>(initial)
  useEffect(() => setSched(scheduleFromCron(v.pb_recompute_cron) ?? scheduleFromCron(DEFAULT_RECOMPUTE_CRON)!), [v.pb_recompute_cron])
  const schedCheck = validateScheduleDraft(sched)
  const schedDirty = !schedCheck.ok || schedCheck.value !== v.pb_recompute_cron
  const savingCron = saving === 'pb_recompute_cron'
  const toggleDay = (d: number) => setSched((s) => ({ ...s, days: s.days.includes(d) ? s.days.filter((x) => x !== d) : [...s.days, d].sort((a, b) => a - b) }))

  // ── Tolerances ──
  const tol = v.pb_verdict_tolerances
  const [onTrack, setOnTrack] = useState(String(tol.on_track_pct))
  const [risk, setRisk] = useState(String(tol.risk_pct))
  useEffect(() => { setOnTrack(String(tol.on_track_pct)); setRisk(String(tol.risk_pct)) }, [tol.on_track_pct, tol.risk_pct])
  const tolCheck = parseTolerancesDraft({ onTrack, risk })
  const tolDirty = !tolCheck.ok || tolCheck.value.on_track_pct !== tol.on_track_pct || tolCheck.value.risk_pct !== tol.risk_pct
  const savingTol = saving === 'pb_verdict_tolerances'

  // ── Pop-up cards per day ──
  const [cards, setCards] = useState(String(v.pb_popup_cards_per_day))
  useEffect(() => setCards(String(v.pb_popup_cards_per_day)), [v.pb_popup_cards_per_day])
  const cardsN = Number(cards)
  const cardsValid = cards.trim() !== '' && Number.isInteger(cardsN) && cardsN >= 0 && cardsN <= 10
  const savingCards = saving === 'pb_popup_cards_per_day'

  return (
    <Panel
      title={<span className="flex items-center gap-2"><span className="text-blue-300"><Target size={14} /></span>Точка Б</span>}
      description="Всплывающий слой кабинета, пересчёт прогноза и план-факта по расписанию и границы вердикта «на курсе / риск / отстаём». Письма и Telegram с приглашениями Точки Б уходят только в рабочие часы раздела «Общение»."
    >
      <Row k="pb_popups_enabled" meta={meta}>
        <button
          type="button"
          role="switch"
          aria-checked={v.pb_popups_enabled}
          aria-label={SETTINGS.pb_popups_enabled.label}
          disabled={disabled || !!saving}
          onClick={() => void onSave({ pb_popups_enabled: !v.pb_popups_enabled }, SETTINGS.pb_popups_enabled.label)}
          className={cx(
            'relative inline-flex h-6 w-11 items-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50',
            v.pb_popups_enabled ? 'border-emerald-400/40 bg-emerald-500/60' : 'border-white/[0.12] bg-white/[0.08]',
          )}
        >
          <span className={cx('inline-block h-4 w-4 rounded-full bg-white shadow transition-transform', v.pb_popups_enabled ? 'translate-x-6' : 'translate-x-1')} />
        </button>
      </Row>

      <Row k="pb_popup_cards_per_day" meta={meta} note={!v.pb_popups_enabled ? 'Всплывающий слой выключен — лимит сейчас не действует.' : null}>
        <div className="flex items-center gap-2">
          <input
            type="number" inputMode="numeric" min={0} max={10} step={1} value={cards} disabled={disabled}
            onChange={(e) => setCards(e.target.value)} aria-invalid={!cardsValid} aria-label={SETTINGS.pb_popup_cards_per_day.label}
            className={cx(inputClass, 'w-24 py-1.5 text-right', !cardsValid && 'border-red-500/50')}
          />
          <span className="text-[11px] text-slate-500">в сутки</span>
          {(!cardsValid || cardsN !== v.pb_popup_cards_per_day) && (
            <Button size="sm" variant="primary" disabled={!cardsValid || disabled} loading={savingCards} onClick={() => void onSave({ pb_popup_cards_per_day: cardsN }, 'Карточек в сутки')}>
              {actionLabel('Сохранить', savingCards)}
            </Button>
          )}
        </div>
        {!cardsValid && <p role="alert" className="mt-1 text-[11px] text-red-300">Целое число от 0 до 10</p>}
      </Row>

      <Row k="pb_recompute_cron" meta={meta} note={stored ? null : `Сейчас задано вручную: «${v.pb_recompute_cron}». Сохранение формы заменит это выражение.`}>
        <fieldset className="flex flex-col gap-2" disabled={disabled || savingCron}>
          <legend className="sr-only">Дни и час пересчёта</legend>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Дни недели">
            {FORM_DAYS.map(([d, label]) => (
              <label
                key={d}
                className={cx(
                  'cursor-pointer select-none rounded-lg border px-2.5 py-1 text-[11px] font-medium',
                  sched.days.includes(d) ? 'border-blue-500/40 bg-blue-500/15 text-blue-200' : 'border-white/[0.08] text-slate-500',
                )}
              >
                <input type="checkbox" className="sr-only" checked={sched.days.includes(d)} onChange={() => toggleDay(d)} />
                {label}
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-[11px] text-slate-400">
              Час (UTC)
              <select
                value={sched.hourUtc}
                onChange={(e) => setSched((s) => ({ ...s, hourUtc: Number(e.target.value) }))}
                className="rounded-xl border border-white/[0.08] bg-[#0b1128] px-3 py-1.5 text-xs text-slate-200 focus:outline-none"
              >
                {HOURS.map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
              </select>
            </label>
            {schedDirty && (
              <Button
                size="sm" variant="primary" disabled={!schedCheck.ok || disabled} loading={savingCron}
                onClick={() => { if (schedCheck.ok) void onSave({ pb_recompute_cron: schedCheck.value }, 'Расписание пересчёта') }}
              >
                {actionLabel('Сохранить', savingCron)}
              </Button>
            )}
          </div>
          <p className="text-[11px] text-slate-400" data-testid="pb-cron-summary">
            {describeRecomputeSchedule(sched)}
            {schedCheck.ok && <span className="ml-1 font-mono text-slate-600">({schedCheck.value})</span>}
          </p>
          {!schedCheck.ok && <p role="alert" className="text-[11px] text-red-300">{schedCheck.error}</p>}
        </fieldset>
      </Row>

      <Row k="pb_verdict_tolerances" meta={meta}>
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-[11px] text-slate-400">
              «На курсе» — отставание до, %
              <input
                type="text" inputMode="decimal" value={onTrack} disabled={disabled} onChange={(e) => setOnTrack(e.target.value)}
                aria-invalid={!tolCheck.ok} className={cx(inputClass, 'w-24 py-1.5 text-right', !tolCheck.ok && 'border-red-500/50')}
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-slate-400">
              «Риск» — отставание до, %
              <input
                type="text" inputMode="decimal" value={risk} disabled={disabled} onChange={(e) => setRisk(e.target.value)}
                aria-invalid={!tolCheck.ok} className={cx(inputClass, 'w-24 py-1.5 text-right', !tolCheck.ok && 'border-red-500/50')}
              />
            </label>
            {tolDirty && (
              <Button
                size="sm" variant="primary" disabled={!tolCheck.ok || disabled} loading={savingTol}
                onClick={() => { if (tolCheck.ok) void onSave({ pb_verdict_tolerances: tolCheck.value }, 'Допуски вердикта') }}
              >
                {actionLabel('Сохранить', savingTol)}
              </Button>
            )}
          </div>
          {tolCheck.ok ? (
            <p className="text-[11px] leading-relaxed text-slate-500">
              Факт ниже плана до {fmtPct(tolCheck.value.on_track_pct)} — «на курсе»; до {fmtPct(tolCheck.value.risk_pct)} — «риск»; больше — «отстаём».
            </p>
          ) : (
            <p role="alert" className="text-[11px] text-red-300">{tolCheck.error}</p>
          )}
        </div>
      </Row>
    </Panel>
  )
}

const fmtPct = (n: number): string => `${String(n).replace('.', ',')} %`
