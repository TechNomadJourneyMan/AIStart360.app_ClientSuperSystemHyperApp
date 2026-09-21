/**
 * lib/admin/csv.ts — выгрузка таблиц из панели.
 *
 * Формат намеренно «экселевский»: BOM в начале и точка с запятой как
 * разделитель. Без BOM Excel открывает кириллицу кракозябрами, а с запятой в
 * русской локали всё валится в одну колонку. Google Sheets и LibreOffice
 * определяют разделитель сами, так что страдающих нет.
 */

const SEP = ';'

/** Экранирование по RFC 4180 + защита от формул (=, +, -, @ в начале ячейки). */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  let text = String(value)
  // Ячейка, начинающаяся со знака формулы, исполняется при открытии файла —
  // это старый трюк CSV-инъекции. Обезвреживаем апострофом.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /["\n\r;,]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function toCsv(headers: string[], rows: Array<Array<unknown>>): string {
  const lines = [headers.map(csvCell).join(SEP), ...rows.map((r) => r.map(csvCell).join(SEP))]
  return `﻿${lines.join('\r\n')}\r\n`
}

/** Имя файла с датой — чтобы выгрузки не перезаписывали друг друга. */
export function csvFilename(prefix: string): string {
  const d = new Date().toISOString().slice(0, 10)
  return `${prefix}-${d}.csv`
}

export function csvResponse(body: string, filename: string): Response {
  return new Response(body, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  })
}
