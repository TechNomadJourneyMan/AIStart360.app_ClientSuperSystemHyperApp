/**
 * tests/unit/assistant-mascot/settings-server-write.test.ts
 *
 * writeMascotSettings must treat a silent RLS no-op (UPDATE affects 0 rows,
 * error=null) as a failure — otherwise a dropped write reads back as success
 * and coachmark tours restart forever. See lib/assistant/mascot/settings-server.ts.
 */

import { describe, it, expect } from 'vitest'
import { writeMascotSettings } from '@/lib/assistant/mascot/settings-server'

/**
 * A minimal Supabase double covering exactly the two chains writeMascotSettings
 * uses:
 *   read : .from('profiles').select('preferences').eq('id', userId).maybeSingle()
 *   write: .from('profiles').update({...}).eq('id', userId).select('id') → updateResult
 */
function mockSb(
  updateResult: { data: unknown; error: unknown },
  readData: unknown = { preferences: {} },
) {
  return {
    from() {
      return {
        // read chain
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => ({ data: readData, error: null }),
              }
            },
          }
        },
        // write chain
        update() {
          return {
            eq() {
              return {
                select: async () => updateResult,
              }
            },
          }
        },
      }
    },
  }
}

describe('writeMascotSettings', () => {
  it('throws when the UPDATE affects 0 rows (silent RLS no-op)', async () => {
    const sb = mockSb({ data: [], error: null })
    await expect(
      writeMascotSettings(sb as never, 'user-1', { toursDone: ['/gri'] }),
    ).rejects.toThrow(/0 rows/)
  })

  it('propagates a real Supabase error', async () => {
    const sb = mockSb({ data: null, error: new Error('rls denied') })
    await expect(
      writeMascotSettings(sb as never, 'user-1', { toursDone: ['/gri'] }),
    ).rejects.toThrow(/rls denied/)
  })

  it('returns merged settings when the UPDATE lands', async () => {
    const sb = mockSb({ data: [{ id: 'user-1' }], error: null })
    const res = await writeMascotSettings(sb as never, 'user-1', { toursDone: ['/gri'] })
    expect(res.toursDone).toContain('/gri')
  })

  it('merges the patch over existing stored settings', async () => {
    const sb = mockSb(
      { data: [{ id: 'user-1' }], error: null },
      { preferences: { assistant: { greeted: true, toursDone: ['/dashboard'] } } },
    )
    const res = await writeMascotSettings(sb as never, 'user-1', { toursDone: ['/gri'] })
    expect(res.greeted).toBe(true) // untouched sibling field survives
    expect(res.toursDone).toEqual(['/gri']) // patch replaces (server merge, not union)
  })
})
