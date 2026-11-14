// Patient-base CSV/XLSX data-quality validator for the medical vertical.
// Reads the uploaded file, fuzzy-matches columns to expected fields, and
// produces a DataQualityReport with issues graded by severity. Used by
// /api/medical/intake/validate + the RFM/audit pipeline.
//
// Expected columns in a YCLIENTS export (Sau Zhurek): ФИО, Телефон, Первый
// приём, Последний приём, Кол-во приёмов, Сумма, Согласие на рассылку…

// Dates, numbers and the sheet itself are read exactly as the RFM analysis
// reads them (lib/tabular-parse.ts): day-first dates, Excel date cells as
// dates (not the US «4/3/26» text), «45 000,50» as 45000.5, Cyrillic CSV in
// UTF-8 or Windows-1251.
import { parseDayFirstDate, parseLocaleNumber, readPatientSheet } from './tabular-parse'

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
  /** Header example for the «not found» message (when the pattern is not readable). */
  example?: string
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

// Patterns match YCLIENTS and common CRM exports (e.g. "Имя", "Потратил, ₸",
// "Количество посещений", "Последний визит"). Lowercased + ё→е before match.
const FIELD_SPECS: FieldSpec[] = [
  { id: 'full_name',   label: 'ФИО / Имя',     patterns: [/^имя$|фио|имя.*фам|full.*name|name|клиент/], required: true,  expectedFillRate: 0.95 },
  { id: 'phone',       label: 'Телефон',       patterns: [/^телефон$|phone|^mobile|^моб/],            required: true,  expectedFillRate: 0.90 },
  { id: 'first_visit', label: 'Первый визит',  patterns: [/первы[йи].*визит|первы[йи].*приём|первое.*посещен|first.*visit|регистраци/], required: false, expectedFillRate: 0.70 },
  { id: 'last_visit',  label: 'Последний визит', patterns: [/последни[йе].*визит|последни[йе].*приём|последн.*посещен|last.*visit|дата.*визит/], required: true,  expectedFillRate: 0.70 },
  // Not required: without it the RFM analysis segments by recency + spend (R-042)
  // — reported as a warning below, not as an unusable file.
  { id: 'visits_count',label: 'Количество посещений', patterns: [/количество.*посещ|кол.во.*приё|кол.во.*визит|^приём|визит.*всего|count.*visit|frequency/], required: false, expectedFillRate: 0.70 },
  // «всего» alone also matched «Визитов всего»: a visit / count header is never the spend (as in RFM).
  { id: 'total_sum',   label: 'Сумма (LTV)',   patterns: [/потратил|оплатил|общая.*сумма|^сумма$|сумма.*всего|всего.*сумм|^всего$|total|ltv|monetary/].map((re) => new RegExp(`^(?!.*(визит|посещ|приём|прием|кол)).*(?:${re.source})`)), required: true,  example: 'Потратил / Сумма / Оплатил', expectedFillRate: 0.50 },
  { id: 'consent',     label: 'Согласие на рассылку', patterns: [/соглас.*рассыл|соглас|consent/],      required: false, expectedFillRate: 0 },
  { id: 'birth_date',  label: 'Дата рождения', patterns: [/дата.*рожд|birth.*date|возраст/],            required: false, expectedFillRate: 0 },
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

/** A visit date: day-first, Excel date cells / serials (lib/tabular-parse.ts). */
const parseDate = parseDayFirstDate

/** A money / count cell in the local format (lib/tabular-parse.ts). */
const parseNumber = parseLocaleNumber

/**
 * Parse CSV/XLS/XLSX file buffer into headers + rows with TYPED cells (a date
 * cell is a Date, a number a number) — the same reader as the RFM analysis.
 * It used to format cells (raw: false: a date cell became the US «4/3/26»)
 * and read CSV bytes without a charset (Cyrillic headers broke).
 */
export function parseFileBuffer(
  buf: ArrayBuffer | Uint8Array | Buffer,
  filename: string,
): { headers: string[]; rows: Array<Record<string, unknown>>; error: string | null } {
  return readPatientSheet(buf, filename)
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
    // visits_count: its own warning below (what it means for the analysis).
    if (!detected[spec.id] && spec.id !== 'visits_count') {
      issues.push({
        severity: spec.required ? 'critical' : 'medium',
        field: spec.id,
        message: `Колонка «${spec.label}» не найдена — ожидается заголовок вида «${spec.example ?? spec.patterns[0].source}»`,
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

  // Visit frequency: without the column the analysis cannot tell regulars from
  // one-off patients — segments come from recency + spend only (R-042).
  const visitsCol = detected.visits_count
  if (!visitsCol) {
    issues.push({
      severity: 'high',
      field: 'visits_count',
      message: 'Нет колонки «Количество посещений»: частота визитов неизвестна — сегменты будут построены только по давности визита и сумме (R+M). Добавьте колонку в выгрузку для точной сегментации.',
    })
  } else {
    let invalid = 0
    for (const r of rows) {
      const raw = r[visitsCol.raw]
      if (raw === null || raw === undefined || raw === '') continue
      const n = parseNumber(raw)
      if (n === null || n < 0) invalid++
    }
    if (invalid > 0) issues.push({ severity: 'medium', field: 'visits_count', message: 'Количество посещений в нечитаемом формате', count: invalid, total: rows.length })
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
