'use client'

/**
 * Goals strip of the dashboard. Goals are saved on the server
 * (public.metric_targets via /api/v1/goals): every goal is a target on a
 * catalog metric with a horizon, so Point A shows the gap А→Б and Point B
 * plans for it. Before, the presets lived only in the browser (zustand) and
 * nothing else in the product knew about them.
 */
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useDeleteGoal, useGoals, useSaveGoal, type GoalItem } from '@/hooks/useGoals'

const MAX_GOALS = 8

interface Preset {
  metricId: string
  label: string
  unit: '₸' | '%' | '' | 'дн'
  direction?: 'higher_is_better' | 'lower_is_better'
  hint: string
}

/** Goals people set most often — each bound to the catalog metric it moves. */
const PRESETS: readonly Preset[] = [
  { metricId: 'biz.finansy.vyruchka_god', label: 'Выручка за год', unit: '₸', hint: 'например, 120 000 000' },
  { metricId: 'biz.finansy.valovaya_marzha', label: 'Валовая маржа', unit: '%', hint: 'например, 40' },
  { metricId: 'biz.prodazhi.sredniy_chek', label: 'Средний чек', unit: '₸', hint: 'например, 2 000 000' },
  { metricId: 'biz.klienty.nps', label: 'NPS', unit: '', hint: 'например, 60' },
  { metricId: 'biz.marketing.ltv_cac', label: 'LTV / CAC', unit: '', hint: 'например, 3' },
  { metricId: 'biz.marketing.cac', label: 'CAC (снизить)', unit: '₸', direction: 'lower_is_better', hint: 'например, 15 000' },
  { metricId: 'biz.prodazhi.tsikl_zakrytiya_sdelki', label: 'Цикл сделки (сократить)', unit: 'дн', direction: 'lower_is_better', hint: 'например, 21' },
  { metricId: 'biz.hr.kol_vo_sotrudnikov', label: 'Команда, человек', unit: '', hint: 'например, 20' },
]

const STATUS: Record<string, { text: string; cls: string }> = {
  achieved: { text: 'достигнута', cls: 'text-primary' },
  on_track: { text: 'по плану', cls: 'text-primary' },
  at_risk: { text: 'под угрозой', cls: 'text-amber-300' },
  behind: { text: 'отстаём', cls: 'text-red-300' },
  overdue: { text: 'срок прошёл', cls: 'text-red-300' },
  no_data: { text: 'нет факта', cls: 'text-on-surface-variant/60' },
  unknown: { text: 'темп не оценить', cls: 'text-on-surface-variant/60' },
}

function fmt(n: number | null, rawUnit: string): string {
  if (n === null) return '—'
  const unit = rawUnit === 'days' ? 'дн' : rawUnit === 'count' ? '' : rawUnit
  const a = Math.abs(n)
  const v = a >= 1_000_000 ? `${Math.round((n / 1_000_000) * 10) / 10} млн` : a >= 10_000 ? `${Math.round(n / 1000)} тыс.` : String(Math.round(n * 100) / 100)
  return unit === '%' ? `${v}%` : unit === '₸' ? `${v} ₸` : unit ? `${v} ${unit}` : v
}

function parseAmount(raw: string): number | null {
  const n = Number(raw.replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

function GoalChip({ item, onRemove }: { item: GoalItem; onRemove: () => void }) {
  const s = STATUS[item.evaluation.status] ?? STATUS.no_data
  return (
    <div
      className="flex items-center gap-1.5 bg-primary/10 border border-primary/20 rounded-full px-3 py-1"
      title={`${item.evaluation.realismText}. Срок: ${item.evaluation.deadline}`}
    >
      <span className="material-symbols-outlined text-[13px] text-primary/60" aria-hidden>flag</span>
      <span className="text-xs text-primary">
        {item.goal.label}: {fmt(item.evaluation.current, item.goal.unit)} → {fmt(item.goal.targetValue, item.goal.unit)}
      </span>
      <span className={`text-[10px] font-mono ${s.cls}`}>{s.text}</span>
      <button onClick={onRemove} className="text-primary/30 hover:text-primary transition-colors ml-0.5" aria-label={`Удалить цель «${item.goal.label}»`}>
        <span className="material-symbols-outlined text-[13px]" aria-hidden>close</span>
      </button>
    </div>
  )
}

/**
 * Goals pinned before they were saved on the server lived only in this
 * browser (localStorage «aistart360-ui».pinnedGoals). They had no metric and
 * no horizon, so they cannot be converted — the owner sees them once to set
 * them again.
 */
function useLegacyGoals(): [string[], () => void] {
  const [labels, setLabels] = useState<string[]>([])
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem('aistart360-ui')
      const pinned = raw ? (JSON.parse(raw)?.state?.pinnedGoals as Array<{ label?: string }> | undefined) : undefined
      if (Array.isArray(pinned) && pinned.length) setLabels(pinned.map((g) => String(g.label ?? '')).filter(Boolean))
    } catch { /* storage unavailable */ }
  }, [])
  const dismiss = () => {
    try {
      const raw = window.localStorage.getItem('aistart360-ui')
      const parsed = raw ? JSON.parse(raw) : null
      if (parsed?.state) {
        delete parsed.state.pinnedGoals
        window.localStorage.setItem('aistart360-ui', JSON.stringify(parsed))
      }
    } catch { /* storage unavailable */ }
    setLabels([])
  }
  return [labels, dismiss]
}

export function GoalsBar() {
  const { data: items = [], isLoading } = useGoals()
  const [legacy, dismissLegacy] = useLegacyGoals()
  const save = useSaveGoal()
  const remove = useDeleteGoal()
  const [open, setOpen] = useState(false)
  const [preset, setPreset] = useState<Preset>(PRESETS[0])
  const [amount, setAmount] = useState('')
  const [period, setPeriod] = useState<'12m' | '3y'>('12m')

  const submit = async () => {
    const value = parseAmount(amount)
    if (value === null || value < 0) {
      toast.error('Введите число', { description: preset.hint })
      return
    }
    if (items.length >= MAX_GOALS && !items.some((i) => i.goal.metricId === preset.metricId && i.goal.periodLabel === period)) {
      toast.warning(`Максимум ${MAX_GOALS} целей`, { description: 'Удалите одну цель, чтобы добавить новую' })
      return
    }
    try {
      const saved = await save.mutateAsync({
        metricId: preset.metricId,
        targetValue: value,
        periodLabel: period,
        direction: preset.direction ?? 'higher_is_better',
        label: `${preset.label} ${period === '12m' ? 'через 12 мес.' : 'через 3 года'}`,
      })
      toast.success('Цель сохранена', { description: saved.evaluation.realismText })
      setAmount('')
      setOpen(false)
    } catch (err) {
      toast.error('Не удалось сохранить цель', { description: err instanceof Error ? err.message : undefined })
    }
  }

  return (
    <>
      {legacy.length > 0 && (
        <div className="mb-2 rounded-xl border border-amber-300/20 bg-amber-300/[0.05] p-3 text-xs text-on-surface" role="status">
          <p>Цели теперь сохраняются в профиле компании и учитываются в Точке А и Точке Б. Ваши прежние цели были только в этом браузере — задайте их заново с числом и сроком: {legacy.join(', ')}.</p>
          <button type="button" onClick={dismissLegacy} className="mt-2 font-mono text-[11px] text-primary hover:underline">Понятно</button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {items.length > 0 && (
          <span className="text-[10px] font-mono text-on-surface-variant/40 uppercase tracking-widest flex-shrink-0">Цели:</span>
        )}
        {items.map((item) => (
          <GoalChip
            key={item.goal.id}
            item={item}
            onRemove={() => remove.mutate(item.goal.id, { onError: () => toast.error('Не удалось удалить цель') })}
          />
        ))}
        {!isLoading && items.length < MAX_GOALS && (
          <button
            onClick={() => setOpen(true)}
            className="flex items-center gap-1.5 text-xs font-mono text-on-surface-variant/40 hover:text-primary transition-colors border border-dashed border-white/[0.08] hover:border-primary/30 rounded-full px-3 py-1"
          >
            <span className="material-symbols-outlined text-[14px]" aria-hidden>add_circle</span>
            {items.length === 0 ? 'Добавить цели роста' : 'Цель'}
          </button>
        )}
      </div>

      {open && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Новая цель"
            className="relative z-10 w-full sm:max-w-lg bg-surface-container-low rounded-t-2xl sm:rounded-2xl border border-white/[0.08] shadow-2xl p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-headline text-base font-bold text-on-surface">Цель роста</h3>
              <button onClick={() => setOpen(false)} aria-label="Закрыть" className="w-8 h-8 flex items-center justify-center rounded-lg text-on-surface-variant/40 hover:text-on-surface hover:bg-white/[0.06] transition-all">
                <span className="material-symbols-outlined text-xl" aria-hidden>close</span>
              </button>
            </div>
            <p className="text-xs text-on-surface-variant mb-4">
              Цель — значение показателя к сроку. Точка А покажет разрыв, Точка Б — план, как его закрыть.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 mb-4 max-h-56 overflow-y-auto no-scrollbar pr-1">
              {PRESETS.map((p) => {
                const active = p.metricId === preset.metricId
                return (
                  <button
                    key={p.metricId}
                    onClick={() => setPreset(p)}
                    className={`flex items-center gap-2 p-2.5 rounded-xl border text-left transition-all ${active ? 'border-primary/30 bg-primary/10' : 'border-white/[0.06] hover:border-primary/30 hover:bg-white/[0.02]'}`}
                  >
                    <span className={`material-symbols-outlined text-sm flex-shrink-0 ${active ? 'text-primary' : 'text-on-surface-variant/40'}`} aria-hidden>
                      {active ? 'radio_button_checked' : 'radio_button_unchecked'}
                    </span>
                    <span className="text-sm text-on-surface">{p.label}</span>
                  </button>
                )
              })}
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <label className="flex-1">
                <span className="sr-only">Целевое значение</span>
                <input
                  value={amount}
                  inputMode="decimal"
                  onChange={(e) => setAmount(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void submit()}
                  placeholder={`Цель${preset.unit ? `, ${preset.unit}` : ''} — ${preset.hint}`}
                  className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-2.5 text-base sm:text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 transition-all"
                />
              </label>
              <label>
                <span className="sr-only">Срок</span>
                <select
                  value={period}
                  onChange={(e) => setPeriod(e.target.value as '12m' | '3y')}
                  className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-3 py-2.5 text-base sm:text-sm text-on-surface focus:outline-none focus:border-primary/50"
                >
                  <option value="12m">через 12 месяцев</option>
                  <option value="3y">через 3 года</option>
                </select>
              </label>
              <button
                onClick={() => void submit()}
                disabled={!amount.trim() || save.isPending}
                className="px-4 py-2.5 bg-primary/20 hover:bg-primary/30 text-primary rounded-xl text-sm font-mono transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {save.isPending ? '…' : 'Сохранить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
