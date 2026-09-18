/**
 * metadataBase считается на этапе сборки: пустая или некорректная переменная
 * окружения не должна ронять сборку (падение Vercel на /_not-found,
 * «TypeError: Invalid URL, input: ''»).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const KEYS = ['AUTH_URL', 'NEXT_PUBLIC_APP_URL'] as const
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]])) as Record<string, string | undefined>

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k] as string
  }
})

beforeEach(() => {
  // layout вычисляет metadataBase при импорте — модуль нужен «свежий».
  vi.resetModules()
})

async function metadataBase(): Promise<URL> {
  const mod = await import('@/app/layout')
  const base = (mod.metadata as { metadataBase?: URL | null }).metadataBase
  expect(base).toBeInstanceOf(URL)
  return base as URL
}

describe('metadataBase корневого layout', () => {
  it('переживает пустую AUTH_URL', async () => {
    process.env.AUTH_URL = ''
    process.env.NEXT_PUBLIC_APP_URL = ''
    await expect(metadataBase()).resolves.toBeInstanceOf(URL)
  })

  it('переживает мусор вместо адреса', async () => {
    process.env.AUTH_URL = 'не-адрес'
    await expect(metadataBase()).resolves.toBeInstanceOf(URL)
  })
})
