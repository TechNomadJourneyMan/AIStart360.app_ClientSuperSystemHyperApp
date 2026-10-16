import { describe, expect, it } from 'vitest'
import { assertClean, dirtyField, findProfanity, hasProfanity, maskProfanity, ProfanityError } from '@/lib/moderation/profanity'

describe('profanity filter', () => {
  it.each([
    'бля', 'блядь', 'блять', 'хуй', 'нахуя', 'похуй', 'хуйня', 'пизда', 'распиздяй', 'ебать', 'заебал',
    'уебан', 'выебон', 'мудак', 'пидор', 'гандон', 'залупа', 'шлюха', 'сука', 'сучка', 'долбоёб', 'говно', 'жопа',
    'ублюдок', 'херня', 'fuck', 'shit', 'bitch', 'motherfucker',
  ])('catches «%s»', (w) => expect(hasProfanity(`ну ${w} же`)).toBe(true))

  it.each([
    'рубля', 'употреблять', 'оскорблять', 'корабля', 'застрахуй', 'подстрахуй', 'мудрый', 'мудрость', 'хлеб',
    'ребёнок', 'небо', 'сукно', 'мандарин', 'мандат', 'херсон', 'хулиган', 'психолог', 'команда', 'тебя', 'себе',
    'Ебрахимов', 'shitake', 'class', 'assessment', 'скупка', 'суккулент', 'потребление', 'требую',
  ])('does not flag «%s»', (w) => expect(hasProfanity(`слово ${w} здесь`)).toBe(false))

  it('sees through obfuscation: latin lookalikes, repeats, separators, ё', () => {
    expect(hasProfanity('xyй')).toBe(true)
    expect(hasProfanity('бляяяя')).toBe(true)
    expect(hasProfanity('б.л.я')).toBe(true)
    expect(hasProfanity('х у й')).toBe(true)
    expect(hasProfanity('ёбаный')).toBe(true)
    expect(hasProfanity('FUUUCK')).toBe(true)
  })

  it('masks keeping the first letter and the rest of the text', () => {
    expect(maskProfanity('Это просто блядь какая-то')).toBe('Это просто б**** какая-то')
    expect(maskProfanity('ok fuck it')).toBe('ok f*** it')
    expect(maskProfanity('чисто')).toBe('чисто')
    expect(findProfanity('сука и бля')).toHaveLength(2)
  })

  it('assertClean / dirtyField name the field', () => {
    expect(() => assertClean({ title: 'Нормально', body: 'ну ты мудак' })).toThrow(ProfanityError)
    expect(dirtyField({ title: 'хуй', body: 'ok' })).toBe('title')
    expect(dirtyField({ title: 'ok' })).toBeNull()
  })
})
