import { describe, it, expect } from 'vitest'

import { TopSalesTableView } from '@/components/dashboard/TopSalesTable'
import type { TopTableRow } from '@/types/point-a-dashboard'
import { walk, collectText, flatten } from './_walk'

function render(props: Parameters<typeof TopSalesTableView>[0]) {
  return walk(TopSalesTableView(props))
}

function textOf(props: Parameters<typeof TopSalesTableView>[0]) {
  return collectText(TopSalesTableView(props))
}

function buildRows(): TopTableRow[] {
  const seeds: Array<[TopTableRow['key'], string, TopTableRow['unit']]> = [
    ['sales_count', 'Количество продаж', 'count'],
    ['sales_sum', 'Сумма продаж', '₸'],
    ['avg_check', 'Средний чек', '₸'],
    ['new_count', 'Количество новых', 'count'],
    ['new_sum', 'Сумма новых', '₸'],
    ['avg_check_new', 'Ср. чек новых', '₸'],
    ['repeat_count', 'Количество повторных', 'count'],
    ['repeat_sum', 'Сумма повторных', '₸'],
  ]
  return seeds.map(([key, label_ru, unit], i) => ({
    key,
    label_ru,
    unit,
    plan_year: 1_000_000 * (i + 1),
    fact_year: 500_000 * (i + 1),
    plan_month: 100_000 * (i + 1),
    fact_month: 80_000 * (i + 1),
    pct_year: 50,
    pct_3y: 17,
  }))
}

describe('TopSalesTableView', () => {
  it('renders all 8 rows with their Russian labels', () => {
    const rows = buildRows()
    const text = textOf({ rows })
    for (const r of rows) {
      expect(text).toContain(r.label_ru)
    }
  })

  it('renders the 6 required column headers', () => {
    const text = textOf({ rows: buildRows() })
    expect(text).toContain('План год')
    expect(text).toContain('Факт год')
    expect(text).toContain('План мес')
    expect(text).toContain('Факт мес')
    expect(text).toContain('% год')
    expect(text).toContain('% 3 года')
  })

  it('renders empty state with onboarding CTA when no rows are provided', () => {
    const tree = render({ rows: [], isEmpty: true })
    const text = textOf({ rows: [], isEmpty: true })
    expect(text).toContain('Нет данных по продажам')
    expect(text).toContain('Загрузить базу клиентов')
    const emptyNode = flatten(tree).find(
      (n) => n.props['data-testid'] === 'top-sales-empty',
    )
    expect(emptyNode).toBeTruthy()
  })

  it('renders skeleton when loading', () => {
    const tree = render({ rows: [], isLoading: true })
    const skeletonNode = flatten(tree).find(
      (n) => n.props['data-testid'] === 'top-sales-skeleton',
    )
    expect(skeletonNode).toBeTruthy()
  })

  it('renders inline error state without throwing', () => {
    const tree = render({ rows: [], isError: true })
    const errorNode = flatten(tree).find(
      (n) => n.props['data-testid'] === 'top-sales-error',
    )
    expect(errorNode).toBeTruthy()
    expect(textOf({ rows: [], isError: true })).toContain(
      'Не удалось загрузить таблицу продаж',
    )
  })
})
