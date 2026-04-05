import { NextResponse } from 'next/server'
import type { MetricDefinition } from '@/types/metrics'

const CATALOG: MetricDefinition[] = [
  // --- Default 4 ---
  { id: 'revenue',     label: 'Доход',          description: 'Общая выручка за период',              category: 'financial',   icon: 'payments',      unit: '₸М', unitPosition: 'before', color: '#6effc0', isDefault: true,  isRemovable: false },
  { id: 'margin',      label: 'Маржа',           description: 'Чистая маржинальность бизнеса',        category: 'financial',   icon: 'percent',       unit: '%',  unitPosition: 'after',  color: '#bcc7de', isDefault: true,  isRemovable: false },
  { id: 'clients',     label: 'Клиенты',         description: 'Количество активных клиентов',         category: 'customer',    icon: 'groups',        unit: '',   unitPosition: 'after',  color: '#ffbd60', isDefault: true,  isRemovable: false },
  { id: 'avg_check',   label: 'Средний чек',     description: 'Средняя выручка на клиента',           category: 'financial',   icon: 'receipt_long',  unit: '₸М', unitPosition: 'before', color: '#c9a6ff', isDefault: true,  isRemovable: false },
  // --- Financial ---
  { id: 'expenses',    label: 'Расходы',         description: 'Операционные расходы',                 category: 'financial',   icon: 'trending_down', unit: '₸М', unitPosition: 'before', color: '#ff6b6b', isDefault: false, isRemovable: true },
  { id: 'ebitda',      label: 'EBITDA',          description: 'Прибыль до налогов и амортизации',     category: 'financial',   icon: 'finance',       unit: '₸М', unitPosition: 'before', color: '#6effc0', isDefault: false, isRemovable: true },
  { id: 'cac',         label: 'CAC',             description: 'Стоимость привлечения клиента',        category: 'financial',   icon: 'person_add',    unit: '₸',  unitPosition: 'before', color: '#ffd166', isDefault: false, isRemovable: true },
  { id: 'ltv',         label: 'LTV',             description: 'Пожизненная ценность клиента',         category: 'customer',    icon: 'loyalty',       unit: '₸М', unitPosition: 'before', color: '#06d6a0', isDefault: false, isRemovable: true },
  { id: 'ltv_cac',     label: 'LTV/CAC',         description: 'Соотношение ценности к стоимости',     category: 'financial',   icon: 'calculate',     unit: 'x',  unitPosition: 'after',  color: '#4cc9f0', isDefault: false, isRemovable: true },
  // --- Operational ---
  { id: 'churn',       label: 'Отток',           description: 'Процент ушедших клиентов',             category: 'operational', icon: 'person_remove', unit: '%',  unitPosition: 'after',  color: '#ff6b6b', isDefault: false, isRemovable: true },
  { id: 'retention',   label: 'Retention',       description: 'Процент вернувшихся клиентов',         category: 'operational', icon: 'autorenew',     unit: '%',  unitPosition: 'after',  color: '#06d6a0', isDefault: false, isRemovable: true },
  { id: 'mrr',         label: 'MRR',             description: 'Ежемесячный повторяющийся доход',      category: 'financial',   icon: 'repeat',        unit: '₸М', unitPosition: 'before', color: '#4cc9f0', isDefault: false, isRemovable: true },
  { id: 'arr',         label: 'ARR',             description: 'Годовой повторяющийся доход',          category: 'financial',   icon: 'calendar_month',unit: '₸М', unitPosition: 'before', color: '#7b2d8b', isDefault: false, isRemovable: true },
  { id: 'nps',         label: 'NPS',             description: 'Индекс потребительской лояльности',    category: 'customer',    icon: 'star',          unit: '',   unitPosition: 'after',  color: '#ffbd60', isDefault: false, isRemovable: true },
  { id: 'new_clients', label: 'Новые клиенты',   description: 'Привлечённые за период клиенты',       category: 'customer',    icon: 'group_add',     unit: '',   unitPosition: 'after',  color: '#bcc7de', isDefault: false, isRemovable: true },
  { id: 'gri_score',   label: 'GRI Score',       description: 'Индекс готовности к росту',            category: 'operational', icon: 'radar',         unit: '/10',unitPosition: 'after',  color: '#6effc0', isDefault: false, isRemovable: true },
]

export async function GET() {
  return NextResponse.json({ data: CATALOG })
}
