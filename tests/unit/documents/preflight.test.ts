/**
 * lib/documents/preflight.ts against a corpus generated in-test: real files
 * (pdfkit PDF, SheetJS XLSX, hand-built DOCX/PPTX) and hostile ones (renamed
 * executable, zip bomb, lying ZIP directory, XML entities, PDF JavaScript —
 * plain, hex-escaped and hidden in an object stream, macros, encryption).
 */
import { deflateSync } from 'node:zlib'
import PDFDocument from 'pdfkit'
import * as XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'
import { decodeText, documentMaxBytes, preflightDocument } from '@/lib/documents/preflight'
import { buildDocx, buildPptx, buildZip } from '../../helpers/zip-builder'

function makePdf(text: string): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument()
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.text(text)
    doc.end()
  })
}

function makeXlsx(rows: unknown[][]): Buffer {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'P&L')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

function rawPdf(body: string): Buffer {
  return Buffer.from(`%PDF-1.7\n${body}\ntrailer << /Root 1 0 R >>\n%%EOF\n`, 'latin1')
}

function png(width: number, height: number): Buffer {
  const b = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0)
  b.writeUInt32BE(13, 8)
  b.write('IHDR', 12, 'latin1')
  b.writeUInt32BE(width, 16)
  b.writeUInt32BE(height, 20)
  return b
}

const expectRejected = (r: ReturnType<typeof preflightDocument>, code: string) => {
  expect(r.ok).toBe(false)
  if (!r.ok) expect(r.code).toBe(code)
  return r
}

describe('preflightDocument — accepted files', () => {
  it('accepts a real PDF and counts its pages', async () => {
    const r = preflightDocument(await makePdf('Выручка 12 500 000'), 'P&L 2025.pdf')
    expect(r).toMatchObject({ ok: true, kind: 'pdf', mime: 'application/pdf', ext: 'pdf' })
    if (r.ok) expect(r.meta.pages).toBe(1)
  })

  it('accepts an XLSX written by SheetJS', () => {
    const r = preflightDocument(makeXlsx([['Показатель', 'Значение'], ['Выручка', 1000]]), 'pnl.xlsx')
    expect(r).toMatchObject({ ok: true, kind: 'xlsx' })
    if (r.ok) expect(r.meta.zipEntries).toBeGreaterThan(3)
  })

  it('accepts DOCX and PPTX shells', () => {
    expect(preflightDocument(buildDocx(['Выручка 100']), 'plan.docx')).toMatchObject({ ok: true, kind: 'docx' })
    expect(preflightDocument(buildPptx([['Слайд 1']]), 'deck.pptx')).toMatchObject({ ok: true, kind: 'pptx' })
  })

  it('accepts an XLSX saved with the .xls extension and a TSV export named .xls', () => {
    expect(preflightDocument(makeXlsx([['a', 1]]), 'old.xls')).toMatchObject({ ok: true, kind: 'xlsx' })
    const tsv = preflightDocument(Buffer.from('Дата\tСумма\n2025-01-01\t100\n'), 'bank.xls')
    expect(tsv).toMatchObject({ ok: true, kind: 'xls' })
  })

  it('accepts CSV in UTF-8, UTF-8 with BOM, UTF-16LE and Windows-1251', () => {
    const utf8 = Buffer.from('Клиент;Сумма\nИванов;100\n', 'utf8')
    expect(preflightDocument(utf8, 'sales.csv')).toMatchObject({ ok: true, kind: 'csv', meta: { encoding: 'utf-8' } })
    const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), utf8])
    expect(preflightDocument(bom, 'sales.csv')).toMatchObject({ ok: true, meta: { encoding: 'utf-8-bom' } })
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Клиент\tСумма\n', 'utf16le')])
    expect(preflightDocument(utf16, 'sales.txt')).toMatchObject({ ok: true, kind: 'txt', meta: { encoding: 'utf-16le' } })
    // "Выручка;100" in Windows-1251
    const win = Buffer.from([0xc2, 0xfb, 0xf0, 0xf3, 0xf7, 0xea, 0xe0, 0x3b, 0x31, 0x30, 0x30, 0x0a])
    const r = preflightDocument(win, '1c.csv')
    expect(r).toMatchObject({ ok: true, meta: { encoding: 'windows-1251' } })
    expect(decodeText(win)?.text).toBe('Выручка;100\n')
  })

  it('accepts PNG / JPEG within pixel limits', () => {
    expect(preflightDocument(png(800, 600), 'scan.png')).toMatchObject({ ok: true, kind: 'image', mime: 'image/png' })
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x58, 0x03, 0x20, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9])
    expect(preflightDocument(jpeg, 'photo.jpg')).toMatchObject({ ok: true, kind: 'image', mime: 'image/jpeg', meta: { width: 800, height: 600 } })
  })

  it('does not flag "/JS" bytes that occur inside compressed stream data', () => {
    const noise = Buffer.from('xx/JS)yy/Launch zz', 'latin1')
    const pdf = Buffer.concat([
      Buffer.from('%PDF-1.7\n1 0 obj << /Length 18 /Filter /FlateDecode >>\nstream\n', 'latin1'),
      noise,
      Buffer.from('\nendstream\nendobj\n%%EOF\n', 'latin1'),
    ])
    expect(preflightDocument(pdf, 'ok.pdf')).toMatchObject({ ok: true, kind: 'pdf' })
  })
})

describe('preflightDocument — rejected files', () => {
  it('rejects empty and oversized files', () => {
    expectRejected(preflightDocument(Buffer.alloc(0), 'a.pdf'), 'EMPTY')
    expectRejected(preflightDocument(Buffer.alloc(2048, 0x41), 'a.txt', { maxBytes: 1024 }), 'TOO_LARGE')
  })

  it('caps size with DOCUMENT_MAX_BYTES (25 MB by default)', () => {
    const before = process.env.DOCUMENT_MAX_BYTES
    try {
      delete process.env.DOCUMENT_MAX_BYTES
      expect(documentMaxBytes()).toBe(25 * 1024 * 1024)
      process.env.DOCUMENT_MAX_BYTES = '100'
      expect(documentMaxBytes()).toBe(100)
      expectRejected(preflightDocument(Buffer.alloc(101, 0x41), 'a.txt'), 'TOO_LARGE')
    } finally {
      if (before === undefined) delete process.env.DOCUMENT_MAX_BYTES
      else process.env.DOCUMENT_MAX_BYTES = before
    }
  })

  it('rejects a renamed executable', () => {
    const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200)])
    const r = expectRejected(preflightDocument(exe, 'report.pdf'), 'EXECUTABLE')
    if (!r.ok) expect(r.reason).toMatch(/исполняемый/)
    expectRejected(preflightDocument(Buffer.from('#!/bin/sh\nrm -rf /\n'), 'data.csv'), 'EXECUTABLE')
  })

  it('rejects extension / content disagreement', async () => {
    expectRejected(preflightDocument(await makePdf('x'), 'table.xlsx'), 'MIME_MISMATCH')
    const r = expectRejected(preflightDocument(makeXlsx([['a', 1]]), 'letter.docx'), 'MIME_MISMATCH')
    if (!r.ok) expect(r.reason).toMatch(/XLSX/)
    expectRejected(preflightDocument(Buffer.from('plain text'), 'scan.png'), 'MIME_MISMATCH')
    expectRejected(preflightDocument(Buffer.from([0x52, 0x61, 0x72, 0x21, 0, 1, 2]), 'x.xlsx'), 'MIME_MISMATCH')
  })

  it('rejects unsupported and legacy formats with a hint', () => {
    const r = expectRejected(preflightDocument(Buffer.from('x'), 'old.doc'), 'UNSUPPORTED_TYPE')
    if (!r.ok) expect(r.reason).toMatch(/DOCX/)
    expectRejected(preflightDocument(Buffer.from('x'), 'virus.exe'), 'UNSUPPORTED_TYPE')
    expectRejected(preflightDocument(Buffer.from('x'), 'noextension'), 'UNSUPPORTED_TYPE')
  })

  it('rejects a zip bomb (compression ratio) before inflating it', () => {
    const bomb = buildZip([
      { name: '[Content_Types].xml', data: '<Types/>' },
      { name: 'xl/workbook.xml', data: '<workbook/>' },
      { name: 'xl/worksheets/sheet1.xml', data: Buffer.alloc(30 * 1024 * 1024, 0x20) },
    ])
    expect(bomb.length).toBeLessThan(200 * 1024)
    const r = expectRejected(preflightDocument(bomb, 'bomb.xlsx'), 'ZIP_BOMB')
    if (!r.ok) expect(r.reason).toMatch(/сжатия|лимит/)
  })

  it('rejects an archive whose central directory understates sizes', () => {
    const liar = buildZip([
      { name: '[Content_Types].xml', data: '<Types/>' },
      { name: 'word/document.xml', data: Buffer.alloc(200_000, 0x41), declaredSize: 2_000 },
    ])
    expectRejected(preflightDocument(liar, 'liar.docx'), 'ZIP_BOMB')
  })

  it('rejects XML entity declarations (billion laughs / XXE)', () => {
    const lol = '<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;">]><w:document>&lol2;</w:document>'
    const docx = buildZip([
      { name: '[Content_Types].xml', data: '<Types/>' },
      { name: 'word/document.xml', data: lol },
    ])
    const r = expectRejected(preflightDocument(docx, 'evil.docx'), 'XML_ENTITY')
    if (!r.ok) expect(r.reason).toMatch(/DOCTYPE/)
  })

  it('rejects macro-enabled and encrypted Office files', () => {
    const macro = buildZip([
      { name: '[Content_Types].xml', data: '<Types/>' },
      { name: 'xl/workbook.xml', data: '<workbook/>' },
      { name: 'xl/vbaProject.bin', data: Buffer.alloc(64, 1) },
    ])
    expectRejected(preflightDocument(macro, 'm.xlsx'), 'MACRO_ENABLED')
    const encryptedEntry = buildZip([
      { name: '[Content_Types].xml', data: '<Types/>', encrypted: true },
      { name: 'word/document.xml', data: '<w/>' },
    ])
    expectRejected(preflightDocument(encryptedEntry, 'locked.docx'), 'ENCRYPTED')
    const ole = Buffer.concat([
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
      Buffer.alloc(100),
      Buffer.from('EncryptedPackage', 'utf16le'),
    ])
    expectRejected(preflightDocument(ole, 'locked.xlsx'), 'ENCRYPTED')
  })

  it('rejects unsafe ZIP paths', () => {
    const slip = buildZip([
      { name: '[Content_Types].xml', data: '<Types/>' },
      { name: 'word/../../etc/passwd', data: 'x' },
    ])
    expectRejected(preflightDocument(slip, 'slip.docx'), 'ZIP_INVALID')
    expectRejected(preflightDocument(Buffer.from('PK\u0003\u0004 not really a zip'), 'broken.docx'), 'ZIP_INVALID')
  })

  it('rejects PDF active content: plain, hex-escaped names and inside object streams', () => {
    expectRejected(preflightDocument(rawPdf('1 0 obj << /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >> endobj'), 'a.pdf'), 'PDF_ACTIVE_CONTENT')
    expectRejected(preflightDocument(rawPdf('1 0 obj << /S /J#61vaScript >> endobj'), 'b.pdf'), 'PDF_ACTIVE_CONTENT')
    expectRejected(preflightDocument(rawPdf('1 0 obj << /S /Launch /F (cmd.exe) >> endobj'), 'c.pdf'), 'PDF_ACTIVE_CONTENT')
    expectRejected(preflightDocument(rawPdf('1 0 obj << /Names << /EmbeddedFiles 2 0 R >> >> endobj'), 'd.pdf'), 'PDF_ACTIVE_CONTENT')

    const hidden = deflateSync(Buffer.from('5 0 << /S /JavaScript /JS (this.exportDataObject()) >>', 'latin1'))
    const objstm = Buffer.concat([
      Buffer.from(`%PDF-1.7\n3 0 obj << /Type /ObjStm /N 1 /First 4 /Length ${hidden.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'),
      hidden,
      Buffer.from('\nendstream\nendobj\n%%EOF\n', 'latin1'),
    ])
    const r = expectRejected(preflightDocument(objstm, 'e.pdf'), 'PDF_ACTIVE_CONTENT')
    if (!r.ok) expect(r.reason).toMatch(/JavaScript/)
  })

  it('flags (but accepts) benign PDF features', () => {
    const r = preflightDocument(rawPdf('1 0 obj << /OpenAction [3 0 R /Fit] >> endobj'), 'f.pdf')
    expect(r).toMatchObject({ ok: true })
    if (r.ok) expect(r.flags).toContain('pdf_open_action')
  })

  it('rejects text with binary bytes or an unknown encoding', () => {
    expectRejected(preflightDocument(Buffer.from([0x41, 0, 0x42]), 'a.csv'), 'BINARY_TEXT')
    expectRejected(preflightDocument(Buffer.from([0x41, 0x80, 0x81, 0x82, 0x83, 0x42]), 'a.csv'), 'TEXT_ENCODING')
  })

  it('rejects decompression-bomb images', () => {
    expectRejected(preflightDocument(png(50_000, 50_000), 'huge.png'), 'IMAGE_TOO_LARGE')
  })
})
