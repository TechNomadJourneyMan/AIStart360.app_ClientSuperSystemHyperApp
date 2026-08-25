import { describe, expect, it, vi } from 'vitest'
import {
  expectedMyHonorTemplateContractHash,
  verifyMyHonorReactivationTemplate,
} from '@/lib/integrations/myhonor/reactivation/template-preflight'
import {
  MYHONOR_TEMPLATE_BODY_CONTRACT_RU,
  renderMyHonorTemplateBody,
} from '@/lib/integrations/myhonor/reactivation/templates'

const env = {
  WHATSAPP_TOKEN: 'meta-secret-token',
  WHATSAPP_BUSINESS_ACCOUNT_ID: '123456789012345',
  META_GRAPH_API_VERSION: 'v25.0',
  META_GRAPH_TIMEOUT_MS: '1000',
}

function response(template: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(status >= 400
    ? template
    : { data: [template] }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function approvedTemplate(overrides: Record<string, unknown> = {}) {
  return {
    id: '987654321',
    name: 'myhonor_old_lead_v1',
    language: 'ru',
    status: 'APPROVED',
    category: 'MARKETING',
    components: [{
      type: 'BODY',
      text: MYHONOR_TEMPLATE_BODY_CONTRACT_RU.old_lead,
    }],
    ...overrides,
  }
}

describe('MyHonor Meta template launch preflight', () => {
  it('renders the complete reviewed BODY for human preview without placeholders', () => {
    const rendered = renderMyHonorTemplateBody('old_lead', 'ru', [
      'Куртка HONOR',
      '62 900 ₸',
      'https://myhonor.shop/product/kurtka-honor',
    ])

    expect(rendered).toBe(
      'Здравствуйте! Для вас есть актуальный вариант экипировки: Куртка HONOR — 62 900 ₸. Подробнее: https://myhonor.shop/product/kurtka-honor. Если подборки не нужны, ответьте СТОП.',
    )
    expect(rendered).not.toMatch(/{{|}}/)
    expect(renderMyHonorTemplateBody('old_lead', 'ru', ['только один'])).toBeNull()
    expect(renderMyHonorTemplateBody('old_lead', 'ru', [
      '{{1}}',
      '62 900 ₸',
      'https://myhonor.shop/product/kurtka-honor',
    ])).toBeNull()
  })

  it('proves the exact approved marketing template and positional contract', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(approvedTemplate()))
    const result = await verifyMyHonorReactivationTemplate({
      segment: 'old_lead',
      templateName: 'myhonor_old_lead_v1',
      languageCode: 'ru',
      env,
      fetchImpl,
    })

    expect(result).toMatchObject({
      ok: true,
      templateId: '987654321',
      status: 'APPROVED',
      category: 'MARKETING',
      bodyParameterCount: 3,
      contractHash: expectedMyHonorTemplateContractHash({
        segment: 'old_lead',
        templateName: 'myhonor_old_lead_v1',
        languageCode: 'ru',
      }),
    })
    const [requestUrl, init] = fetchImpl.mock.calls[0]
    expect(String(requestUrl)).toContain('/123456789012345/message_templates')
    expect(String(requestUrl)).toContain('name=myhonor_old_lead_v1')
    expect(String(requestUrl)).not.toContain('meta-secret-token')
    expect(init.headers.Authorization).toBe('Bearer meta-secret-token')
  })

  it('derives the approval hash only from the complete canonical visible contract', async () => {
    const first = await verifyMyHonorReactivationTemplate({
      segment: 'old_lead',
      templateName: 'myhonor_old_lead_v1',
      languageCode: 'ru',
      env,
      fetchImpl: vi.fn().mockResolvedValue(response(approvedTemplate({ id: 'revision-1' }))),
    })
    const second = await verifyMyHonorReactivationTemplate({
      segment: 'old_lead',
      templateName: 'myhonor_old_lead_v1',
      languageCode: 'ru',
      env,
      fetchImpl: vi.fn().mockResolvedValue(response(approvedTemplate({ id: 'revision-2' }))),
    })

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(first.ok && second.ok ? first.contractHash : null).toBe(
      first.ok && second.ok ? second.contractHash : null,
    )
  })

  it('rejects provider templates that are not approved marketing content', async () => {
    const pending = await verifyMyHonorReactivationTemplate({
      segment: 'old_lead',
      templateName: 'myhonor_old_lead_v1',
      languageCode: 'ru',
      env,
      fetchImpl: vi.fn().mockResolvedValue(response(approvedTemplate({
        status: 'PENDING',
      }))),
    })
    expect(pending).toMatchObject({ ok: false, code: 'template_not_approved' })

    const utility = await verifyMyHonorReactivationTemplate({
      segment: 'old_lead',
      templateName: 'myhonor_old_lead_v1',
      languageCode: 'ru',
      env,
      fetchImpl: vi.fn().mockResolvedValue(response(approvedTemplate({
        category: 'UTILITY',
      }))),
    })
    expect(utility).toMatchObject({ ok: false, code: 'template_wrong_category' })
  })

  it('rejects missing, named or non-body variables and requires opt-out copy', async () => {
    const wrongBody = await verifyMyHonorReactivationTemplate({
      segment: 'old_lead',
      templateName: 'myhonor_old_lead_v1',
      languageCode: 'ru',
      env,
      fetchImpl: vi.fn().mockResolvedValue(response(approvedTemplate({
        components: [{ type: 'BODY', text: '{{1}} — {{product}}. СТОП.' }],
      }))),
    })
    expect(wrongBody).toMatchObject({ ok: false, code: 'template_contract_mismatch' })

    const dynamicButton = await verifyMyHonorReactivationTemplate({
      segment: 'old_lead',
      templateName: 'myhonor_old_lead_v1',
      languageCode: 'ru',
      env,
      fetchImpl: vi.fn().mockResolvedValue(response(approvedTemplate({
        components: [
          approvedTemplate().components[0],
          { type: 'BUTTONS', buttons: [{ type: 'URL', url: 'https://myhonor.shop/{{1}}' }] },
        ],
      }))),
    })
    expect(dynamicButton).toMatchObject({
      ok: false,
      code: 'template_contract_mismatch',
    })

    const missingOptOut = await verifyMyHonorReactivationTemplate({
      segment: 'old_lead',
      templateName: 'myhonor_old_lead_v1',
      languageCode: 'ru',
      env,
      fetchImpl: vi.fn().mockResolvedValue(response(approvedTemplate({
        components: [{ type: 'BODY', text: '{{1}}, товар {{2}}: {{3}}.' }],
      }))),
    })
    expect(missingOptOut).toMatchObject({
      ok: false,
      code: 'template_opt_out_missing',
    })
  })

  it('rejects every visible non-BODY component even when it has no variables', async () => {
    const visibleComponents = [
      { type: 'HEADER', format: 'TEXT', text: 'HONOR Club' },
      { type: 'FOOTER', text: 'Условия на сайте' },
      { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Открыть' }] },
    ]

    for (const extra of visibleComponents) {
      const result = await verifyMyHonorReactivationTemplate({
        segment: 'old_lead',
        templateName: 'myhonor_old_lead_v1',
        languageCode: 'ru',
        env,
        fetchImpl: vi.fn().mockResolvedValue(response(approvedTemplate({
          components: [approvedTemplate().components[0], extra],
        }))),
      })
      expect(result).toMatchObject({
        ok: false,
        code: 'template_contract_mismatch',
      })
    }
  })

  it('accepts only the neutral club CTA copy with no unverified product claim', async () => {
    expect(MYHONOR_TEMPLATE_BODY_CONTRACT_RU.club_interest).toBe(
      'Посмотреть каталог HONOR: {{1}}. Открыть чат HONOR Club: {{2}}. Если сообщения клуба не нужны, ответьте СТОП.',
    )
    expect(MYHONOR_TEMPLATE_BODY_CONTRACT_RU.club_interest).not.toMatch(
      /новинк|доступн|в наличии/iu,
    )

    const result = await verifyMyHonorReactivationTemplate({
      segment: 'club_interest',
      templateName: 'myhonor_club_v1',
      languageCode: 'ru',
      env,
      fetchImpl: vi.fn().mockResolvedValue(response(approvedTemplate({
        name: 'myhonor_club_v1',
        components: [{
          type: 'BODY',
          text: MYHONOR_TEMPLATE_BODY_CONTRACT_RU.club_interest,
        }],
      }))),
    })
    expect(result).toMatchObject({ ok: true, bodyParameterCount: 2 })
  })

  it('rejects approved copy that keeps placeholders but adds an unverified claim', async () => {
    const result = await verifyMyHonorReactivationTemplate({
      segment: 'old_lead',
      templateName: 'myhonor_old_lead_v1',
      languageCode: 'ru',
      env,
      fetchImpl: vi.fn().mockResolvedValue(response(approvedTemplate({
        components: [{
          type: 'BODY',
          text: 'Только сегодня скидка 50%: {{1}} — {{2}}. {{3}}. Ответьте СТОП.',
        }],
      }))),
    })
    expect(result).toMatchObject({ ok: false, code: 'template_copy_mismatch' })
  })

  it('fails closed and redacts the provider token on a network error', async () => {
    const result = await verifyMyHonorReactivationTemplate({
      segment: 'old_lead',
      templateName: 'myhonor_old_lead_v1',
      languageCode: 'ru',
      env,
      fetchImpl: vi.fn().mockRejectedValue(
        new Error('socket failed for Bearer meta-secret-token'),
      ),
    })
    expect(result).toMatchObject({
      ok: false,
      code: 'provider_unavailable',
      retryable: true,
    })
    expect(result.ok ? '' : result.message).not.toContain('meta-secret-token')
  })
})
