import { describe, it, expect } from 'vitest'
import { buildTelegramMessage, escapeTelegramHtml } from '@/lib/notifications'

describe('Telegram HTML escaping', () => {
  it('escapes &, < and >', () => {
    expect(escapeTelegramHtml('ТОО <Альфа> & Ко')).toBe('ТОО &lt;Альфа&gt; &amp; Ко')
  })

  it('survey_completed: user values cannot inject markup, the bold title stays', () => {
    const html = buildTelegramMessage({
      type: 'survey_completed',
      userId: 'u-1',
      data: { userName: 'QA', company: 'ТОО <b>Альфа</b>', contact: '<a href="https://evil">клик</a>', completedSteps: 12, totalSteps: 12 },
    })
    expect(html.startsWith('<b>Анкета завершена</b>')).toBe(true)
    expect(html).toContain('ТОО &lt;b&gt;Альфа&lt;/b&gt;')
    expect(html).not.toContain('<a href')
  })
})
