'use client'

import { NumberField, type NumberFieldProps } from '@/components/onboarding/shared/NumberField'
import { FieldNote } from '@/components/onboarding/shared/FieldNote'
import { FIELD_NOTES } from '@/components/onboarding/constants/step-config'

interface Props { data: Record<string, unknown>; onChange: (key: string, value: unknown) => void; userId?: string }

export function Step9FinanceForm({ data, onChange, userId }: Props) {
  const v = (key: string) => (typeof data[key] === 'string' ? (data[key] as string) : '')
  // Numbers: one NumberField (empty stays EMPTY — it used to render 0, users
  // skipped it and a loss «−» snapped back to 0; «Не знаю» / «примерно» chips).
  const num = (key: string, label: string, props: Omit<NumberFieldProps, 'id' | 'label' | 'value' | 'onChange'> = {}) => (
    <NumberField id={key} label={label} value={data[key]} onChange={(x) => onChange(key, x)} note={FIELD_NOTES[key]} {...props} />
  )
  const money = (key: string, label: string, props: Omit<NumberFieldProps, 'id' | 'label' | 'value' | 'onChange'> = {}) =>
    num(key, label, { unit: '₸', integer: true, allowApprox: true, ...props })

  const field = (key: string, label: string, type: 'text' | 'textarea' = 'text', placeholder?: string) => (
    <div>
      <label htmlFor={key} className="block text-[10px] font-mono text-on-surface-variant/70 uppercase tracking-wider mb-1.5">{label}</label>
      <FieldNote fieldKey={key} />
      {type === 'textarea' ? (
        <textarea id={key} value={v(key)} onChange={e => onChange(key, e.target.value)} placeholder={placeholder}
          rows={3} className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:border-primary/50 focus:ring-1 focus:ring-primary/20 focus:outline-none transition-all resize-none" />
      ) : (
        <input id={key} type="text" value={v(key)}
          onChange={e => onChange(key, e.target.value)}
          placeholder={placeholder}
          className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:border-primary/50 focus:ring-1 focus:ring-primary/20 focus:outline-none transition-all" />
      )}
    </div>
  )

  const select = (key: string, label: string, options: {value:string,label:string}[]) => (
    <div>
      <label htmlFor={key} className="block text-[10px] font-mono text-on-surface-variant/70 uppercase tracking-wider mb-1.5">{label}</label>
      <select id={key} value={v(key)} onChange={e => onChange(key, e.target.value)}
        className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-2.5 text-sm text-on-surface focus:border-primary/50 focus:outline-none transition-all">
        <option value="">-- Выберите --</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )

  const section = (title: string, icon: string, children: React.ReactNode) => (
    <div className="space-y-4">
      <div className="flex items-center gap-2 pb-2 border-b border-white/[0.06]">
        <span className="material-symbols-outlined text-base text-primary/60">{icon}</span>
        <h3 className="text-sm font-bold text-on-surface">{title}</h3>
      </div>
      {children}
    </div>
  )

  return (
    <div className="space-y-6">
      {section('Основные показатели', 'payments', (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {money('s9n_revenue_2024', 'Годовая выручка 2024')}
          {field('s9n_change_vs_2023', 'Изменение выручки vs 2023', 'text', '+15% или -10%')}
          {money('s9n_net_profit', 'Чистая прибыль/убыток 2024', { allowNegative: true })}
          {num('s9n_net_margin', 'Чистая маржа', { unit: '%', allowNegative: true, max: 100 })}
          {field('s9n_revenue_sources', 'Основные источники дохода', 'textarea', '1-3 пункта')}
          {field('s9n_seasonality', 'Сезонность: пики и провалы', 'textarea')}
          {field('s9n_breakeven_point', 'Точка безубыточности', 'text')}
          {field('s9n_dividend_policy', 'Дивидендная политика', 'textarea', 'Как собственник извлекает доход')}
        </div>
      ))}

      {section('Структура расходов', 'receipt_long', (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* ₸ PER YEAR: every reader treats these answers as yearly (finmodel/sources.ts, metrics/formulas.ts). */}
          {money('s9n_expense_cogs', 'Себестоимость продукции/услуг', { unit: '₸/год' })}
          {money('s9n_expense_marketing', 'Маркетинг и реклама', { unit: '₸/год' })}
          {money('s9n_expense_rent', 'Аренда, коммунальные', { unit: '₸/год' })}
          {money('s9n_expense_other', 'Прочие расходы', { unit: '₸/год' })}
        </div>
      ))}

      {section('Управление финансами', 'account_balance', (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {field('s9n_accounting_method', 'Способ ведения финансового учёта', 'text')}
          {select('s9n_planning_frequency', 'Частота финансового планирования', [
            { value: 'never', label: 'Не планируем' }, { value: 'monthly', label: 'Ежемесячно' },
            { value: 'quarterly', label: 'Ежеквартально' }, { value: 'yearly', label: 'Ежегодно' },
          ])}
          {select('s9n_analysis_frequency', 'Частота анализа результатов', [
            { value: 'never', label: 'Не анализируем' }, { value: 'monthly', label: 'Ежемесячно' },
            { value: 'quarterly', label: 'Ежеквартально' },
          ])}
          {field('s9n_responsible_person', 'Ответственный за финансы', 'text', 'Должность')}
          {field('s9n_tracked_kpis', 'Какие ключевые показатели ведутся', 'textarea')}
          {num('s9n_debtor_days', 'Средний срок оплаты (дебиторка)', { unit: 'дней', integer: true })}
          {money('s9n_debts_amount', 'Текущие кредиты/долги')}
          {field('s9n_tax_system', 'Система налогообложения', 'text')}
          {num('s9n_transparency_pct', 'Прозрачность (% белой выручки)', { unit: '%', max: 100 })}
          {field('s9n_tax_audits', 'Были ли налоговые проверки за 2 года', 'text')}
          {field('s9n_audit_preparedness', 'Подготовленность к проверкам', 'text')}
          {field('s9n_financial_blockers', 'Что мешает улучшить финансы', 'textarea')}
        </div>
      ))}
    </div>
  )
}
