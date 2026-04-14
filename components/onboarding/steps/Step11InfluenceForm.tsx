'use client'

import { DynamicTable } from '@/components/onboarding/shared/DynamicTable'

interface Props { data: Record<string, unknown>; onChange: (key: string, value: unknown) => void }

const INFLUENCE_CATEGORIES = [
  'Clients', 'Partners', 'Contractors', 'Suppliers', 'Board of Directors',
  'Government Agencies', 'Investors', 'Competitors', 'Industry Leaders',
  'Opinion Leaders', 'Media / PR', 'Referrals', 'Coaches / Trainers',
  'Universities', 'Politics and World Community',
]

const COLUMNS = [
  { key: 'category', label: 'Category', type: 'select' as const, options: INFLUENCE_CATEGORIES.map(c => ({ value: c, label: c })) },
  { key: 'name_or_link', label: 'Full Name / Company / Link', type: 'text' as const },
  { key: 'status', label: 'Relationship Status', type: 'select' as const, options: [
    { value: 'has contact', label: 'Has Contact' },
    { value: 'in progress', label: 'In Progress' },
    { value: 'no', label: 'No' },
  ]},
]

const DEFAULT_ROWS = INFLUENCE_CATEGORIES.map(cat => ({
  category: cat, name_or_link: '', status: '',
}))

export function Step11InfluenceForm({ data, onChange }: Props) {
  const rows = (data.s11_influence_map as Record<string, unknown>[]) || DEFAULT_ROWS

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 pb-2 border-b border-white/[0.06]">
        <span className="material-symbols-outlined text-base text-primary/60">hub</span>
        <h3 className="text-sm font-bold text-on-surface">Influence Map</h3>
      </div>
      <p className="text-xs text-on-surface-variant">
        Enter data of people and organizations that can influence your business
      </p>
      <DynamicTable
        columns={COLUMNS}
        rows={rows}
        onChange={(newRows) => onChange('s11_influence_map', newRows)}
        minRows={15}
      />
    </div>
  )
}
