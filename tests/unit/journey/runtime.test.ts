import { describe, expect, it } from 'vitest'
import { createEmptyWorkspace } from '@/components/journey/model'
import {
  allowsJourneyLocalDemo,
  selectJourneyInitialState,
} from '@/components/journey/runtime'

describe('Journey runtime mode', () => {
  it('keeps canonical production fail-closed by default', () => {
    expect(allowsJourneyLocalDemo('production', undefined)).toBe(false)
  })

  it('allows an explicitly configured public demo deployment', () => {
    expect(allowsJourneyLocalDemo('production', '1')).toBe(true)
  })

  it('keeps local development fallback available', () => {
    expect(allowsJourneyLocalDemo('development', undefined)).toBe(true)
  })

  it('preserves cached demo content but trusts current server mode labels', () => {
    const local = {
      ...createEmptyWorkspace('workspace-demo'),
      businessDescription: 'Honor продаёт одежду для активного отдыха',
      provider: { mode: 'live' as const, label: 'Старая метка AI' },
    }
    const remote = {
      ...createEmptyWorkspace('workspace-demo'),
      provider: { mode: 'demo' as const, label: 'Демо-режим' },
      persistence: {
        mode: 'local' as const,
        label: 'Сохранение в браузере',
      },
    }

    const selected = selectJourneyInitialState(local, remote, true)

    expect(selected.businessDescription).toBe(local.businessDescription)
    expect(selected.provider).toEqual(remote.provider)
    expect(selected.persistence).toEqual(remote.persistence)
  })
})
