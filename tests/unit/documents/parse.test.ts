import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import PDFDocument from 'pdfkit'
import JSZip from 'jszip'
import {
  detectDocumentType,
  parseDocument,
} from '@/lib/documents/parse'

function makePdf(text: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument()
    const chunks: Buffer[] = []
    doc.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    doc.text(text)
    doc.end()
  })
}

async function makeDocx(text: string): Promise<Buffer> {
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8"?>
    <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Default Extension="xml" ContentType="application/xml"/>
      <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
    </Types>`,
  )
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
    </Relationships>`,
  )
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body>
    </w:document>`,
  )
  return zip.generateAsync({ type: 'nodebuffer' })
}

async function makePptx(slides: string[]): Promise<Buffer> {
  const zip = new JSZip()
  slides.forEach((text, index) => {
    zip.file(
      `ppt/slides/slide${index + 1}.xml`,
      `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:cSld><a:t>${text}</a:t></p:cSld>
      </p:sld>`,
    )
  })
  return zip.generateAsync({ type: 'nodebuffer' })
}

describe('parseDocument', () => {
  const previousOcr = process.env.ENABLE_DOCUMENT_OCR

  beforeEach(() => {
    process.env.ENABLE_DOCUMENT_OCR = 'false'
  })

  afterEach(() => {
    if (previousOcr === undefined) delete process.env.ENABLE_DOCUMENT_OCR
    else process.env.ENABLE_DOCUMENT_OCR = previousOcr
  })

  it('detects both legacy XLS and XLSX files', () => {
    expect(detectDocumentType('finance.xls')).toBe('xlsx')
    expect(detectDocumentType('finance.xlsx')).toBe('xlsx')
    expect(detectDocumentType('export.csv?download=1')).toBe('csv')
  })

  it.each(['xlsx', 'xls'] as const)('extracts spreadsheet cells from %s', async (extension) => {
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ['Клиент', 'Сумма'],
        ['A-1', 125000],
      ]),
      'Продажи',
    )
    const buffer = XLSX.write(workbook, {
      type: 'buffer',
      bookType: extension === 'xls' ? 'biff8' : 'xlsx',
    }) as Buffer

    const parsed = await parseDocument(buffer, `sales.${extension}`)

    expect(parsed.metadata.type).toBe('xlsx')
    expect(parsed.text).toContain('[Sheet: Продажи]')
    expect(parsed.text).toContain('A-1')
    expect(parsed.text).toContain('125000')
  })

  it('decodes UTF-16LE CSV exports and removes the BOM', async () => {
    const body = Buffer.from('Клиент;Сумма\r\nA-1;42000', 'utf16le')
    const parsed = await parseDocument(
      Buffer.concat([Buffer.from([0xff, 0xfe]), body]),
      'crm.csv',
      'text/csv',
    )

    expect(parsed.text).toBe('Клиент;Сумма\r\nA-1;42000')
    expect(parsed.metadata.wordCount).toBe(2)
  })

  it('uses the installed pdf-parse v2 class API', async () => {
    const buffer = await makePdf('AIStart360 revenue report 2025')
    const parsed = await parseDocument(buffer, 'report.pdf', 'application/pdf')

    expect(parsed.metadata.type).toBe('pdf')
    expect(parsed.metadata.pages).toBe(1)
    expect(parsed.text).toContain('AIStart360 revenue report 2025')
  })

  it('extracts text from a DOCX package', async () => {
    const parsed = await parseDocument(
      await makeDocx('Чистая прибыль 12 500 000 тенге'),
      'report.docx',
    )

    expect(parsed.metadata.type).toBe('docx')
    expect(parsed.text).toContain('Чистая прибыль 12 500 000 тенге')
  })

  it('extracts ordered slide text and XML entities from PPTX', async () => {
    const parsed = await parseDocument(
      await makePptx(['Выручка &amp; маржа', 'Риски и зоны роста']),
      'strategy.pptx',
    )

    expect(parsed.metadata).toMatchObject({ type: 'pptx', pages: 2 })
    expect(parsed.text).toContain('[Slide 1]\nВыручка & маржа')
    expect(parsed.text).toContain('[Slide 2]\nРиски и зоны роста')
  })

  it.each([
    ['notes.txt', 'text/plain', 'Текстовый отчёт'],
    ['notes.md', 'text/markdown', '# Markdown отчёт'],
  ])('extracts plain text from %s', async (fileName, mimeType, text) => {
    const parsed = await parseDocument(Buffer.from(text), fileName, mimeType)
    expect(parsed.text).toBe(text)
  })
})
