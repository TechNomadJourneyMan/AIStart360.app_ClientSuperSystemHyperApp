/**
 * R4 B3 (staging walk): rejecting a request for an invitation sends nothing — the person has no
 * account. The reason field must not promise «будет отправлена пользователю» there.
 */
import { describe, expect, it } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { REJECT_REASON_STAFF_ONLY, REJECT_REASON_TO_USER, RejectModal } from '@/components/giga-panel/RejectModal'

const noop = () => {}
const render = (extra: Partial<React.ComponentProps<typeof RejectModal>> = {}) =>
  renderToStaticMarkup(React.createElement(RejectModal, { isOpen: true, requestId: 'r1', userName: 'Тест', onConfirm: noop, onClose: noop, ...extra }))

describe('RejectModal — who reads the reason', () => {
  it('by default the reason goes to the user (registrations, paid access)', () => {
    expect(render()).toContain(REJECT_REASON_TO_USER)
  })

  it('a request for an invitation: the reason stays with the team, nothing is promised to be sent', () => {
    const out = render({ reasonHint: REJECT_REASON_STAFF_ONLY })
    expect(out).toContain('ничего не отправляется')
    expect(out).not.toContain('будет отправлена пользователю')
  })
})
