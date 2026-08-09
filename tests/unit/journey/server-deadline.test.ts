import { describe, expect, it } from 'vitest'
import { withJourneyDeadline } from '@/lib/journey/http'

describe('Journey server deadline', () => {
  it('maps a stalled dependency to the persistence-unavailable error', async () => {
    await expect(withJourneyDeadline(
      () => new Promise<never>(() => {}),
      5,
    )).rejects.toMatchObject({
      name: 'JourneyPersistenceUnavailableError',
    })
  })

  it('returns a result before the deadline', async () => {
    await expect(withJourneyDeadline(
      () => Promise.resolve('ready'),
      100,
    )).resolves.toBe('ready')
  })
})
