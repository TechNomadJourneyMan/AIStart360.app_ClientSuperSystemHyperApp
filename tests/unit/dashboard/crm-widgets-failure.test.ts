/**
 * #75: the staff dashboard must not turn a failed CRM read into "no requests"
 * (empty list, 0 pending). Server page with ~20 dependencies, so this checks
 * the source contract: no silent `.catch(() => [])` on the CRM reads, and a
 * failure renders an alert instead of <CrmActivity>.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const src = readFileSync('app/(dashboard)/dashboard/page.tsx', 'utf8')

describe('dashboard CRM widgets', () => {
  it('does not swallow CRM read errors into empty lists', () => {
    expect(src).not.toMatch(/adminRequest\.findMany\([\s\S]*?\}\)\.catch\(\(\) => \[\]\)/)
    expect(src).not.toMatch(/client\.findMany\([\s\S]*?\}\)\.catch\(\(\) => \[\]\)/)
    expect(src).toMatch(/console\.error\(`\[Dashboard\] CRM \$\{what\} read failed:`/)
  })

  it('renders a load-failed alert instead of the CRM widget when a read failed', () => {
    expect(src).toContain('showCrmWidgets && crmFailed && (')
    expect(src).toContain('showCrmWidgets && !crmFailed && (')
    expect(src).toContain('Не удалось загрузить заявки и клиентов CRM')
  })
})
