// lib/crm/csv-import.ts — парсер CSV клиентов с русскими/английскими заголовками.
// Строки без имени пропускаются. Дубли (внутри файла и с базой) сводит планировщик
// импорта lib/crm/import-merge.ts — по телефону, e-mail или имени, без потери данных.

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
  {
    key: 'avg_check',
    // «avg_check» / «средний_чек» arrive as «avg check» / «средний чек» (normalizeHeader).
    aliases: ['сумма', 'средний чек', 'чек', 'сделка', 'amount', 'сумма сделки', 'avg check', 'average check'],
  },
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
  // «avg_check» / «средний_чек» → «avg check» / «средний чек»
  return cell.trim().toLowerCase().replace(/^"|"$/g, '').replace(/_+/g, ' ').replace(/\s+/g, ' ').trim()
}

// One address, no spaces, a dot in the domain — «-», «нет», «n/a», «info @ firm» are not e-mails.
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/

/**
 * The cell as an e-mail address, or null when it is not one. Placeholders («-», «нет», «n/a», «—»)
 * are not addresses: an import matches clients by e-mail, so a placeholder taken as an address
 * would merge different people.
 */
export function validEmailOrNull(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim()
  if (!s || s.length > EMAIL_MAX || !EMAIL_RE.test(s)) return null
  return s
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

    rows.push({
      name,
      phone: e164,
      phone_raw: rawPhone ? rawPhone : null,
      email: validEmailOrNull(cell('email')),
      note: capOrNull(cell('note'), NOTE_MAX),
      avg_check: parseAvgCheckLoose((cell('avg_check') ?? '').trim()),
    })
  }

  return { rows, skipped }
}
