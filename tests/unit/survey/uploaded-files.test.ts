import { describe, it, expect } from 'vitest'
import { mergeS1Files, s1EntryFromDocument, s1FileRef, s1StoredFiles, type S1StoredFile } from '@/lib/survey/uploaded-files'
import { fileHref } from '@/lib/documents/survey-files'

const UID = '0b6f6f0e-3c1a-4a4b-9a55-2a8f0d3f7c11'

const legacy: S1StoredFile = {
  path: `${UID}/sales_report/1760000000000_sales.xlsx`,
  name: 'sales.xlsx',
  size: 1024,
  kind: 'sales_report',
  uploaded_at: '2026-10-01T00:00:00.000Z',
}

describe('step-1 file cards (s1_uploaded_files)', () => {
  it('keeps well-formed entries only', () => {
    expect(s1StoredFiles(null)).toEqual([])
    expect(s1StoredFiles('x')).toEqual([])
    expect(s1StoredFiles([legacy, { path: 1 }, null, { ...legacy, kind: 'other' }])).toEqual([legacy])
  })

  it('an uploaded document becomes an entry with its id and storage location — never a URL', () => {
    const entry = s1EntryFromDocument(
      { id: 'doc-1', file_name: 'Продажи 2024.xlsx', file_size: 2048, storage_bucket: 'client-documents', storage_path: `${UID}/abc.xlsx` },
      { name: 'local.xlsx', size: 1 },
      'crm_export',
      new Date('2026-10-23T10:00:00Z'),
    )
    expect(entry).toEqual({
      document_id: 'doc-1',
      bucket: 'client-documents',
      path: `${UID}/abc.xlsx`,
      name: 'Продажи 2024.xlsx',
      size: 2048,
      kind: 'crm_export',
      uploaded_at: '2026-10-23T10:00:00.000Z',
    })
    expect(JSON.stringify(entry)).not.toMatch(/https?:/)
  })

  it('no entry without a storage path', () => {
    expect(s1EntryFromDocument({ id: 'd', file_name: 'a.pdf', storage_path: null }, { name: 'a.pdf', size: 1 }, 'sales_report')).toBeNull()
  })

  it('a duplicate upload of the same document is not listed twice', () => {
    const a = s1EntryFromDocument({ id: 'doc-1', file_name: 'a.pdf', storage_path: `${UID}/a.pdf` }, { name: 'a.pdf', size: 1 }, 'sales_report')!
    const merged = mergeS1Files([legacy, a], [{ ...a, uploaded_at: 'later' }])
    expect(merged).toHaveLength(2)
    expect(mergeS1Files([legacy], [a])).toEqual([legacy, a])
  })

  it('opens through the access-checked route; old entries default to client-documents', () => {
    const ref = s1FileRef(legacy)
    expect(ref).toEqual({ bucket: 'client-documents', path: legacy.path })
    expect(fileHref(ref!)).toBe(`/api/v1/files/documents?bucket=client-documents&path=${encodeURIComponent(legacy.path)}`)
  })

  it('no link for paths outside an owner folder, traversal or unknown buckets', () => {
    expect(s1FileRef({ ...legacy, path: 'root-level.pdf' })).toBeNull()
    expect(s1FileRef({ ...legacy, path: `${UID}/../x.pdf` })).toBeNull()
    expect(s1FileRef({ ...legacy, bucket: 'cms-media' })).toBeNull()
  })
})
