'use client'

import { DynamicTable } from '@/components/onboarding/shared/DynamicTable'

interface Props { data: Record<string, unknown>; onChange: (key: string, value: unknown) => void }

const INFLUENCE_CATEGORIES = [
  'Клиенты', 'Партнёры', 'Подрядчики', 'Поставщики', 'Совет директоров',
  'Государственные органы', 'Инвесторы', 'Конкуренты', 'Лидеры отрасли',
  'Лидеры мнения', 'СМИ / PR', 'Рекомендатели', 'Коучи / тренеры',
  'Университеты', 'Политика и мировое сообщество',
]

const COLUMNS = [
  { key: 'category', label: 'Категория', type: 'select' as const, options: INFLUENCE_CATEGORIES.map(c => ({ value: c, label: c })) },
  { key: 'name_or_link', label: 'ФИО / Компания / Ссылка', type: 'text' as const },
  { key: 'status', label: 'Статус отношений', type: 'select' as const, options: [
    { value: 'есть контакт', label: 'Есть контакт' },
    { value: 'в работе', label: 'В работе' },
    { value: 'нет', label: 'Нет' },
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
        <h3 className="text-sm font-bold text-on-surface">Карта влияния</h3>
      </div>
      <p className="text-xs text-on-surface-variant">
        Внесите данные людей и организаций, способных оказать влияние на ваш бизнес
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
