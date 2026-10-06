/**
 * lib/documents/pii-mask.ts — client document text as the model may see it.
 *
 * Owner rule: personal data never go to a language model. Business figures
 * (amounts, dates, quantities, product names) must still reach it, or the
 * extraction is pointless. So:
 *
 *   tables (CSV / XLSX sheets)   identity columns — client / patient / contact
 *                                name, phone, email, IIN, address, manager —
 *                                are replaced cell by cell with stable
 *                                pseudonyms «ID-xxxxxxxx» (HMAC with a
 *                                per-run random key, so the provider cannot
 *                                brute-force phones back from the hash)
 *   everything                   emails, phones, IIN/BIN and recognisable
 *                                person names are masked (lib/ai/pii.ts)
 *
 * The pseudonym → original map stays on the server: rows the model returns
 * are mapped back with `restorePseudonyms` before they are stored, exactly
 * like rows read deterministically from the same file.
 */
import { createHmac, randomBytes } from 'node:crypto'
import { maskPersonalText } from '@/lib/ai/pii'
import { detectDelimiter, normalizePhone, parseCsvLine } from './extract-rows'
import type { StructuredText } from './text'

export type PseudonymKind = 'phone' | 'person' | 'id'

export interface Pseudonyms {
  /** «ID-xxxxxxxx» → original cell value and the kind of column it came from. */
  readonly map: Map<string, { original: string; kind: PseudonymKind }>
}

export const PSEUDONYM_RE = /ID-[0-9a-f]{8}/g

const MARKER = /^\[(Страница|Лист|Слайд|Документ)[^\]]*\]$/
/** Header words of columns that identify a person or how to reach them. */
const IDENTITY_HEADER =
  /(фио|ф\.и\.о|имя|фамили|отчеств|name|клиент|client|customer|покупател|заказчик|пациент|patient|контрагент|контакт|contact|телефон|^тел\.?$|phone|mobile|моб\.?|whatsapp|telegram|e-?mail|почта|иин|\biin\b|паспорт|passport|адрес|address|рождени|birth|менеджер|manager|ответствен|продавец|seller|сотрудник|employee|врач|doctor|login|логин)/i
/** …unless the column is a measure about them («Кол-во клиентов», «Дата первой покупки»). */
const MEASURE_HEADER =
  /(кол-?во|количеств|число|count|qty|сумм|amount|total|итог|выручк|revenue|ltv|cac|средн|avg|доля|share|%|процент|дата|date|покупк|purchase|визит|visit|orders|заказов|чек)/i
const PHONE_HEADER = /(телефон|^тел\.?$|phone|mobile|моб|whatsapp)/i
/** Title rows may precede a sheet's header row. */
const HEADER_SEARCH_LINES = 5

function isIdentityHeader(h: string): boolean {
  const s = h.trim()
  if (!s || s.length > 40) return false
  if (!IDENTITY_HEADER.test(s)) return false
  return !MEASURE_HEADER.test(s) || /рождени|birth/i.test(s)
}

function joinCsv(cells: string[], delim: string): string {
  return cells
    .map((c) => (c.includes(delim) || c.includes('"') || c.includes('\n') ? `"${c.replace(/"/g, '""')}"` : c))
    .join(delim)
}

export function newPseudonyms(): Pseudonyms {
  return { map: new Map() }
}

class Pseudonymizer {
  private readonly key = randomBytes(32)
  private readonly byValue = new Map<string, string>()

  constructor(readonly store: Pseudonyms) {}

  of(value: string, kind: PseudonymKind): string {
    const normalized = kind === 'phone'
      ? normalizePhone(value) ?? value.replace(/\D+/g, '')
      : value.trim().toLowerCase().replace(/\s+/g, ' ')
    const cacheKey = `${kind}:${normalized}`
    const known = this.byValue.get(cacheKey)
    if (known) return known
    const id = `ID-${createHmac('sha256', this.key).update(cacheKey).digest('hex').slice(0, 8)}`
    this.byValue.set(cacheKey, id)
    if (!this.store.map.has(id)) this.store.map.set(id, { original: value.trim(), kind })
    return id
  }
}

/**
 * One segment body (marker line included). `tabular` = the body is CSV-like
 * text of a spreadsheet / CSV file; only then are columns pseudonymised.
 */
function maskBody(body: string, tabular: boolean, p: Pseudonymizer): string {
  if (!tabular) return maskPersonalText(body)
  // The header is the first of the leading lines that names identity columns.
  let header: { delim: string; width: number; identity: Map<number, PseudonymKind> } | null = null
  let looked = 0
  const out = body.split('\n').map((line) => {
    const trimmed = line.trim()
    if (!trimmed || MARKER.test(trimmed)) return line
    if (!header && looked < HEADER_SEARCH_LINES) {
      looked += 1
      const delim = detectDelimiter(trimmed)
      const cells = parseCsvLine(trimmed, delim)
      const identity = new Map<number, PseudonymKind>()
      cells.forEach((c, i) => {
        if (isIdentityHeader(c)) identity.set(i, PHONE_HEADER.test(c) ? 'phone' : /id\b|_id|код|номер/i.test(c) ? 'id' : 'person')
      })
      if (identity.size && cells.filter(Boolean).length >= 2) header = { delim, width: cells.length, identity }
      return maskPersonalText(line)
    }
    if (!header) return maskPersonalText(line)
    const h = header
    const cells = parseCsvLine(trimmed, h.delim)
    if (cells.length !== h.width) return maskPersonalText(line)
    const replaced = cells.map((c, i) => {
      const kind = h.identity.get(i)
      return kind && c ? p.of(c, kind) : c
    })
    return maskPersonalText(joinCsv(replaced, h.delim))
  })
  return out.join('\n')
}

/**
 * The document as the model may see it: same segments (pages / sheets /
 * slides), offsets recomputed for the masked text.
 */
export function maskStructuredText(
  st: StructuredText,
  opts: { tabular: boolean; pseudonyms?: Pseudonyms },
): { st: StructuredText; pseudonyms: Pseudonyms } {
  const pseudonyms = opts.pseudonyms ?? newPseudonyms()
  const p = new Pseudonymizer(pseudonyms)
  const parts: string[] = []
  const segments: StructuredText['segments'] = []
  let pos = 0
  let length = 0
  const push = (s: string) => {
    parts.push(s)
    length += s.length
  }
  for (const seg of st.segments) {
    if (seg.start > pos) push(maskPersonalText(st.text.slice(pos, seg.start)))
    const start = length
    push(maskBody(st.text.slice(seg.start, seg.end), opts.tabular, p))
    segments.push({ ...seg, start, end: length })
    pos = seg.end
  }
  if (pos < st.text.length) push(maskPersonalText(st.text.slice(pos)))
  return { st: { ...st, text: parts.join(''), segments }, pseudonyms }
}

/** Plain text (legacy extraction paths): same masking, one section. */
export function maskDocumentText(text: string, opts: { tabular: boolean; pseudonyms?: Pseudonyms }): { text: string; pseudonyms: Pseudonyms } {
  const pseudonyms = opts.pseudonyms ?? newPseudonyms()
  return { text: maskBody(text, opts.tabular, new Pseudonymizer(pseudonyms)), pseudonyms }
}

/** Replace every pseudonym in `value` with the original it stands for. */
export function restorePseudonyms(value: string, pseudonyms: Pseudonyms): string {
  return value.replace(PSEUDONYM_RE, (id) => pseudonyms.map.get(id)?.original ?? id)
}

/**
 * A client id the model returned, mapped back: a phone pseudonym becomes the
 * normalised phone (as the deterministic CSV path stores it).
 */
export function restoreClientId(value: string, pseudonyms: Pseudonyms): string {
  const whole = value.trim()
  const hit = pseudonyms.map.get(whole)
  if (hit) return hit.kind === 'phone' ? normalizePhone(hit.original) ?? hit.original : hit.original
  return restorePseudonyms(value, pseudonyms)
}
