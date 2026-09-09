import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('business vertical onboarding contracts', () => {
  it('does not treat the registration-created company row as completed onboarding', () => {
    const welcome = source('app/client/welcome/page.tsx')

    expect(welcome).toContain(".from('profiles')")
    expect(welcome).not.toContain(".from('companies')")
    expect(welcome).toContain('persistSelectedVertical(vertical)')
  })

  it('does not clear the e-commerce draft when final survey persistence fails', () => {
    const ecommerce = source('app/client/onboarding-ecommerce/page.tsx')

    expect(ecommerce).toContain('if (!response.ok)')
    expect(ecommerce).toContain('if (final) throw error')
    expect(ecommerce.indexOf('await persistRemote(true)')).toBeLessThan(
      ecommerce.indexOf('sessionStorage.removeItem(STORAGE_KEY)'),
    )
  })

  it('persists the specialized type on both direct questionnaires', () => {
    const ecommerce = source('app/client/onboarding-ecommerce/page.tsx')
    const medical = source('app/client/onboarding-medical/page.tsx')

    expect(ecommerce).toContain("persistSelectedVertical('ecommerce')")
    expect(medical).toContain("persistSelectedVertical('medical')")
  })

  it('starts a fresh server layout after selection so navigation cannot stay stale', () => {
    const welcome = source('app/client/welcome/page.tsx')
    const ecommerce = source('app/client/onboarding-ecommerce/page.tsx')
    const medical = source('app/client/onboarding-medical/page.tsx')

    expect(welcome).toContain('window.location.replace(resultHref)')
    expect(ecommerce).toContain('window.location.replace(RESULT_PATH)')
    expect(medical).toContain('window.location.replace(RESULT_PATH)')
    expect(ecommerce).toMatch(/<a\s+href=\{RESULT_PATH\}/)
    expect(medical).toMatch(/<a\s+href=\{RESULT_PATH\}/)
  })
})
