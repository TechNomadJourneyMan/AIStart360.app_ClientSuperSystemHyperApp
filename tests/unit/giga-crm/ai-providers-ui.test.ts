/**
 * GIGA «Провайдеры и ключи»: the pure view model (form checks, route options,
 * budget diff, labels) and the stateless views rendered with react-dom/server —
 * masked keys only, honest empty states, no mutation controls for a read-only
 * role, a password-type key input that is never prefilled.
 */
import { describe, expect, it } from 'vitest'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  buildBudgetsPayload,
  buildModelPayload,
  buildProviderPayload,
  budgetsDraftFrom,
  modelOptionsFor,
  parseHeaders,
  parseMoney,
  providerDraftFrom,
  providerFieldOfError,
  routeProblem,
  secretError,
  spendKeyLabel,
  verifyMeta,
} from '@/components/giga-panel/ai-providers/model'
import { BudgetsSummary, ProviderCard, RoutingTable, SpendView, VerifyOutcome } from '@/components/giga-panel/ai-providers/views'
import { CredentialDialog } from '@/components/giga-panel/ai-providers/dialogs'
import type { BudgetsDto, CredentialDto, ModelDto, ProviderDto, RouteDto } from '@/components/giga-panel/ai-providers/types'

const render = (el: ReactElement) => renderToStaticMarkup(el)
const T = '2026-10-01T10:00:00.000Z'

function cred(over: Partial<CredentialDto> = {}): CredentialDto {
  return {
    id: 'c1', provider_id: 'p-alem', label: 'Основной', secret_hint: 'abcd', masked: '••••abcd', enabled: true,
    last_verified_at: null, last_verify_ok: null, last_verify_error: null, created_by: 'staff', created_at: T, rotated_at: null, updated_at: T,
    ...over,
  }
}

function modelRow(over: Partial<ModelDto> = {}): ModelDto {
  return {
    id: 'm1', provider_id: 'p-alem', credential_id: null, model_id: 'alemllm', capability: 'chat', label: 'Alem LLM',
    price_in_per_mtok: 0.5, price_out_per_mtok: 1.5, enabled: true, created_at: T, updated_at: T,
    ...over,
  }
}

function provider(over: Partial<ProviderDto> = {}): ProviderDto {
  return {
    id: 'p-alem', key: 'alem', name: 'Alem Plus', kind: 'openai_compatible', base_url: 'https://llm.alem.ai/v1',
    chat_path: '/chat/completions', embeddings_path: '/embeddings', rerank_path: null, ocr_mode: null, extra_headers: { 'X-Title': 'AIStart360' },
    supports_response_format: true, enabled: true, daily_budget_usd: 10, privacy_note: 'данные не используются для обучения',
    created_by: 'staff', created_at: T, updated_at: T,
    credentials: [cred()],
    models: [modelRow()],
    routes: [{ capability: 'chat', tier: 'standard', model_id: 'm1', model: 'alemllm' }],
    ...over,
  }
}

const openrouter = provider({
  id: 'p-or', key: 'openrouter', name: 'OpenRouter', kind: 'openrouter', base_url: 'https://openrouter.ai/api/v1',
  credentials: [], models: [modelRow({ id: 'm2', provider_id: 'p-or', model_id: 'openai/text-embedding-3-small', capability: 'embeddings', label: null })],
  routes: [], daily_budget_usd: null, privacy_note: null, extra_headers: {},
})

const route = (over: Partial<RouteDto> = {}): RouteDto => ({
  capability: 'chat', tier: 'standard', modelRowId: 'm1', modelId: 'alemllm', providerKey: 'alem', providerEnabled: true, modelEnabled: true,
  updatedBy: 'staff', updatedAt: T, ...over,
})

const budgets: BudgetsDto = {
  platform: { dailyUsd: 20, source: 'db', configured: 20 },
  company: { dailyUsd: 5, source: 'env', configured: null },
  providers: [
    { key: 'openrouter', name: 'OpenRouter', dailyBudgetUsd: null, spentTodayUsd: 0.4 },
    { key: 'alem', name: 'Alem Plus', dailyBudgetUsd: 10, spentTodayUsd: 9 },
  ],
  updatedBy: 'staff-owner', updatedAt: T,
}

// ─── View model ──────────────────────────────────────────────────────────────

describe('provider form', () => {
  it('a valid draft becomes the create body; key lowercased, empty values → null, headers parsed', () => {
    const d = { ...providerDraftFrom(null), key: 'Alem2', name: ' Alem 2 ', baseUrl: 'https://llm.alem.ai/v1', headersText: 'X-Title: AIStart360\n\n', dailyBudget: '2,5' }
    const r = buildProviderPayload(d, 'create')
    expect(r.errors).toEqual({})
    expect(r.payload).toMatchObject({ key: 'alem2', name: 'Alem 2', rerankPath: null, ocrMode: null, extraHeaders: { 'X-Title': 'AIStart360' }, dailyBudgetUsd: 2.5, privacyNote: null })
  })

  it('edit body has no key; invalid fields get Russian messages', () => {
    expect(buildProviderPayload(providerDraftFrom(provider()), 'edit').payload).not.toHaveProperty('key')
    const r = buildProviderPayload({ ...providerDraftFrom(null), key: 'A', name: '', baseUrl: 'llm.alem.ai', chatPath: 'chat', dailyBudget: '-1', kind: 'openrouter' }, 'create')
    expect(r.payload).toBeNull()
    expect(Object.keys(r.errors).sort()).toEqual(['baseUrl', 'chatPath', 'dailyBudget', 'key', 'kind', 'name'])
    expect(r.errors.kind).toContain('openrouter')
  })

  it('secret-bearing headers are refused (keys belong in «Ключи»)', () => {
    expect(parseHeaders('Authorization: Bearer sk-1')).toMatchObject({ ok: false, error: expect.stringContaining('Authorization') })
    expect(parseHeaders('x-api-key: 1')).toMatchObject({ ok: false })
    expect(parseHeaders('no colon')).toMatchObject({ ok: false, error: expect.stringContaining('Строка 1') })
    expect(parseHeaders('HTTP-Referer: https://aistart360.app')).toEqual({ ok: true, value: { 'HTTP-Referer': 'https://aistart360.app' } })
  })

  it('service errors are attached to the right field', () => {
    expect(providerFieldOfError('baseUrl: String must contain at least 1 character(s)')).toBe('baseUrl')
    expect(providerFieldOfError('Нужен https-адрес')).toBe('baseUrl')
    expect(providerFieldOfError('extraHeaders.Cookie: этот заголовок задавать нельзя')).toBe('headersText')
    expect(providerFieldOfError('тип openrouter зарезервирован за провайдером с ключом openrouter')).toBe('kind')
    expect(providerFieldOfError('провайдер с ключом alem уже есть')).toBeNull()
  })

  it('money: empty → null, comma decimal, negatives refused', () => {
    expect(parseMoney('')).toEqual({ ok: true, value: null })
    expect(parseMoney('1,25')).toEqual({ ok: true, value: 1.25 })
    expect(parseMoney('-1')).toMatchObject({ ok: false })
    expect(parseMoney('abc')).toMatchObject({ ok: false })
  })
})

describe('keys and models', () => {
  it('secret checks mirror the server', () => {
    expect(secretError('')).toBe('Введите ключ')
    expect(secretError('short')).toBe('Ключ слишком короткий')
    expect(secretError('sk-abc def-123')).toContain('пробелы')
    expect(secretError('sk-alem-0123456789')).toBeNull()
  })

  it('verify status', () => {
    expect(verifyMeta(cred())).toMatchObject({ label: 'не проверен', tone: 'neutral' })
    expect(verifyMeta(cred({ last_verified_at: T, last_verify_ok: true }))).toMatchObject({ label: 'проверен', tone: 'green' })
    expect(verifyMeta(cred({ last_verified_at: T, last_verify_ok: false, last_verify_error: 'HTTP 401' }))).toMatchObject({ tone: 'red', hint: 'HTTP 401' })
  })

  it('model body; rerank / OCR need the provider to support them', () => {
    const p = provider()
    expect(buildModelPayload({ modelId: 'alemllm', capability: 'chat', label: '', credentialId: '', priceIn: '0.5', priceOut: '', enabled: true }, p).payload)
      .toEqual({ providerId: 'p-alem', modelId: 'alemllm', capability: 'chat', credentialId: null, label: null, priceInPerMtok: 0.5, priceOutPerMtok: null, enabled: true })
    expect(buildModelPayload({ modelId: 'r', capability: 'rerank', label: '', credentialId: '', priceIn: '', priceOut: '', enabled: true }, p).errors.capability).toContain('rerank')
    expect(buildModelPayload({ modelId: 'bad id', capability: 'chat', label: '', credentialId: '', priceIn: '', priceOut: '', enabled: true }, p).errors.modelId).toBeTruthy()
  })
})

describe('routing', () => {
  it('options per capability across providers; disabled models are marked', () => {
    const ps = [provider({ models: [modelRow(), modelRow({ id: 'm3', model_id: 'alem-off', enabled: false })] }), openrouter]
    expect(modelOptionsFor(ps, 'chat').map((o) => [o.value, o.disabled])).toEqual([['m1', false], ['m3', true]])
    expect(modelOptionsFor(ps, 'embeddings').map((o) => o.label)).toEqual(['OpenRouter · openai/text-embedding-3-small'])
    expect(modelOptionsFor(ps, 'ocr')).toEqual([])
  })

  it('explains why a configured route is not used', () => {
    expect(routeProblem(null, [provider()])).toBeNull()
    expect(routeProblem(route({ providerEnabled: false }), [provider()])).toContain('провайдер выключен')
    expect(routeProblem(route({ modelEnabled: false }), [provider()])).toContain('модель выключена')
    expect(routeProblem(route(), [provider({ credentials: [cred({ enabled: false })] })])).toContain('нет включённого ключа')
    expect(routeProblem(route(), [provider()])).toBeNull()
  })
})

describe('budgets diff', () => {
  it('only changed values are sent; empty clears to env / no limit', () => {
    const d = budgetsDraftFrom(budgets)
    expect(d).toEqual({ platform: '20', company: '', providers: { openrouter: '', alem: '10' } })
    expect(buildBudgetsPayload(d, budgets)).toMatchObject({ payload: null, changes: [] })
    const r = buildBudgetsPayload({ ...d, platform: '', providers: { ...d.providers, openrouter: '3' } }, budgets)
    expect(r.payload).toEqual({ platformDailyUsd: null, providers: { openrouter: 3 } })
    expect(r.changes).toEqual([
      { label: 'Платформа в сутки', from: '$20.00', to: 'из env' },
      { label: 'OpenRouter в сутки', from: 'без лимита', to: '$3.00' },
    ])
    expect(buildBudgetsPayload({ ...d, company: '-5' }, budgets).errors).toEqual({ company: 'Не может быть отрицательным' })
  })
})

describe('spend labels', () => {
  it('null keys and sources are explained', () => {
    expect(spendKeyLabel('provider', null)).toContain('до миграции 094')
    expect(spendKeyLabel('provider', 'alem', [provider()])).toBe('Alem Plus')
    expect(spendKeyLabel('feature', 'agent:monitoring')).toBe('Агент: monitoring')
    expect(spendKeyLabel('feature', 'feature:gri_analysis')).toBe('Функция: gri_analysis')
    expect(spendKeyLabel('company', null)).toContain('без компании')
  })
})

// ─── Views ───────────────────────────────────────────────────────────────────

describe('ProviderCard', () => {
  it('read-only: provider, masked key, models with prices and routes; no mutation controls', () => {
    const html = render(createElement(ProviderCard, { provider: provider(), spentTodayUsd: 1.5, canManage: false, encryptionConfigured: true }))
    for (const s of ['Alem Plus', 'alem', 'OpenAI-совместимый', 'https://llm.alem.ai/v1', '••••abcd', 'Основной', 'alemllm', '$0.5', '$1.5', 'Чат · standard', 'X-Title', 'не проверен', '$1.50', '$10.00']) {
      expect(html, s).toContain(s)
    }
    for (const s of ['Добавить ключ', 'Проверить', 'Сменить ключ', 'Добавить модель', 'Изменить', 'role="switch"']) expect(html, s).not.toContain(s)
    expect(html).not.toContain('AIStart360<') // header values are not shown, only names
  })

  it('manage: key and model controls; without the encryption key adding / rotating is disabled', () => {
    const on = render(createElement(ProviderCard, { provider: provider(), spentTodayUsd: 0, canManage: true, encryptionConfigured: true }))
    for (const s of ['Добавить ключ', 'Проверить', 'Сменить ключ', 'Добавить модель', 'Изменить', 'aria-label="Удалить ключ Основной"', 'aria-label="Удалить модель alemllm"']) expect(on, s).toContain(s)
    const off = render(createElement(ProviderCard, { provider: provider(), spentTodayUsd: 0, canManage: true, encryptionConfigured: false }))
    expect(off).toMatch(/<button[^>]*disabled=""[^>]*title="На сервере не задан SECRETS_ENCRYPTION_KEY — ключ сохранить нельзя"/)
  })

  it('honest states: no keys (env fallback named), no models, failed verification', () => {
    const html = render(createElement(ProviderCard, { provider: { ...openrouter, models: [] }, spentTodayUsd: null, canManage: false, encryptionConfigured: true }))
    expect(html).toContain('Ключей нет. Используется OPENROUTER_API_KEY из env')
    expect(html).toContain('Моделей нет')
    expect(html).toContain('нет включённых ключей')
    expect(html).toContain('Расход за сегодня недоступен')
    expect(html).toContain('Ни один маршрут не направлен')
    const failed = render(createElement(ProviderCard, {
      provider: provider({ credentials: [cred({ last_verified_at: T, last_verify_ok: false, last_verify_error: 'HTTP 401 (ключ не принят провайдером)' })] }),
      spentTodayUsd: 0, canManage: false, encryptionConfigured: true,
    }))
    expect(failed).toContain('ошибка проверки')
    expect(failed).toContain('HTTP 401 (ключ не принят провайдером)')
  })

  it('verify outcome', () => {
    const ok = render(createElement(VerifyOutcome, { result: { ok: true, error: null, checkedWith: 'chat', model: 'alemllm', credential: cred() } }))
    expect(ok).toContain('Ключ работает')
    expect(ok).toContain('alemllm')
    const bad = render(createElement(VerifyOutcome, { result: { ok: false, error: 'HTTP 404 (неверный адрес/путь или модель)', checkedWith: 'models', model: null, credential: cred() } }))
    expect(bad).toContain('Проверка не прошла')
    expect(bad).toContain('GET /models')
  })
})

describe('RoutingTable', () => {
  it('manage: a select per slot with the default (env) option; rerank / OCR fallback explained', () => {
    const html = render(createElement(RoutingTable, { providers: [provider(), openrouter], routes: [route()], canManage: true }))
    expect(html.match(/<select/g)).toHaveLength(6)
    expect(html).toContain('по умолчанию (OpenRouter из env)')
    expect(html).toContain('Alem Plus · Alem LLM (alemllm)')
    expect(html).toContain('встроенного варианта нет')
    expect(html).toContain('Нет моделей с возможностью «OCR»')
  })

  it('read-only: text instead of selects, no save buttons', () => {
    const html = render(createElement(RoutingTable, { providers: [provider()], routes: [route()], canManage: false }))
    expect(html).not.toContain('<select')
    expect(html).not.toContain('Сохранить')
    expect(html).toContain('alem · alemllm')
  })
})

describe('BudgetsSummary and SpendView', () => {
  it('value + source + today; read-only hint instead of the edit button', () => {
    const html = render(createElement(BudgetsSummary, { budgets, canManage: false }))
    expect(html).toContain('источник: БД')
    expect(html).toContain('источник: env')
    expect(html).toContain('AGENT_COMPANY_DAILY_BUDGET_USD')
    expect(html).toContain('$9.40') // providers' spend today
    expect(html).toContain('aria-valuenow="90"') // Alem: 9 of 10
    expect(html).not.toContain('Изменить бюджеты')
    expect(html).toContain('Изменять бюджеты может только Super Admin')
    expect(render(createElement(BudgetsSummary, { budgets, canManage: true }))).toContain('Изменить бюджеты')
  })

  it('spend: empty state and grouped rows', () => {
    expect(render(createElement(SpendView, { groupBy: 'provider', rows: [], totalUsd: 0, providers: [] }))).toContain('Расходов за период нет')
    const html = render(createElement(SpendView, {
      groupBy: 'provider',
      rows: [{ key: 'alem', costUsd: 3, calls: 12, tokensIn: 1000, tokensOut: 500 }, { key: null, costUsd: 1, calls: 3, tokensIn: 10, tokensOut: 5 }],
      totalUsd: 4,
      providers: [provider()],
    }))
    expect(html).toContain('Alem Plus')
    expect(html).toContain('75%')
    expect(html).toContain('до миграции 094')
  })
})

describe('CredentialDialog', () => {
  it('password input, never prefilled; storage warning; no secret anywhere', () => {
    const html = render(createElement(CredentialDialog, { open: true, provider: { id: 'p-alem', name: 'Alem Plus' }, credential: null, onClose: () => {}, onDone: () => {} }))
    const input = html.match(/<input[^>]*type="password"[^>]*>/)?.[0] ?? ''
    expect(input).toMatch(/autocomplete="new-password"/i)
    expect(input).toMatch(/value=""/)
    expect(html).toContain('зашифрованном виде')
    expect(html).toContain('••••abcd')
  })

  it('rotate shows only the current mask', () => {
    const html = render(createElement(CredentialDialog, { open: true, provider: { id: 'p-alem', name: 'Alem Plus' }, credential: cred({ masked: '••••wxyz' }), onClose: () => {}, onDone: () => {} }))
    expect(html).toContain('Сменить ключ «Основной»')
    expect(html).toContain('••••wxyz')
    expect(html).toMatch(/<input[^>]*type="password"[^>]*value=""/)
  })
})
