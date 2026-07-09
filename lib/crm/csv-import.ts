// lib/crm/csv-import.ts — парсер CSV клиентов с русскими/английскими заголовками.
// Дедуп внутри файла по нормализованному телефону; строки без имени пропускаются.

import { normalizePhone } from './phone'

export interface ClientDraft {
  name: string
  phone: string | null // E.164
  phone_raw: string | null
  email: string | null
  note: string | null
  avg_check: number | null
}

export interface ParseClientsResult {
  rows: ClientDraft[]
  skipped: number
}

type Column = 'name' | 'phone' | 'email' | 'note' | 'avg_check'

// Первое совпадение (равенство или вхождение) выигрывает; порядок важен.
const HEADER_MAP: Array<{ key: Column; aliases: string[] }> = [
  { key: 'name', aliases: ['имя', 'name', 'фио', 'клиент', 'контакт'] },
  { key: 'phone', aliases: ['телефон', 'phone', 'номер', 'тел', 'mobile', 'моб', 'tel'] },
  { key: 'email', aliases: ['email', 'e-mail', 'почта', 'мейл', 'мэйл'] },
  { key: 'note', aliases: ['комментарий', 'заметка', 'заметки', 'примечание', 'note', 'comment'] },
  { key: 'avg_check', aliases: ['сумма', 'средний чек', 'чек', 'сделка', 'amount', 'сумма сделки'] },
]

const NAME_MAX = 120
const EMAIL_MAX = 200
const NOTE_MAX = 2000

function detectDelimiter(headerLine: string): string {
  const count = (re: RegExp) => (headerLine.match(re) || []).length
  const semis = count(/;/g)
  const tabs = count(/\t/g)
  const commas = count(/,/g)
  if (semis > 0 && semis >= commas && semis >= tabs) return ';'
  if (tabs > 0 && tabs >= commas) return '\t'
  return ','
}

/** Полноценный CSV-токенайзер: поддерживает кавычки, экранирование "" и делимитер. */
function parseCsvRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false
  let started = false

  const pushField = () => {
    row.push(field)
    field = ''
    started = true
  }
  const pushRow = () => {
    pushField()
    rows.push(row)
    row = []
    started = false
  }

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
      continue
    }
    if (ch === '"') {
      inQuotes = true
      started = true
    } else if (ch === delimiter) {
      pushField()
    } else if (ch === '\n') {
      pushRow()
    } else if (ch === '\r') {
      // ignore — handled together with the following \n
    } else {
      field += ch
      started = true
    }
  }
  if (started || field.length > 0 || row.length > 0) pushRow()
  return rows
}

function normalizeHeader(cell: string): string {
  return cell.trim().toLowerCase().replace(/^"|"$/g, '').trim()
}

function matchColumn(header: string): Column | null {
  const h = normalizeHeader(header)
  if (!h) return null
  for (const { key, aliases } of HEADER_MAP) {
    if (aliases.some((a) => h === a)) return key
  }
  for (const { key, aliases } of HEADER_MAP) {
    if (aliases.some((a) => h.includes(a))) return key
  }
  return null
}

/** Мягкий разбор суммы: "1 200 000 ₸" → 1200000, "1,5" → 1.5. Ошибка → null. */
function parseAvgCheckLoose(raw: string): number | null {
  if (!raw) return null
  let s = raw.replace(/[\s ]/g, '').replace(/[^0-9.,-]/g, '')
  if (!s) return null
  if (s.includes(',') && s.includes('.')) s = s.replace(/,/g, '')
  else if (s.includes(',')) s = s.replace(',', '.')
  const n = Number(s)
  if (!Number.isFinite(n) || n < 0) return null
  return n
}

function capOrNull(v: string | undefined, max: number): string | null {
  if (v == null) return null
  const s = v.trim().slice(0, max)
  return s.length ? s : null
}

export function parseClientsCsv(text: string): ParseClientsResult {
  if (!text || !text.trim()) return { rows: [], skipped: 0 }

  const firstLine = text.split(/\r?\n/)[0] ?? ''
  const delimiter = detectDelimiter(firstLine)
  const grid = parseCsvRows(text, delimiter).filter(
    (r) => r.length > 0 && r.some((c) => c.trim().length > 0),
  )
  if (grid.length === 0) return { rows: [], skipped: 0 }

  const header = grid[0]
  const colIndex: Partial<Record<Column, number>> = {}
  header.forEach((cell, i) => {
    const col = matchColumn(cell)
    if (col && colIndex[col] === undefined) colIndex[col] = i
  })

  const dataRows = grid.slice(1)

  // Без распознанной колонки «Имя» импортировать нечего — все строки skipped.
  if (colIndex.name === undefined) {
    return { rows: [], skipped: dataRows.length }
  }

  const rows: ClientDraft[] = []
  const seenPhones = new Set<string>()
  let skipped = 0

  for (const r of dataRows) {
    const cell = (col: Column): string | undefined =>
      colIndex[col] !== undefined ? r[colIndex[col] as number] : undefined

    const name = (cell('name') ?? '').trim().slice(0, NAME_MAX)
    if (!name) {
      skipped++
      continue
    }

    const rawPhone = (cell('phone') ?? '').trim()
    const { e164 } = normalizePhone(rawPhone)

    if (e164 && seenPhones.has(e164)) {
      skipped++ // дубль внутри файла
      continue
    }
    if (e164) seenPhones.add(e164)

    rows.push({
      name,
      phone: e164,
      phone_raw: rawPhone ? rawPhone : null,
      email: capOrNull(cell('email'), EMAIL_MAX),
      note: capOrNull(cell('note'), NOTE_MAX),
      avg_check: parseAvgCheckLoose((cell('avg_check') ?? '').trim()),
    })
  }

  return { rows, skipped }
}
