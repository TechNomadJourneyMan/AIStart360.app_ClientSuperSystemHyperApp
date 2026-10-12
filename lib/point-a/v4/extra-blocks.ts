/**
 * lib/point-a/v4/extra-blocks.ts — the «Команда» and «Продукт» blocks of
 * Point A v4 (spec 2026-10-12 §2.2). Same check shape as the v1 blocks
 * (lib/point-a-engine.ts PointACheck): `missing` = not answered.
 */
import { namesSomething, present, type PointACheck, type PointAResolvedInputs } from '@/lib/point-a-engine'
import { coerceNumeric } from '@/lib/metrics/source-adapters'

type A = Record<string, unknown>

function num(a: A, key: string): number | null {
  if (!present(a[key])) return null
  const n = coerceNumeric(a[key])
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

function bool(a: A, key: string): boolean | null {
  const v = a[key]
  if (typeof v === 'boolean') return v
  if (v === 'true' || v === 'да') return true
  if (v === 'false' || v === 'нет') return false
  return null
}

export function teamChecks(a: A): PointACheck[] {
  const checks: PointACheck[] = []

  const fits = bool(a, 's4n_structure_matches')
  if (fits === null) checks.push({ id: 'structure_matches', max: 15, earned: 0, missing: 'Не указано, соответствует ли структура задачам' })
  else checks.push(fits
    ? { id: 'structure_matches', max: 15, earned: 15 }
    : { id: 'structure_matches', max: 15, earned: 0, issue: 'Структура команды не соответствует задачам', rec: 'Пересобрать оргструктуру под цели на 12 месяцев' })

  const delegation = num(a, 's4m_delegation_readiness')
  if (delegation === null) checks.push({ id: 'delegation', max: 20, earned: 0, missing: 'Не оценена готовность к делегированию' })
  else {
    const d = Math.max(1, Math.min(10, delegation))
    checks.push({
      id: 'delegation', max: 20, earned: Math.round(((d - 1) / 9) * 20),
      ...(d <= 4 ? { issue: `Готовность делегировать ${d}/10 — собственник держит всё на себе`, rec: 'Составить список задач на делегирование и назначить ответственных' } : {}),
    })
  }

  const hours = num(a, 's4m_hours_on_ops')
  if (hours === null || hours <= 0) checks.push({ id: 'owner_ops_hours', max: 20, earned: 0, missing: 'Не указано, сколько часов в день собственник тратит на операционку' })
  else if (hours <= 4) checks.push({ id: 'owner_ops_hours', max: 20, earned: 20 })
  else if (hours <= 8) checks.push({ id: 'owner_ops_hours', max: 20, earned: 10, issue: `Собственник тратит на операционку ${hours} ч/день` })
  else checks.push({ id: 'owner_ops_hours', max: 20, earned: 0, issue: `Собственник погружён в операционку (${hours} ч/день)`, rec: 'Выделить операционного руководителя' })

  const planning = a.s4m_planning_team_or_solo
  if (!present(planning)) checks.push({ id: 'planning', max: 10, earned: 0, missing: 'Не указано, кто планирует' })
  else checks.push(planning === 'team'
    ? { id: 'planning', max: 10, earned: 10 }
    : { id: 'planning', max: 10, earned: 0, issue: 'Планирование делает один человек', rec: 'Проводить квартальное планирование с руководителями' })

  const staffing = a.s4n_staffing_table
  const rows = Array.isArray(staffing) ? staffing.filter((r) => r && typeof r === 'object') as A[] : []
  if (!rows.length) checks.push({ id: 'staffing', max: 15, earned: 0, missing: 'Штатное расписание не заполнено' })
  else {
    const withHead = rows.filter((r) => namesSomething(r.head)).length
    checks.push(withHead === rows.length
      ? { id: 'staffing', max: 15, earned: 15 }
      : { id: 'staffing', max: 15, earned: Math.round((withHead / rows.length) * 15), issue: 'Не у всех отделов есть руководитель', rec: 'Назначить ответственного за каждый отдел' })
  }

  const multi = bool(a, 's4n_multi_roles')
  if (multi === null) checks.push({ id: 'multi_roles', max: 10, earned: 0, missing: 'Не указано, совмещают ли сотрудники роли' })
  else checks.push(multi
    ? { id: 'multi_roles', max: 10, earned: 0, issue: 'Сотрудники совмещают роли — узкие места и выгорание' }
    : { id: 'multi_roles', max: 10, earned: 10 })

  const size = num(a, 's1_employee_count')
  if (size === null || size <= 0) checks.push({ id: 'team_size', max: 10, earned: 0, missing: 'Не указано количество сотрудников' })
  else checks.push({ id: 'team_size', max: 10, earned: 10 })

  return checks
}

export function productChecks(a: A, resolved: PointAResolvedInputs = {}): PointACheck[] {
  const checks: PointACheck[] = []

  const count = num(a, 's3_product_count')
  if (count === null || count <= 0) checks.push({ id: 'product_line', max: 10, earned: 0, missing: 'Не указано количество продуктов' })
  else checks.push(count >= 2
    ? { id: 'product_line', max: 10, earned: 10 }
    : { id: 'product_line', max: 10, earned: 3, issue: 'Один продукт — высокая зависимость', rec: 'Проработать второй продукт или апсейл' })

  const named = (keys: string[]) => keys.some((k) => namesSomething(a[k]))
  const anyAnswered = (keys: string[]) => keys.some((k) => present(a[k]))
  const namedCheck = (id: string, max: number, keys: string[], missing: string, issue: string, rec?: string): PointACheck =>
    named(keys) ? { id, max, earned: max }
    : anyAnswered(keys) ? { id, max, earned: 0, issue, ...(rec ? { rec } : {}) }
    : { id, max, earned: 0, missing }

  checks.push(namedCheck('locomotive', 10, ['s5n_product_locomotive', 's3_flagship_product'], 'Не указан продукт-локомотив', 'Нет продукта-локомотива', 'Определить продукт, который приводит клиентов'))
  checks.push(namedCheck('entry_product', 10, ['s5n_entry_product'], 'Не указан входной продукт', 'Нет входного продукта', 'Сделать недорогой продукт для первой покупки'))
  checks.push(namedCheck('most_marginal', 10, ['s5n_most_marginal'], 'Не указан самый маржинальный продукт', 'Маржинальность продуктов не известна', 'Посчитать маржу по каждому продукту'))
  checks.push(namedCheck('moat', 15, ['s3n_cannot_copy'], 'Не описано, что конкуренты не могут скопировать', 'Нет защиты от копирования', 'Сформулировать, что отличает продукт и сложно повторить'))

  const nps = typeof resolved.nps === 'number' && Number.isFinite(resolved.nps) ? resolved.nps : num(a, 's7_nps_score')
  if (nps === null) checks.push({ id: 'nps', max: 20, earned: 0, missing: 'NPS не измерен', rec: 'Запустить NPS-опрос клиентов' })
  else if (nps >= 50) checks.push({ id: 'nps', max: 20, earned: 20 })
  else if (nps >= 0) checks.push({ id: 'nps', max: 20, earned: 10, issue: `NPS ${nps} — клиенты довольны умеренно` })
  else checks.push({ id: 'nps', max: 20, earned: 0, issue: `NPS ${nps} — недовольных больше, чем сторонников`, rec: 'Разобрать причины недовольства с 10 клиентами' })

  checks.push(namedCheck('upsell', 10, ['s5n_upsell_crosssell'], 'Не описаны апсейл и кросс-сейл', 'Нет апсейла и кросс-сейла', 'Добавить допродажу к основному продукту'))
  checks.push(namedCheck('measurable_results', 15, ['s3n_measurable_results'], 'Не описан измеримый результат для клиента', 'Результат для клиента не измерим', 'Сформулировать результат клиента в цифрах'))
  return checks
}
