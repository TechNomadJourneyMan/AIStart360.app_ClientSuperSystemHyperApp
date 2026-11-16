'use client'

/**
 * GIGA → Настройки → «Анкета» (R4-B4, R-027): how clients fill in the
 * questionnaire — a setting, not the build flag NEXT_PUBLIC_SURVEY_MODES any more.
 *   • the full questionnaire — always on (no switch);
 *   • «Экспресс + блоки» — `survey_modes.express`;
 *   • «Беседа с ИИ» — `survey_chat_enabled` (the AI helper of the questionnaire,
 *     the same switch also gives the «Помощник» button at the questions);
 *   • the mode a new client sees first, «Рекомендуем» — `survey_modes.default_mode`
 *     (only modes that are on can be picked; when the chosen one is off the
 *     client gets express or, without it, the full questionnaire);
 *   • the AI budget of the helper per Free client.
 * Saving goes through the page's `onSave` (PUT /api/giga-admin/settings:
 * validated by the registry, written to the audit log).
 */
import { useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { ClipboardList } from 'lucide-react'
import { Button, Panel, cx, fmtAgo, fmtDateTime, inputClass } from '@/components/giga-panel/kit'
import { SETTINGS, type SettingKey, type SettingValue } from '@/lib/settings/registry'
import { SURVEY_MODE_INFO, resolveSurveyModes, type SurveyMode } from '@/lib/survey/modes'
import { actionLabel } from '@/lib/ui/pending'

type SurveyKey = 'survey_modes' | 'survey_chat_enabled' | 'survey_ai_budget_usd_per_client'
export type SurveySettingsValues = { [K in SurveyKey]: SettingValue<K> }
type Meta = Record<string, { updated_at: string; updated_by: string | null }>

export interface SurveySettingsCardProps {
  values: SurveySettingsValues
  meta: Meta
  disabled: boolean
  /** The key list of the request in flight (the page's `saving`), or null. */
  saving: string | null
  onSave: (patch: Partial<SurveySettingsValues>, label: string) => Promise<boolean>
}

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

function Switch({ checked, label, disabled, onChange }: { checked: boolean; label: string; disabled?: boolean; onChange?: (next: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className={cx(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'border-emerald-400/40 bg-emerald-500/60' : 'border-white/[0.12] bg-white/[0.08]',
      )}
    >
      <span className={cx('inline-block h-4 w-4 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-6' : 'translate-x-1')} />
    </button>
  )
}

const MODE_LINE: Record<SurveyMode, string> = {
  full: 'Полная анкета — 12 разделов',
  express: 'Экспресс + блоки — снимок бизнеса и блоки',
  chat: 'Беседа с ИИ',
}

export function SurveySettingsCard({ values: v, meta, disabled, saving, onSave }: SurveySettingsCardProps) {
  const modes = v.survey_modes
  const effective = resolveSurveyModes(modes, v.survey_chat_enabled)
  const busy = disabled || !!saving

  const setExpress = (on: boolean) => {
    // Turning express off while it is the default: the default moves with it, in one save.
    const default_mode: SurveyMode = !on && modes.default_mode === 'express' ? 'full' : modes.default_mode
    void onSave({ survey_modes: { ...modes, express: on, default_mode } }, on ? 'Экспресс включён' : 'Экспресс выключен')
  }

  // ── Budget ──
  const [budget, setBudget] = useState(String(v.survey_ai_budget_usd_per_client))
  useEffect(() => setBudget(String(v.survey_ai_budget_usd_per_client)), [v.survey_ai_budget_usd_per_client])
  const budgetN = Number(budget.replace(',', '.'))
  const budgetValid = budget.trim() !== '' && Number.isFinite(budgetN) && budgetN >= 0 && budgetN <= 100
  const savingBudget = saving === 'survey_ai_budget_usd_per_client'

  const defaultNote = modes.default_mode !== effective.defaultMode
    ? `«${SURVEY_MODE_INFO[modes.default_mode].short}» сейчас выключен — новым клиентам первым предлагается «${SURVEY_MODE_INFO[effective.defaultMode].short}».`
    : null

  return (
    <Panel
      title={<span className="flex items-center gap-2"><span className="text-blue-300"><ClipboardList size={14} /></span>Анкета</span>}
      description="Как клиенты заполняют анкету. Ответы общие для всех способов: при переключении ничего не теряется. Изменения действуют через несколько секунд, без пересборки портала."
    >
      <Row k="survey_modes" meta={meta}>
        <ul className="space-y-2" aria-label="Способы заполнения">
          <li className="flex items-center justify-between gap-3 text-xs text-slate-300">
            <span>{MODE_LINE.full} <span className="text-slate-500">· включена всегда</span></span>
            <Switch checked label={`${MODE_LINE.full}: включена всегда`} disabled />
          </li>
          <li className="flex items-center justify-between gap-3 text-xs text-slate-300">
            <span>{MODE_LINE.express}</span>
            <Switch checked={modes.express} label={MODE_LINE.express} disabled={busy} onChange={setExpress} />
          </li>
          <li className="flex items-center justify-between gap-3 text-xs text-slate-300">
            <span>{MODE_LINE.chat} <span className="text-slate-500">· переключатель «{SETTINGS.survey_chat_enabled.label}» ниже</span></span>
            <span className={cx('rounded-full px-2 py-0.5 text-[10px]', v.survey_chat_enabled ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/[0.06] text-slate-400')}>
              {v.survey_chat_enabled ? 'включена' : 'выключена'}
            </span>
          </li>
        </ul>
        <div className="mt-3">
          <p className="mb-1.5 text-[11px] text-slate-400">Новым клиентам первым («Рекомендуем»)</p>
          <div role="radiogroup" aria-label="Новым клиентам первым" className="inline-flex flex-wrap gap-1 rounded-xl border border-white/[0.08] bg-white/[0.03] p-1">
            {effective.enabled.map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={m === effective.defaultMode}
                disabled={busy || m === effective.defaultMode}
                onClick={() => void onSave({ survey_modes: { ...modes, default_mode: m } }, 'Способ по умолчанию')}
                className={cx(
                  'rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-colors disabled:cursor-default',
                  m === effective.defaultMode ? 'bg-blue-500 text-white' : 'text-slate-400 hover:bg-white/[0.06] hover:text-slate-200 disabled:opacity-50',
                )}
              >
                {SURVEY_MODE_INFO[m].short}
              </button>
            ))}
          </div>
          {defaultNote && <p className="mt-1 text-[11px] text-amber-300/80">{defaultNote}</p>}
          <p className="mt-1 text-[11px] text-slate-500" data-testid="survey-modes-now">
            Сейчас у клиентов: {effective.enabled.map((m) => SURVEY_MODE_INFO[m].short).join(' · ')}; новым первым — «{SURVEY_MODE_INFO[effective.defaultMode].short}».
          </p>
        </div>
      </Row>

      <Row k="survey_chat_enabled" meta={meta}>
        <Switch
          checked={v.survey_chat_enabled}
          label={SETTINGS.survey_chat_enabled.label}
          disabled={busy}
          onChange={(n) => void onSave({ survey_chat_enabled: n }, SETTINGS.survey_chat_enabled.label)}
        />
      </Row>

      <Row k="survey_ai_budget_usd_per_client" meta={meta} note={!v.survey_chat_enabled ? 'ИИ-помощник выключен — потолок сейчас не действует.' : null}>
        <div className="flex items-center gap-2">
          <input
            type="number" inputMode="decimal" min={0} max={100} step={0.1} value={budget} disabled={disabled}
            onChange={(e) => setBudget(e.target.value)} aria-invalid={!budgetValid} aria-label={SETTINGS.survey_ai_budget_usd_per_client.label}
            className={cx(inputClass, 'w-24 py-1.5 text-right', !budgetValid && 'border-red-500/50')}
          />
          <span className="text-[11px] text-slate-500">$ на клиента</span>
          {(!budgetValid || budgetN !== v.survey_ai_budget_usd_per_client) && (
            <Button size="sm" variant="primary" disabled={!budgetValid || disabled} loading={savingBudget} onClick={() => void onSave({ survey_ai_budget_usd_per_client: budgetN }, 'Потолок ИИ-помощника')}>
              {actionLabel('Сохранить', savingBudget)}
            </Button>
          )}
        </div>
        {!budgetValid && <p role="alert" className="mt-1 text-[11px] text-red-300">Число от 0 до 100</p>}
      </Row>

      <div className="flex flex-wrap gap-x-4 gap-y-1 pt-3 text-[11px]">
        <Link href="/admin-giga-panel/surveys" className="text-blue-300 hover:underline">Анкеты и воронка способов</Link>
      </div>
    </Panel>
  )
}
