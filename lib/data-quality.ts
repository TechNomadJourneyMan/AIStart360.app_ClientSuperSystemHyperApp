// Patient-base CSV/XLSX data-quality validator for the medical vertical.
// Reads the uploaded file, fuzzy-matches columns to expected fields, and
// produces a DataQualityReport with issues graded by severity. Used by
// /api/medical/intake/validate + the RFM/audit pipeline.
//
// Expected columns in a YCLIENTS export (Sau Zhurek): ФИО, Телефон, Первый
// приём, Последний приём, Кол-во приёмов, Сумма, Согласие на рассылку…

import * as XLSX from 'xlsx'

export type IssueSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info'

export interface DataQualityIssue {
  severity: IssueSeverity
  field?: string           // column name or logical field id
  message: string
  count?: number           // rows affected
  total?: number           // denominator (row count)
}

export interface DataQualityReport {
  ok: boolean                                    // usable for RFM?
  rowCount: number
  columnCount: number
  detectedColumns: Record<string, string | null> // logical field → original header (or null if missing)
  issues: DataQualityIssue[]
  summary: string
  rawHeaders: string[]
}

// Logical fields we need for RFM + bundles. Regex matches case-insensitive
// substring of the raw column header (after ё→е, lowercasing, stripping punct).
interface FieldSpec {
  id: LogicalField
  label: string
  patterns: RegExp[]
  required: boolean
  /** How to judge fill-rate */
  expectedFillRate: number   // 0..1
}

type LogicalField =
  | 'full_name'
  | 'phone'
  | 'first_visit'
  | 'last_visit'
  | 'visits_count'
  | 'total_sum'
  | 'consent'
  | 'birth_date'

const FIELD_SPECS: FieldSpec[] = [
  { id: 'full_name',   label: 'ФИО',           patterns: [/имя.*фам|фио|full.*name|name|клиент/], required: true,  expectedFillRate: 0.95 },
  { id: 'phone',       label: 'Телефон',       patterns: [/телефон|phone|mobile|моб/],            required: true,  expectedFillRate: 0.90 },
  { id: 'first_visit', label: 'Первый приём',  patterns: [/первы[йи].*приём|первое.*посещен|first.*visit|регистраци/], required: false, expectedFillRate: 0.70 },
  { id: 'last_visit',  label: 'Последний приём', patterns: [/последни[йе].*приём|последн.*посещен|last.*visit|дата.*визит/], required: true,  expectedFillRate: 0.70 },
  { id: 'visits_count',label: 'Количество приёмов', patterns: [/кол.во.*приё|приём|визит.*всего|count.*visit|frequency/],   required: true,  expectedFillRate: 0.70 },
  { id: 'total_sum',   label: 'Общая сумма',   patterns: [/общая.*сумма|сумма|всего|total|ltv|monetary/],                 required: true,  expectedFillRate: 0.50 },
  { id: 'consent',     label: 'Согласие на рассылку', patterns: [/соглас|consent/],                                         required: false, expectedFillRate: 0 },
  { id: 'birth_date',  label: 'Дата рождения', patterns: [/дата.*рожд|birth.*date|возраст/],                               required: false, expectedFillRate: 0 },
]

function normalizeHeader(h: string): string {
  return (h ?? '').toString().toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\s.]/gu, ' ').replace(/\s+/g, ' ').trim()
}

function detectColumns(headers: string[]): Record<LogicalField, { idx: number; raw: string } | null> {
  const norm = headers.map(normalizeHeader)
  const detected: Record<LogicalField, { idx: number; raw: string } | null> = Object.fromEntries(
    FIELD_SPECS.map((f) => [f.id, null]),
  ) as Record<LogicalField, { idx: number; raw: string } | null>

  for (const spec of FIELD_SPECS) {
    for (let i = 0; i < norm.length; i++) {
      if (detected[spec.id]) break
      if (spec.patterns.some((r) => r.test(norm[i]))) {
        detected[spec.id] = { idx: i, raw: headers[i] }
      }
    }
  }
  return detected
}

function parsePhone(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const digits = String(v).replace(/\D/g, '')
  if (digits.length < 10) return null
  return digits
}

function parseDate(v: unknown): Date | null {
  if (v === null || v === undefined || v === '') return null
  if (v instanceof Date && !isNaN(v.getTime())) return v
  // Excel serial number
  if (typeof v === 'number' && v > 25000 && v < 60000) {
    const d = XLSX.SSF.parse_date_code(v)
    if (d) return new Date(d.y, d.m - 1, d.d)
  }
  const s = String(v).trim()
  // dd.mm.yyyy / dd/mm/yyyy / yyyy-mm-dd
  const iso = Date.parse(s)
  if (!isNaN(iso)) return new Date(iso)
  const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/)
  if (m) {
    const [, d, mo, y] = m
    const year = y.length === 2 ? 2000 + parseInt(y, 10) : parseInt(y, 10)
    return new Date(year, parseInt(mo, 10) - 1, parseInt(d, 10))
  }
  return null
}

function parseNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const s = String(v).replace(/\s/g, '').replace(/[,₸]/g, '')
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : null
}

/**
 * Parse CSV/XLS/XLSX file buffer into headers + rows.
 * XLS files from YCLIENTS use an older BIFF format sometimes reported
 * as corrupt by strict parsers — we try read-all cells fallback.
 */
export function parseFileBuffer(
  buf: ArrayBuffer | Uint8Array | Buffer,
  filename: string,
): { headers: string[]; rows: Array<Record<string, unknown>>; error: string | null } {
  try {
    const ext = (filename.split('.').pop() ?? '').toLowerCase()
    // XLSX can auto-detect format; we enforce 'cellDates' to get Date objects
    const wb = XLSX.read(buf, {
      type: buf instanceof Buffer ? 'buffer' : 'array',
      cellDates: true,
      cellText: false,
    })
    const firstSheet = wb.SheetNames[0]
    if (!firstSheet) return { headers: [], rows: [], error: 'No sheets found' }
    const sheet = wb.Sheets[firstSheet]

    // Convert to array-of-arrays first to recover headers robustly
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: false })
    if (aoa.length === 0) return { headers: [], rows: [], error: 'Файл пуст' }

    const headers = (aoa[0] as unknown[]).map((h) => String(h ?? '').trim())
    const rows = aoa.slice(1).map((row) => {
      const r: Record<string, unknown> = {}
      headers.forEach((h, i) => { r[h] = (row as unknown[])[i] })
      return r
    })
    return { headers, rows, error: null }
  } catch (e) {
    return { headers: [], rows: [], error: e instanceof Error ? e.message : 'parse error' }
  }
}

export function validatePatientBase(
  buf: ArrayBuffer | Uint8Array | Buffer,
  filename: string,
): DataQualityReport {
  const parsed = parseFileBuffer(buf, filename)
  if (parsed.error) {
    return {
      ok: false,
      rowCount: 0,
      columnCount: 0,
      detectedColumns: {} as Record<string, string | null>,
      issues: [{ severity: 'critical', message: `Не удалось прочитать файл: ${parsed.error}` }],
      summary: 'Файл не прочитан',
      rawHeaders: [],
    }
  }

  const { headers, rows } = parsed
  const detected = detectColumns(headers)
  const issues: DataQualityIssue[] = []

  // ── Column detection issues ──────────────────────────────────────────────
  for (const spec of FIELD_SPECS) {
    if (!detected[spec.id]) {
      issues.push({
        severity: spec.required ? 'critical' : 'medium',
        field: spec.id,
        message: `Колонка «${spec.label}» не найдена — ожидается заголовок вида «${spec.patterns[0].source}»`,
      })
    }
  }

  // ── Row-level checks for detected required fields ───────────────────────
  const phoneCol = detected.phone
  if (phoneCol) {
    let empty = 0
    let invalid = 0
    const seen = new Map<string, number>()
    for (const r of rows) {
      const raw = r[phoneCol.raw]
      if (raw === null || raw === undefined || raw === '') { empty++; continue }
      const p = parsePhone(raw)
      if (!p) { invalid++; continue }
      seen.set(p, (seen.get(p) ?? 0) + 1)
    }
    const dupes = Array.from(seen.values()).filter((n) => n > 1).reduce((s, n) => s + n - 1, 0)
    if (empty > 0) issues.push({ severity: empty / rows.length > 0.1 ? 'high' : 'medium', field: 'phone', message: 'Пустые телефоны', count: empty, total: rows.length })
    if (invalid > 0) issues.push({ severity: 'medium', field: 'phone', message: 'Телефоны в нестандартном формате (<10 цифр)', count: invalid, total: rows.length })
    if (dupes > 0) issues.push({ severity: 'medium', field: 'phone', message: 'Дубликаты телефонов', count: dupes, total: rows.length })
  }

  const lastVisitCol = detected.last_visit
  if (lastVisitCol) {
    let broken = 0
    let empty = 0
    let future = 0
    const now = Date.now()
    for (const r of rows) {
      const raw = r[lastVisitCol.raw]
      if (raw === null || raw === undefined || raw === '') { empty++; continue }
      const d = parseDate(raw)
      if (!d) { broken++; continue }
      if (d.getTime() > now + 24 * 3600 * 1000) future++
    }
    if (broken > 0) issues.push({ severity: 'medium', field: 'last_visit', message: 'Некорректный формат даты последнего визита', count: broken, total: rows.length })
    if (empty > 0) issues.push({ severity: 'low', field: 'last_visit', message: 'Пустые даты последнего визита', count: empty, total: rows.length })
    if (future > 0) issues.push({ severity: 'high', field: 'last_visit', message: 'Даты в будущем (вероятно ошибка данных)', count: future, total: rows.length })
  }

  const sumCol = detected.total_sum
  if (sumCol) {
    let empty = 0
    let invalid = 0
    for (const r of rows) {
      const raw = r[sumCol.raw]
      if (raw === null || raw === undefined || raw === '') { empty++; continue }
      const n = parseNumber(raw)
      if (n === null) invalid++
    }
    if (empty > 0) issues.push({ severity: 'low', field: 'total_sum', message: 'Без суммы (пациенты без транзакций)', count: empty, total: rows.length })
    if (invalid > 0) issues.push({ severity: 'medium', field: 'total_sum', message: 'Суммы в нечитаемом формате', count: invalid, total: rows.length })
  }

  const consentCol = detected.consent
  if (!consentCol) {
    issues.push({
      severity: 'info',
      field: 'consent',
      message: 'Согласие на рассылку не найдено в выгрузке. WhatsApp-кампании юридически рискованы до получения явного согласия.',
    })
  }

  // ── Fill-rate sanity ──────────────────────────────────────────────────────
  if (rows.length < 10) {
    issues.push({ severity: 'high', message: `Слишком мало строк (${rows.length}) для репрезентативной сегментации. Ожидается ≥ 50.` })
  }
  if (rows.length > 50000) {
    issues.push({ severity: 'info', message: `Большая база (${rows.length} строк). Обработка займёт больше времени.` })
  }

  // ── Aggregate ────────────────────────────────────────────────────────────
  const criticalCount = issues.filter((i) => i.severity === 'critical').length
  const highCount     = issues.filter((i) => i.severity === 'high').length
  const ok = criticalCount === 0 && detected.phone !== null && (detected.last_visit !== null || detected.visits_count !== null)

  const summary = ok
    ? `Файл пригоден для анализа. ${rows.length} строк, ${headers.length} колонок. ` +
      `${highCount > 0 ? `Есть ${highCount} серьёзных замечаний — рекомендуем исправить перед запуском связок.` : 'Серьёзных проблем не найдено.'}`
    : `Файл непригоден для анализа: ${criticalCount} критичных проблем. Исправьте и загрузите заново.`

  const detectedColumns: Record<string, string | null> = {}
  for (const spec of FIELD_SPECS) {
    detectedColumns[spec.id] = detected[spec.id]?.raw ?? null
  }

  return {
    ok,
    rowCount: rows.length,
    columnCount: headers.length,
    detectedColumns,
    issues,
    summary,
    rawHeaders: headers,
  }
}
