import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('canonical Point A user states', () => {
  const component = source(
    'components/dashboard/point-a/CanonicalPointAModel.tsx',
  )

  it('distinguishes automatic, confirmed, conflict, stale and empty values', () => {
    expect(component).toContain('Найдено автоматически')
    expect(component).toContain('Подтверждено')
    expect(component).toContain('Есть конфликт')
    expect(component).toContain('Устарело')
    expect(component).toContain('Нет данных')
    expect(component).toContain('Пробелы в данных')
  })

  it('exposes source navigation, manual correction and field history', () => {
    expect(component).toContain('Открыть источник')
    expect(component).toContain('Изменить вручную')
    expect(component).toContain('/history')
    expect(component).toContain('Последние изменения')
  })

  it('is mounted on every primary Point A and dashboard route', () => {
    for (const path of [
      'app/(dashboard)/point-a/page.tsx',
      'app/(dashboard)/dashboard/page.tsx',
      'app/client/point-a/page.tsx',
    ]) {
      expect(source(path)).toContain('<CanonicalPointAModel />')
    }
  })
})
