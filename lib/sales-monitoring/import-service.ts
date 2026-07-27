import { createHash } from 'crypto'
import * as XLSX from 'xlsx'
import type { SalesAccessContext } from './access'
import {
  milliToQuantity,
  minorToMoney,
  moneyToMinor,
  quantityToMilli,
} from './calculations'
import { query, withTransaction } from './database'
import { DomainError } from './errors'
import { createProductRequest } from './product-service'
import { createSale, postSale } from './sales-service'

type ImportKind = 'sales' | 'expenses' | 'plans' | 'master_data'

const aliases: Record<string, string[]> = {
  soldAt: ['дата', 'date', 'дата сделки'],
  region: ['регион', 'region'],
  channel: ['канал', 'channel'],
  manager: ['менеджер', 'manager'],
  product: ['продукт', 'товар', 'product'],
  sku: ['артикул', 'sku', 'код товара'],
  barcode: ['штрихкод', 'штрих-код', 'barcode'],
  size: ['размер', 'size'],
  color: ['цвет', 'color'],
  quantity: ['количество', 'кол-во', 'qty', 'quantity'],
  revenue: ['выручка', 'сумма', 'revenue'],
  description: ['описание', 'description', 'комментарий'],
}

function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLocaleLowerCase('ru-RU')
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
}

function findCanonical(header: string): string | null {
  for (const [canonical, values] of Object.entries(aliases)) {
    if (values.includes(header)) return canonical
  }
  return null
}

function parseNumber(value: unknown): string | null {
  const normalized = String(value ?? '')
    .replace(/\s/g, '')
    .replace(/[₸₽$€]/g, '')
    .replace(',', '.')
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return null
  return normalized
}

function parseDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString()
  }
  const text = String(value ?? '').trim()
  const iso = new Date(text)
  if (!Number.isNaN(iso.getTime())) return iso.toISOString()
  const match = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/)
  if (!match) return null
  const parsed = new Date(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1]), 12))
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function normalizeSalesRow(record: Record<string, unknown>) {
  const soldAt = parseDate(record.soldAt)
  const quantity = parseNumber(record.quantity)
  const revenue = parseNumber(record.revenue)
  const errors: Array<{ field: string; code: string; message: string }> = []
  if (!soldAt) errors.push({ field: 'soldAt', code: 'DATE_REQUIRED', message: 'Не распознана дата продажи' })
  if (!record.sku && !record.barcode) {
    errors.push({ field: 'sku', code: 'PRODUCT_ID_REQUIRED', message: 'Нужен артикул или штрихкод' })
  }
  if (!quantity || Number(quantity) <= 0) {
    errors.push({ field: 'quantity', code: 'QUANTITY_INVALID', message: 'Количество должно быть больше нуля' })
  }
  if (!revenue || Number(revenue) < 0) {
    errors.push({ field: 'revenue', code: 'REVENUE_INVALID', message: 'Выручка не распознана' })
  }
  return {
    normalized: {
      ...record,
      soldAt,
      quantity,
      revenue,
    },
    errors,
  }
}

export function profileWorkbook(buffer: Buffer, kind: ImportKind) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true })
  const rows: Array<{
    sheetName: string
    sourceRow: number
    raw: Record<string, unknown>
    normalized: Record<string, unknown>
    status: 'valid' | 'warning' | 'error'
    errors: Array<{ field: string; code: string; message: string }>
    fingerprint: string
  }> = []

  for (const sheetName of workbook.SheetNames) {
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
      header: 1,
      raw: false,
      defval: '',
      blankrows: false,
    })
    if (matrix.length < 2) continue
    const headerRowIndex = matrix.findIndex((row) =>
      row.filter((cell) => normalizeHeader(cell)).length >= 3,
    )
    if (headerRowIndex < 0) continue
    const mapping = new Map<number, string>()
    matrix[headerRowIndex].forEach((cell, index) => {
      const canonical = findCanonical(normalizeHeader(cell))
      if (canonical) mapping.set(index, canonical)
    })
    if (mapping.size === 0) continue

    matrix.slice(headerRowIndex + 1).forEach((source, index) => {
      const raw: Record<string, unknown> = {}
      mapping.forEach((canonical, column) => {
        raw[canonical] = source[column]
      })
      if (Object.values(raw).every((value) => String(value ?? '').trim() === '')) return
      const result = kind === 'sales'
        ? normalizeSalesRow(raw)
        : { normalized: raw, errors: [] }
      const fingerprint = createHash('sha256')
        .update(JSON.stringify(result.normalized))
        .digest('hex')
      rows.push({
        sheetName,
        sourceRow: headerRowIndex + index + 2,
        raw,
        normalized: result.normalized,
        status: result.errors.length ? 'error' : 'valid',
        errors: result.errors,
        fingerprint,
      })
    })
  }
  return {
    sheets: workbook.SheetNames,
    rows,
    summary: {
      total: rows.length,
      valid: rows.filter((row) => row.status === 'valid').length,
      warnings: rows.filter((row) => row.status === 'warning').length,
      errors: rows.filter((row) => row.status === 'error').length,
    },
  }
}

export async function createImportJob(input: {
  organizationId: string
  kind: ImportKind
  fileName: string
  storagePath?: string
  buffer: Buffer
  access: SalesAccessContext
}) {
  const fileHash = createHash('sha256').update(input.buffer).digest('hex')
  const profiled = profileWorkbook(input.buffer, input.kind)
  return withTransaction(async (client) => {
    const existing = await client.query<{ id: string; status: string; summary: Record<string, unknown> }>(
      `SELECT id, status, summary FROM import_jobs
       WHERE organization_id = $1 AND kind = $2 AND file_hash = $3`,
      [input.organizationId, input.kind, fileHash],
    )
    if (existing.rows[0]) return { ...existing.rows[0], duplicate: true }

    const job = await client.query<{ id: string }>(
      `INSERT INTO import_jobs (
         organization_id, kind, status, file_name, file_hash, storage_path,
         summary, created_by
       ) VALUES ($1,$2,'validating',$3,$4,$5,$6::jsonb,$7)
       RETURNING id`,
      [
        input.organizationId,
        input.kind,
        input.fileName,
        fileHash,
        input.storagePath ?? null,
        JSON.stringify(profiled.summary),
        input.access.actorId,
      ],
    )
    for (const row of profiled.rows) {
      await client.query(
        `INSERT INTO import_rows (
           import_job_id, sheet_name, source_row, raw_data, normalized_data,
           fingerprint, status, errors
         ) VALUES ($1::uuid,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8::jsonb)`,
        [
          job.rows[0].id,
          row.sheetName,
          row.sourceRow,
          JSON.stringify(row.raw),
          JSON.stringify(row.normalized),
          row.fingerprint,
          row.status,
          JSON.stringify(row.errors),
        ],
      )
    }
    await client.query(
      `UPDATE import_jobs SET status = $2, updated_at = now() WHERE id = $1::uuid`,
      [job.rows[0].id, profiled.summary.valid > 0 ? 'ready' : 'failed'],
    )
    return {
      id: job.rows[0].id,
      status: profiled.summary.valid > 0 ? 'ready' : 'failed',
      summary: profiled.summary,
      sheets: profiled.sheets,
      duplicate: false,
    }
  })
}

function unitPriceFromTotal(total: string, quantity: string): string {
  const totalMinor = moneyToMinor(total)
  const quantityMilli = quantityToMilli(quantity)
  if (quantityMilli <= BigInt(0)) throw new DomainError('QUANTITY_INVALID', 'Количество должно быть больше нуля')
  return minorToMoney((totalMinor * BigInt(1000) + quantityMilli / BigInt(2)) / quantityMilli)
}

export async function commitSalesImport(input: {
  organizationId: string
  jobId: string
  partial: boolean
  access: SalesAccessContext
}) {
  const jobs = await query<{ id: string; kind: string; status: string }>(
    `SELECT id, kind, status FROM import_jobs
     WHERE id = $1::uuid AND organization_id = $2`,
    [input.jobId, input.organizationId],
  )
  const job = jobs[0]
  if (!job) throw new DomainError('IMPORT_NOT_FOUND', 'Импорт не найден', 404)
  if (job.kind !== 'sales') throw new DomainError('IMPORT_KIND_UNSUPPORTED', 'Этот обработчик предназначен для продаж', 422)
  if (!['ready', 'failed'].includes(job.status)) {
    throw new DomainError('IMPORT_NOT_READY', 'Импорт не готов к проведению', 409)
  }
  const invalid = await query<{ count: string }>(
    `SELECT count(*)::text AS count FROM import_rows
     WHERE import_job_id = $1::uuid AND status = 'error'`,
    [input.jobId],
  )
  if (!input.partial && Number(invalid[0].count) > 0) {
    throw new DomainError('IMPORT_HAS_ERRORS', 'Исправьте ошибки или выберите частичный импорт', 422)
  }
  await query(`UPDATE import_jobs SET status = 'importing', updated_at = now() WHERE id = $1::uuid`, [input.jobId])

  const rows = await query<{
    id: string
    source_row: number
    normalized_data: Record<string, unknown>
  }>(
    `SELECT id, source_row, normalized_data FROM import_rows
     WHERE import_job_id = $1::uuid AND status IN ('valid', 'warning')
     ORDER BY source_row`,
    [input.jobId],
  )
  let imported = 0
  let errors = Number(invalid[0].count)

  for (const row of rows) {
    const data = row.normalized_data
    try {
      const variants = await query<{ id: string }>(
        `SELECT id FROM product_variants
         WHERE organization_id = $1 AND archived_at IS NULL
           AND (($2 <> '' AND sku = $2) OR ($3 <> '' AND barcode = $3))
         ORDER BY CASE WHEN sku = $2 THEN 0 ELSE 1 END LIMIT 1`,
        [
          input.organizationId,
          String(data.sku ?? ''),
          String(data.barcode ?? ''),
        ],
      )
      if (!variants[0]) {
        await createProductRequest({
          organizationId: input.organizationId,
          sku: String(data.sku ?? '') || undefined,
          barcode: String(data.barcode ?? '') || undefined,
          name: String(data.product ?? '') || undefined,
          size: String(data.size ?? '') || undefined,
          color: String(data.color ?? '') || undefined,
          comment: `Импорт ${input.jobId}, строка ${row.source_row}`,
        }, input.access)
        throw new DomainError('UNKNOWN_PRODUCT', 'Товар отправлен в очередь добавления', 422)
      }
      const regions = data.region
        ? await query<{ id: string }>(
          `SELECT id FROM sales_regions
           WHERE organization_id = $1 AND name ILIKE $2 AND archived_at IS NULL LIMIT 1`,
          [input.organizationId, String(data.region)],
        )
        : []
      const channels = data.channel
        ? await query<{ id: string }>(
          `SELECT id FROM sales_channels
           WHERE organization_id = $1 AND name ILIKE $2 AND archived_at IS NULL LIMIT 1`,
          [input.organizationId, String(data.channel)],
        )
        : []
      const quantity = String(data.quantity)
      const revenue = String(data.revenue)
      const created = await createSale({
        organizationId: input.organizationId,
        soldAt: String(data.soldAt),
        managerId: input.access.actorId,
        managerName: String(data.manager ?? input.access.email),
        regionId: regions[0]?.id,
        channelId: channels[0]?.id,
        source: 'import',
        sourceRef: `${input.jobId}:${row.source_row}`,
        items: [{
          productVariantId: variants[0].id,
          quantity,
          unitPrice: unitPriceFromTotal(revenue, quantity),
          discountAmount: '0.00',
        }],
      }, input.access, `import-create:${input.jobId}:${row.id}`)
      const saleId = created.body.data.id
      await postSale(
        input.organizationId,
        saleId,
        input.access,
        `import-post:${input.jobId}:${row.id}`,
      )
      await query(
        `UPDATE import_rows
         SET status = 'imported', entity_type = 'sale', entity_id = $2
         WHERE id = $1::uuid`,
        [row.id, saleId],
      )
      imported += 1
    } catch (error) {
      errors += 1
      const message = error instanceof Error ? error.message : 'Ошибка импорта'
      await query(
        `UPDATE import_rows
         SET status = 'error', errors = errors || $2::jsonb
         WHERE id = $1::uuid`,
        [row.id, JSON.stringify([{ code: 'COMMIT_ERROR', message }])],
      )
      if (!input.partial) break
    }
  }
  const status = errors > 0 && imported === 0 ? 'failed' : 'completed'
  await query(
    `UPDATE import_jobs
     SET status = $2, summary = summary || $3::jsonb, updated_at = now()
     WHERE id = $1::uuid`,
    [input.jobId, status, JSON.stringify({ imported, commitErrors: errors })],
  )
  return { id: input.jobId, status, imported, errors }
}

export async function getImportJob(organizationId: string, jobId: string) {
  const jobs = await query<{
    id: string
    kind: string
    status: string
    file_name: string
    summary: Record<string, unknown>
    created_at: Date
  }>(
    `SELECT id, kind, status, file_name, summary, created_at
     FROM import_jobs WHERE id = $1::uuid AND organization_id = $2`,
    [jobId, organizationId],
  )
  if (!jobs[0]) throw new DomainError('IMPORT_NOT_FOUND', 'Импорт не найден', 404)
  const rows = await query<{
    id: string
    sheet_name: string
    source_row: number
    status: string
    errors: unknown
    normalized_data: unknown
    entity_id: string | null
  }>(
    `SELECT id, sheet_name, source_row, status, errors, normalized_data, entity_id
     FROM import_rows WHERE import_job_id = $1::uuid ORDER BY source_row LIMIT 500`,
    [jobId],
  )
  return { ...jobs[0], rows }
}
