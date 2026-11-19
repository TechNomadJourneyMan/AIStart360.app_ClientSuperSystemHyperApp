/**
 * hooks/useCrm.ts — what the screen says and refreshes after a logged touch (review, low):
 *   a touch whose queue update failed (500 queue_not_updated) is said as such, not as «зафиксирован».
 */
import { describe, expect, it } from 'vitest'
import { touchErrorText } from '@/hooks/useCrm'

describe('touchErrorText', () => {
  it('«queue_not_updated»: the server says the touch is recorded but the queue is not', () => {
    const e = Object.assign(new Error('Касание записано, но очередь «Кому звонить» не обновилась.'), { code: 'queue_not_updated' })
    expect(touchErrorText(e)).toBe('Касание записано, но очередь «Кому звонить» не обновилась.')
  })

  it('anything else: the touch was not recorded (no raw error codes on screen)', () => {
    expect(touchErrorText(Object.assign(new Error('db_error'), { code: 'db_error' }))).toBe('Не удалось записать касание')
    expect(touchErrorText(new TypeError('Failed to fetch'))).toBe('Не удалось записать касание')
    expect(touchErrorText(null)).toBe('Не удалось записать касание')
  })
})
