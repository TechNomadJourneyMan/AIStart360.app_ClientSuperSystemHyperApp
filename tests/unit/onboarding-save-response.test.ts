import { describe, expect, it } from 'vitest'
import {
  sheetProjectionWarning,
  surveySaveError,
} from '@/components/onboarding/utils/save-response'

describe('onboarding save response', () => {
  it('accepts only a successful HTTP and API result', () => {
    expect(surveySaveError(true, { ok: true })).toBeNull()
    expect(surveySaveError(false, { ok: true })).toBe(
      'Не удалось сохранить ответы анкеты',
    )
    expect(surveySaveError(true, { ok: false, error: 'database failed' })).toBe(
      'database failed',
    )
  })

  it('keeps the user on the step when canonical Point A sync did not finish', () => {
    expect(
      surveySaveError(true, {
        ok: true,
        data: { point_a_sync: { error: 'rpc unavailable' } },
      }),
    ).toContain('Точка А ещё не обновилась')
  })

  it('reports Sheets lag separately from the authoritative save result', () => {
    const payload = {
      ok: true,
      data: {
        sheet_sync: {
          status: 'skipped',
          reason: 'not_configured',
        },
      },
    }
    expect(surveySaveError(true, payload)).toBeNull()
    expect(sheetProjectionWarning(payload)).toBe('not_configured')
    expect(sheetProjectionWarning({ ok: true })).toBeNull()
  })
})
