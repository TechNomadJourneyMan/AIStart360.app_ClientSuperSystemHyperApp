'use client'

/**
 * components/giga-panel/user360/point-b/ScenariosPanel.tsx — the expert's scenario
 * calculation inside a plan version (plan Phase 2 Task 9): «Рассчитать сценарии», the three
 * results side by side, the pace profile form, «Выбрать темп для плана», and what the data
 * lacks. Editable in a draft only; in any other status the saved scenarios are read-only.
 * Behaviour lives in scenariosController.ts; this file only draws it.
 */
import { useEffect, useId, useState } from 'react'
import { Calculator, CheckCircle2, RotateCcw, Scale } from 'lucide-react'
import { Badge, Button, cx, inputClass } from '../../kit'
import type { PlanVersionRow } from '@/lib/point-b/plan/types'
import type { ModelResult, ScenarioProfile, ScenarioResult } from '@/lib/point-b/model/types'
import { GAP_ACTIONS, comparisonRows, parseScenarios } from '@/components/point-b/overviewModel'
import {
  DEFAULT_PROFILES, LEVER_KEYS, LEVER_LABEL, PROFILE_LIMITS, SCENARIO_KEYS,
  mixSum, normalizeForm, parseProfiles, profileToForm, validateForms,
  type ProfileErrors, type ProfileForm, type ScenarioError, type ScenarioKey,
} from './scenariosController'
import { useScenariosController } from './useScenariosController'

const INVALID = 'border-red-500/50 focus:border-red-500/60'

export interface ScenariosPanelViewProps {
  versionNumber: number
  /** Only a draft can be recalculated and have a pace chosen. */
  editable: boolean
  scenarios: ScenarioResult[]
  /** The last calculation in this session: carries `missing` and `warnings`. */
  model: ModelResult | null
  selected: string | null
  busy: 'compute' | 'select' | null
  error: ScenarioError | null
  notice: string | null
  forms: ProfileForm[]
  formErrors: Partial<Record<ScenarioKey, ProfileErrors>>
  /** The forms hold the profiles saved in the draft (otherwise: the default paces). */
  fromSaved: boolean
  onField: (key: ScenarioKey, field: 'rampMonths' | 'reserveMonths' | 'growthCapPct' | 'productivityGainPct', value: string) => void
  onMix: (key: ScenarioKey, lever: keyof ScenarioProfile['leverMix'], value: string) => void
  onNormalize: (key: ScenarioKey) => void
  onResetForms: () => void
  onCompute: () => void
  onSelect: (key: ScenarioKey | null) => void
}

function Field({ id, label, hint, error, value, onChange, disabled }: {
  id: string; label: string; hint: string; error?: string; value: string; onChange: (v: string) => void; disabled?: boolean
}) {
  const err = `${id}-err`
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[11px] font-medium text-slate-400">{label}</label>
      <input
        id={id}
        value={value}
        inputMode="decimal"
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? err : undefined}
        className={cx(inputClass, error && INVALID)}
      />
      <p className="mt-0.5 text-[10px] text-slate-600">{hint}</p>
      {error && <p id={err} role="alert" className="mt-0.5 text-[11px] text-red-300">{error}</p>}
    </div>
  )
}

function ProfileFieldset({ form, errors, disabled, p, uid }: {
  form: ProfileForm; errors: ProfileErrors; disabled: boolean; p: ScenariosPanelViewProps; uid: string
}) {
  const L = PROFILE_LIMITS
  const sum = Math.round(mixSum(form.mix) * 10) / 10
  const id = (f: string) => `${uid}-${form.key}-${f}`
  const mixErr = `${id('mix')}-err`
  return (
    <fieldset disabled={disabled} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
      <legend className="px-1 text-xs font-semibold text-slate-200">{form.label}</legend>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field id={id('ramp')} label="Срок выхода рычагов, мес." hint={`от ${L.rampMonths.min} до ${L.rampMonths.max}`} value={form.rampMonths} error={errors.rampMonths} onChange={(v) => p.onField(form.key, 'rampMonths', v)} />
        <Field id={id('reserve')} label="Резерв, мес." hint={`от ${L.reserveMonths.min} до ${L.reserveMonths.max} (считается в Ф3)`} value={form.reserveMonths} error={errors.reserveMonths} onChange={(v) => p.onField(form.key, 'reserveMonths', v)} />
        <Field id={id('cap')} label="Потолок роста в год, %" hint={`от ${L.growthCapAnnual.min * 100} до ${L.growthCapAnnual.max * 100}`} value={form.growthCapPct} error={errors.growthCapPct} onChange={(v) => p.onField(form.key, 'growthCapPct', v)} />
        <Field id={id('gain')} label="Прирост выручки на сотрудника, %" hint={`от ${L.productivityGain.min * 100} до ${L.productivityGain.max * 100}`} value={form.productivityGainPct} error={errors.productivityGainPct} onChange={(v) => p.onField(form.key, 'productivityGainPct', v)} />
      </div>
      <p className="mb-1 mt-3 text-[11px] font-medium text-slate-400">Доли вклада рычагов, %</p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {LEVER_KEYS.map((k) => (
          <div key={k}>
            <label htmlFor={id(`mix-${k}`)} className="mb-1 block text-[11px] text-slate-500">{LEVER_LABEL[k]}</label>
            <input
              id={id(`mix-${k}`)}
              value={form.mix[k]}
              inputMode="decimal"
              onChange={(e) => p.onMix(form.key, k, e.target.value)}
              aria-invalid={errors.mix ? true : undefined}
              aria-describedby={errors.mix ? mixErr : undefined}
              className={cx(inputClass, errors.mix && INVALID)}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
        <span className={cx(sum === 100 ? 'text-slate-500' : 'text-amber-300')}>Сумма долей: {sum}%{sum !== 100 && sum > 0 ? ' — при расчёте будет приведена к 100%' : ''}</span>
        {sum !== 100 && <Button size="sm" onClick={() => p.onNormalize(form.key)}>Привести к 100%</Button>}
      </div>
      {errors.mix && <p id={mixErr} role="alert" className="mt-1 text-[11px] text-red-300">{errors.mix}</p>}
    </fieldset>
  )
}

export function ScenariosPanelView(p: ScenariosPanelViewProps) {
  const uid = useId()
  const rows = comparisonRows(p.scenarios)
  const missing = p.model?.missing ?? []
  const warnings = p.model?.warnings ?? []
  const hasErrors = Object.keys(p.formErrors).length > 0

  return (
    <section aria-label="Сценарии темпа" className="space-y-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-200"><Scale size={13} />Сценарии · версия {p.versionNumber}</p>
          {!p.editable && <Badge tone="neutral">Только чтение</Badge>}
        </div>
        {p.editable && (
          <Button size="sm" variant="primary" icon={<Calculator size={12} />} loading={p.busy === 'compute'} disabled={p.busy !== null} onClick={p.onCompute}>
            Рассчитать сценарии
          </Button>
        )}
      </div>
      {!p.editable && <p className="text-[11px] text-slate-500">Сценарии меняются только в черновике. Здесь — то, что сохранено в этой версии.</p>}

      <div aria-live="polite" className="space-y-2">
        {p.notice && <p className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">{p.notice}</p>}
        {p.error && <p role="alert" className="rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-200">{p.error.message}</p>}
      </div>

      {warnings.length > 0 && (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          <p className="font-medium">Предупреждения расчёта</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </div>
      )}
      {missing.length > 0 && (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          <p className="font-medium">Каких данных не хватает</p>
          <ul className="mt-1 space-y-1">
            {missing.map((m, i) => (
              <li key={`${m.key}-${i}`}>
                <span className="font-medium">{m.label}</span>
                {m.unlocks && <span className="text-amber-200/80"> — откроет: {m.unlocks}</span>}
                {m.actions.length > 0 && <span className="text-amber-200/70"> ({m.actions.map((a) => GAP_ACTIONS[a].label.toLowerCase()).join(', ')})</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {p.scenarios.length === 0 ? (
        <p className="rounded-xl border border-dashed border-white/[0.08] px-3 py-4 text-center text-xs text-slate-500">
          {p.editable ? 'Сценарии ещё не рассчитаны. Нажмите «Рассчитать сценарии» — результат сохранится в черновике.' : 'В этой версии сценарии не рассчитаны.'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-left text-xs">
            <caption className="sr-only">Результаты трёх сценариев темпа</caption>
            <thead>
              <tr className="border-b border-white/[0.06] align-top">
                <th scope="col" className="py-2 pr-3 font-medium text-slate-500"><span className="sr-only">Показатель</span></th>
                {p.scenarios.map((s) => (
                  <th key={s.key} scope="col" className="px-2 py-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-semibold text-slate-100">{s.label}</span>
                      {s.feasible ? <Badge tone="green">Достижим</Badge> : <Badge tone="red" title={s.infeasibleReason ?? undefined}>Не достижим</Badge>}
                      {p.selected === s.key && <Badge tone="blue"><CheckCircle2 size={10} />Выбран</Badge>}
                    </div>
                    {p.editable && p.selected !== s.key && (
                      <Button size="sm" className="mt-1.5" disabled={p.busy !== null} loading={p.busy === 'select'} onClick={() => p.onSelect(s.key)}>
                        Выбрать темп для плана
                      </Button>
                    )}
                    {p.editable && p.selected === s.key && (
                      <Button size="sm" variant="ghost" className="mt-1.5" disabled={p.busy !== null} onClick={() => p.onSelect(null)}>Снять выбор</Button>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-b border-white/[0.04] align-top">
                  <th scope="row" className="py-2 pr-3 font-medium text-slate-500">{r.label}</th>
                  {r.cells.map((lines, i) => (
                    <td key={i} className="px-2 py-2 text-slate-200">
                      {lines.map((l, j) => <span key={j} className={cx('block', j > 0 && 'text-[11px] text-slate-500')}>{l}</span>)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {p.editable && (
        <details className="rounded-xl border border-white/[0.06]" open={hasErrors}>
          <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40">
            Настроить темп сценариев
          </summary>
          <div className="space-y-3 border-t border-white/[0.06] p-3">
            <p className="text-[11px] text-slate-500">
              {p.fromSaved
                ? 'Значения из черновика. Пустые правки не отправляются: без изменений сервер использует профили по шаблону отрасли.'
                : 'Пока значения по умолчанию: точные доли вклада по отрасли клиента подставит расчёт. Если ничего не менять, сервер возьмёт профили по шаблону.'}
            </p>
            {SCENARIO_KEYS.map((k) => {
              const form = p.forms.find((f) => f.key === k)
              return form ? <ProfileFieldset key={k} form={form} errors={p.formErrors[k] ?? {}} disabled={p.busy !== null} p={p} uid={uid} /> : null
            })}
            <Button size="sm" icon={<RotateCcw size={12} />} onClick={p.onResetForms} disabled={p.busy !== null}>Вернуть значения по умолчанию</Button>
          </div>
        </details>
      )}
    </section>
  )
}

/** Stateful wrapper: the controller + the local form fields. `onChanged` reloads the plan. */
export function ScenariosPanel({ userId, version, onChanged }: { userId: string; version: PlanVersionRow; onChanged: () => void }) {
  const { ctl, snap } = useScenariosController(userId)
  const saved = parseProfiles(version.assumptions?.profiles)
  const seedJson = JSON.stringify(saved)
  const [forms, setForms] = useState<ProfileForm[]>(() => (saved ?? DEFAULT_PROFILES).map(profileToForm))
  const [dirty, setDirty] = useState(false)

  // The forms follow the draft on the server (another version, or the profiles a calculation saved).
  useEffect(() => {
    const profiles = (JSON.parse(seedJson) as ScenarioProfile[] | null) ?? DEFAULT_PROFILES
    setForms(profiles.map(profileToForm))
    setDirty(false)
  }, [version.id, seedJson])

  const edit = (key: ScenarioKey, fn: (f: ProfileForm) => ProfileForm) => {
    setForms((prev) => prev.map((f) => (f.key === key ? fn(f) : f)))
    setDirty(true)
  }

  const checked = validateForms(forms)
  const formErrors = checked.ok ? {} : checked.errors
  const mine = snap.result?.versionId === version.id ? snap.result.model : null
  const pick = snap.selected?.versionId === version.id ? snap.selected.key : version.selected_scenario

  const compute = async () => {
    if (!checked.ok) { ctl.setError('Исправьте параметры темпа: есть значения вне допустимых границ'); return }
    if (await ctl.compute(version.id, dirty ? checked.profiles : undefined)) onChanged()
  }

  return (
    <ScenariosPanelView
      versionNumber={version.version}
      editable={version.status === 'draft'}
      scenarios={mine ? mine.scenarios : parseScenarios(version.scenarios)}
      model={mine}
      selected={pick}
      busy={snap.busy}
      error={snap.error}
      notice={snap.notice}
      forms={forms}
      formErrors={formErrors}
      fromSaved={saved !== null}
      onField={(key, field, value) => edit(key, (f) => ({ ...f, [field]: value }))}
      onMix={(key, lever, value) => edit(key, (f) => ({ ...f, mix: { ...f.mix, [lever]: value } }))}
      onNormalize={(key) => edit(key, normalizeForm)}
      onResetForms={() => { setForms((saved ?? DEFAULT_PROFILES).map(profileToForm)); setDirty(false) }}
      onCompute={() => void compute()}
      onSelect={async (key) => { if (await ctl.select(version.id, key)) onChanged() }}
    />
  )
}
