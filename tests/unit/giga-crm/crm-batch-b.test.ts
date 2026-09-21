/**
 * Массовые напоминания, выгрузка и поиск дубликатов.
 */
import { describe, expect, it } from 'vitest'
import { csvCell, toCsv } from '@/lib/admin/csv'

describe('выгрузка CSV', () => {
  it('открывается в Excel: BOM и точка с запятой', () => {
    const out = toCsv(['Компания', 'Email'], [['ТОО «Пример»', 'a@x.io']])
    expect(out.startsWith('﻿')).toBe(true)
    expect(out).toContain('Компания;Email')
  })

  it('экранирует разделители и кавычки', () => {
    expect(csvCell('Алматы; Астана')).toBe('"Алматы; Астана"')
    expect(csvCell('ТОО "Пример"')).toBe('"ТОО ""Пример"""')
    expect(csvCell('строка\nвторая')).toBe('"строка\nвторая"')
  })

  it('обезвреживает формулу в ячейке', () => {
    // Классическая CSV-инъекция: Excel исполнит содержимое при открытии.
    expect(csvCell('=1+1')).toBe("'=1+1")
    expect(csvCell('+79990000000')).toBe("'+79990000000")
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)")
    // Обычный текст не трогаем.
    expect(csvCell('Алматы')).toBe('Алматы')
  })

  it('пустые значения не превращаются в «null»', () => {
    expect(csvCell(null)).toBe('')
    expect(csvCell(undefined)).toBe('')
  })
})
