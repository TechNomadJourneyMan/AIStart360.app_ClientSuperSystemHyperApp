import { describe, expect, it } from 'vitest'
import { MAX_STORE_FILE_BYTES, readStoreImportForm } from '@/lib/store/import/request-body'

describe('readStoreImportForm', () => {
  it('keeps the original file and control fields', async () => {
    const form = new FormData()
    form.set('file', new File(['example'], 'sample.csv'))
    form.set('expectedKind', 'prices')
    const result = await readStoreImportForm(new Request('https://example.test', { body: form, method: 'POST' }))
    if (!('form' in result)) throw new Error('Expected a parsed form')
    expect(result.form.get('expectedKind')).toBe('prices')
    expect(await (result.form.get('file') as File).text()).toBe('example')
  })

  it('rejects an oversize request even with no Content-Length', async () => {
    const upload = new Uint8Array(MAX_STORE_FILE_BYTES + 300 * 1024)
    const request = new Request('https://example.test', {
      body: upload,
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data; boundary=test-boundary' },
    })
    expect(request.headers.get('content-length')).toBeNull()
    expect(await readStoreImportForm(request)).toMatchObject({ status: 413 })
  })
})
