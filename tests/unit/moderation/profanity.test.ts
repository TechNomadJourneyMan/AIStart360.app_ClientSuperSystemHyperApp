import { describe, expect, it } from 'vitest'
import { checkProfanity, maskText, maskWord } from '@/lib/moderation/profanity'

const bad = (t: string, opts?: Parameters<typeof checkProfanity>[1]) => !checkProfanity(t, opts).clean

describe('checkProfanity — ловит', () => {
  it.each([
    'хуй', 'нахуя', 'охуеть', 'хуйня', 'пизда', 'распиздяй', 'ебать', 'заебал', 'наебали', 'отъебись',
    'долбоёб', 'ёбаный', 'блять', 'блядь', 'бля', 'сука', 'суки', 'мудак', 'пидор', 'пидорас', 'гандон',
    'шлюха', 'залупа', 'дрочить', 'говно', 'жопа', 'засранец', 'ублюдок', 'ебло', 'ебучий', 'выебываться',
  ])('мат: %s', (w) => {
    expect(checkProfanity(`Компания ${w} и партнёры`).categories).toContain('mat')
  })

  it.each(['дебил', 'идиот', 'кретин', 'урод', 'тварь', 'мразь', 'чмо', 'лох', 'дегенерат'])('оскорбление: %s', (w) => {
    expect(checkProfanity(w).categories).toContain('insult')
  })

  it.each([
    'х.у.й', 'х у й', 'х-у-й', 'П И З Д А', 'хууууй', 'xyй', 'cyka', 'бл_ять', 'ХУЙ', 'Хуйня', '3аебал', 'пи3да',
    'suka', 'blyat', 'pizdec', 'nahuy', 'fuck', 'motherfucker', 'bullshit', 'bitch', 'ebat',
  ])('обход/транслит: %s', (w) => {
    expect(bad(w)).toBe(true)
  })

  it('спам в имени: ссылки и @-ники', () => {
    expect(bad('Иван https://casino.example', { kind: 'name' })).toBe(true)
    expect(bad('Пишите в t.me/spam', { kind: 'name' })).toBe(true)
    expect(bad('Иван @superpromo', { kind: 'name' })).toBe(true)
    // в описании ссылка — не нарушение
    expect(bad('Наш сайт https://example.kz', { kind: 'text' })).toBe(false)
  })

  it('порно / виагра / эскорт — спам', () => {
    expect(checkProfanity('порно').categories).toEqual(['spam'])
    expect(checkProfanity('viagra online').categories).toEqual(['spam'])
  })
})

describe('checkProfanity — не трогает нормальные слова', () => {
  const CLEAN = [
    'хлеб', 'хлебать', 'колебание', 'колебаться', 'употреблять', 'употребление', 'требование', 'себестоимость',
    'себе', 'вебинар', 'небоскрёб', 'небо', 'ребята', 'гребля', 'Глеб', 'погребальный', 'EBITDA', 'ЕБИТДА',
    'сукно', 'сукровица', 'мудрость', 'мудрый', 'педикюр', 'педаль', 'педагог', 'гондола', 'мандарин', 'мандат',
    'сравнение', 'сражение', 'сразу', 'срок', 'сруб', 'Сретенка', 'урожай', 'уродоваться?', 'лохматый',
    'страхуй', 'застрахуйте', 'психуй', 'рубля', 'сабля', 'корабля', 'бляшка', 'оскорбление', 'скорблю',
    'команда', 'ссылка', 'ссуда', 'дебет', 'дебиторка', 'Скандинавия', 'Тверь', 'тварный',
    'Mandy', 'shiitake', 'Scunthorpe', 'class', 'assessment', 'e-banking', 'ebay', 'Huawei', 'хуанхэ',
    'ТОО kOtaq-Telecom', 'Медиа / Реклама', 'интернет-магазин', 'бизнес-план', 'кто-то',
    'Мы продаём хлеб и выпечку, себестоимость снизилась, требования клиентов растут',
  ]
  it.each(CLEAN)('чисто: %s', (w) => {
    expect(checkProfanity(w).matches).toEqual([])
  })

  it('пустой и нестроковый ввод — чистый', () => {
    expect(checkProfanity('').clean).toBe(true)
    expect(checkProfanity(null).clean).toBe(true)
    expect(checkProfanity(42).clean).toBe(true)
  })
})

describe('словарь из админки', () => {
  it('block добавляет своё слово (по началу слова)', () => {
    expect(checkProfanity('конкурент рогакопыта', { dictionary: { block: ['рогакопыт'] } }).categories).toEqual(['custom'])
  })
  it('allow снимает ложное срабатывание', () => {
    expect(bad('Компания Сукин и сыновья')).toBe(true)
    expect(bad('Компания Сукин и сыновья', { dictionary: { allow: ['сукин'] } })).toBe(false)
  })
})

describe('маскировка', () => {
  it('maskWord оставляет первую букву', () => {
    expect(maskWord('хуйня')).toBe('х****')
  })
  it('maskText прячет найденные слова', () => {
    const text = 'Наша компания — полное говно, честно'
    const r = checkProfanity(text)
    expect(maskText(text, r.matches)).toBe('Наша компания — полное г****, честно')
  })
})
