'use client'

interface Props { data: Record<string, unknown>; onChange: (key: string, value: unknown) => void; userId?: string }

export function Step9FinanceForm({ data, onChange, userId }: Props) {
  const v = (key: string) => (data[key] as string) ?? ''
  const n = (key: string) => (data[key] as number) ?? 0

  const field = (key: string, label: string, type: 'text' | 'number' | 'textarea' = 'text', placeholder?: string) => (
    <div>
      <label className="block text-[10px] font-mono text-on-surface-variant/70 uppercase tracking-wider mb-1.5">{label}</label>
      {type === 'textarea' ? (
        <textarea value={v(key)} onChange={e => onChange(key, e.target.value)} placeholder={placeholder}
          rows={3} className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:border-primary/50 focus:ring-1 focus:ring-primary/20 focus:outline-none transition-all resize-none" />
      ) : (
        <input type={type} value={type === 'number' ? n(key) : v(key)}
          onChange={e => onChange(key, type === 'number' ? Number(e.target.value) || 0 : e.target.value)}
          placeholder={placeholder}
          className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:border-primary/50 focus:ring-1 focus:ring-primary/20 focus:outline-none transition-all" />
      )}
    </div>
  )

  const select = (key: string, label: string, options: {value:string,label:string}[]) => (
    <div>
      <label className="block text-[10px] font-mono text-on-surface-variant/70 uppercase tracking-wider mb-1.5">{label}</label>
      <select value={v(key)} onChange={e => onChange(key, e.target.value)}
        className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-2.5 text-sm text-on-surface focus:border-primary/50 focus:outline-none transition-all">
        <option value="">-- Select --</option>
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
      {section('Key Indicators', 'payments', (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {field('s9n_revenue_2024', 'Annual Revenue 2024 (₸)', 'number')}
          {field('s9n_change_vs_2023', 'Revenue Change vs 2023', 'text', '+15% or -10%')}
          {field('s9n_net_profit', 'Net Profit/Loss 2024 (₸)', 'number')}
          {field('s9n_net_margin', 'Net Margin (%)', 'number')}
          {field('s9n_revenue_sources', 'Main Revenue Sources', 'textarea', '1-3 items')}
          {field('s9n_seasonality', 'Seasonality: Peaks and Drops', 'textarea')}
          {field('s9n_breakeven_point', 'Break-Even Point', 'text')}
          {field('s9n_dividend_policy', 'Dividend Policy', 'textarea', 'How the owner extracts income')}
        </div>
      ))}

      {section('Expense Structure', 'receipt_long', (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {field('s9n_expense_cogs', 'Cost of Goods/Services', 'text')}
          {field('s9n_expense_marketing', 'Marketing and Advertising', 'text')}
          {field('s9n_expense_rent', 'Rent and Utilities', 'text')}
          {field('s9n_expense_other', 'Other Expenses', 'text')}
        </div>
      ))}

      {section('Financial Management', 'account_balance', (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {field('s9n_accounting_method', 'Financial Accounting Method', 'text')}
          {select('s9n_planning_frequency', 'Financial Planning Frequency', [
            { value: 'never', label: 'Not planning' }, { value: 'monthly', label: 'Monthly' },
            { value: 'quarterly', label: 'Quarterly' }, { value: 'yearly', label: 'Yearly' },
          ])}
          {select('s9n_analysis_frequency', 'Results Analysis Frequency', [
            { value: 'never', label: 'Not analyzing' }, { value: 'monthly', label: 'Monthly' },
            { value: 'quarterly', label: 'Quarterly' },
          ])}
          {field('s9n_responsible_person', 'Finance Responsible Person', 'text', 'Position')}
          {field('s9n_tracked_kpis', 'Which Key Indicators are Tracked', 'textarea')}
          {field('s9n_debtor_days', 'Average Payment Term (receivables, days)', 'number')}
          {field('s9n_debts_amount', 'Current Loans/Debts (₸)', 'number')}
          {field('s9n_tax_system', 'Tax System', 'text')}
          {field('s9n_transparency_pct', 'Transparency (% of white revenue)', 'number')}
          {field('s9n_tax_audits', 'Any tax audits in the last 2 years', 'text')}
          {field('s9n_audit_preparedness', 'Audit Preparedness', 'text')}
          {field('s9n_financial_blockers', 'What prevents financial improvement', 'textarea')}
        </div>
      ))}
    </div>
  )
}
