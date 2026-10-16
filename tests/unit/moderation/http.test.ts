/**
 * Помощники фильтра мата для роутов, клиента и AI-чатов.
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  answersProfanityResponse, flattenText, noProfanity, PROFANITY_MESSAGE, profaneField, profanityResponse, textOf,
} from '@/lib/moderation/http'
import { apiErrorMessage, profanityRejection } from '@/lib/moderation/client'
import { maskUserQuestion, PROFANITY_CHAT_NOTE, safeAnswer } from '@/lib/moderation/chat'

const BAD = 'Это полная хуйня'

describe('profanityResponse', () => {
  it('null для чистых полей; нестроковые значения не проверяются', () => {
    expect(profanityResponse({ title: 'Рост выручки', n: 5, empty: null, list: ['x'] })).toBeNull()
  })

  it('400 с текстом ProfanityError и именем поля', async () => {
    const res = profanityResponse({ title: 'Нормально', body: BAD })!
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ ok: false, error: PROFANITY_MESSAGE, code: 'profanity', field: 'body' })
    expect(PROFANITY_MESSAGE).toBe('Уберите нецензурные слова — такой текст сохранить нельзя.')
  })

  it('profaneField — первое грязное поле', () => {
    expect(profaneField({ a: 'ок', b: BAD, c: BAD })).toBe('b')
    expect(profaneField({ a: 'ок' })).toBeNull()
  })
})

describe('flattenText / textOf', () => {
  it('строковые листья с путями; ссылки и служебные ключи пропускаются', () => {
    expect(flattenText({ title: 'T', blocks: [{ text: 'a', url: 'https://x' }, { label: 'b', href: '/y' }] })).toEqual({
      title: 'T', 'blocks.0.text': 'a', 'blocks.1.label': 'b',
    })
  })

  it('textOf склеивает строки так, что одиночные буквы не слипаются', () => {
    expect(textOf(['б', 'л', 'я'])).not.toMatch(/бля/)
    expect(answersProfanityResponse({ q: ['б', 'л', 'я'] })).toBeNull()
  })
})

describe('answersProfanityResponse (анкета)', () => {
  it('текстовый ответ с матом → 400 с ключом вопроса', async () => {
    const res = answersProfanityResponse({ s1_revenue: 1000, s3_usp: BAD, s1_model: 'B2B' })!
    expect(res.status).toBe(400)
    expect((await res.json()).field).toBe('s3_usp')
  })

  it('числа, выбор, да/нет и пустые ответы не трогаются', () => {
    expect(answersProfanityResponse({ a: 12, b: true, c: null, d: ['b2b', 'b2c'], e: 'Обычный ответ' })).toBeNull()
  })

  it('мат внутри списка/таблицы тоже ловится', async () => {
    const res = answersProfanityResponse({ s5_rows: [{ name: 'ок' }, { name: BAD }] })!
    expect((await res.json()).field).toBe('s5_rows')
  })
})

describe('noProfanity (zod)', () => {
  it('добавляет понятную ошибку', () => {
    const schema = z.object({ title: z.string().superRefine(noProfanity) })
    const r = schema.safeParse({ title: BAD })
    expect(r.success).toBe(false)
    expect(r.error?.issues[0]?.message).toBe(PROFANITY_MESSAGE)
    expect(schema.safeParse({ title: 'Хорошо' }).success).toBe(true)
  })
})

describe('client helpers', () => {
  it('profanityRejection читает только отказ из-за мата', () => {
    expect(profanityRejection({ ok: false, error: PROFANITY_MESSAGE, code: 'profanity', field: 'body' })).toEqual({ message: PROFANITY_MESSAGE, field: 'body' })
    expect(profanityRejection({ ok: false, error: 'save_failed' })).toBeNull()
    expect(profanityRejection(null)).toBeNull()
  })

  it('apiErrorMessage: текст отказа или запасной вариант', () => {
    expect(apiErrorMessage({ code: 'profanity', error: PROFANITY_MESSAGE }, 'fallback')).toBe(PROFANITY_MESSAGE)
    expect(apiErrorMessage({ error: 'save_failed' }, 'fallback')).toBe('fallback')
  })
})

describe('chat helpers', () => {
  it('вопрос маскируется, чистый — без изменений', () => {
    expect(maskUserQuestion('Какая выручка?')).toEqual({ text: 'Какая выручка?', masked: false })
    const m = maskUserQuestion(`Почему ${BAD}?`)
    expect(m.masked).toBe(true)
    expect(m.text).not.toMatch(/хуйня/)
    expect(m.text).toContain('х****')
  })

  it('ответ маскируется; приписка — только если вопрос был с матом', () => {
    expect(safeAnswer('Всё хорошо', false)).toBe('Всё хорошо')
    expect(safeAnswer('Всё хорошо', true)).toBe(`${PROFANITY_CHAT_NOTE}\n\nВсё хорошо`)
    expect(safeAnswer(BAD, false)).not.toMatch(/хуйня/)
  })
})
