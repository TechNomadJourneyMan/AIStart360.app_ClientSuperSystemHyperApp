/**
 * Browser upload contract (lib/documents/client-upload.ts) with an injected
 * Supabase client and fetch: private bucket + own folder path, the finalize
 * body, and every server answer mapped to a typed result with a Russian
 * message. Also: the client allowlist / size cap agree with the server.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  CLIENT_DOCUMENT_BUCKET,
  CLIENT_DOCUMENT_EXTENSIONS,
  CLIENT_DOCUMENT_MAX_BYTES,
  checkClientFile,
  deleteClientDocument,
  documentDownloadUrl,
  fetchClientDocuments,
  httpErrorMessage,
  reprocessClientDocument,
  uploadClientDocument,
  type UploadSupabaseLike,
} from '@/lib/documents/client-upload'
import { DOCUMENT_TYPE_GROUPS, DOCUMENT_TYPE_LABELS, documentTypeLabel } from '@/lib/documents/doc-type-labels'
import { DOCUMENT_TYPES } from '@/lib/documents/doc-types'
import { DEFAULT_DOCUMENT_MAX_BYTES, preflightDocument } from '@/lib/documents/preflight'
import { UPLOAD_BUCKET } from '@/lib/documents/storage'

const USER = '11111111-1111-4111-8111-111111111111'
const UUID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

function fakeSupabase(opts: {
  user?: { id: string } | null
  uploadError?: { message: string; statusCode?: string } | null
  uploadThrows?: boolean
  removeError?: { message: string } | null
  signed?: string | null
} = {}) {
  const calls = { upload: [] as Array<{ bucket: string; path: string; opts: unknown }>, remove: [] as Array<{ bucket: string; paths: string[] }>, sign: [] as Array<{ bucket: string; path: string; expires: number }> }
  const sb: UploadSupabaseLike = {
    auth: {
      getUser: async () => ({ data: { user: opts.user === undefined ? { id: USER } : opts.user }, error: null }),
    },
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, _file: File | Blob, o?: unknown) => {
          calls.upload.push({ bucket, path, opts: o })
          if (opts.uploadThrows) throw new TypeError('Failed to fetch')
          return opts.uploadError ? { data: null, error: opts.uploadError } : { data: { path }, error: null }
        },
        remove: async (paths: string[]) => {
          calls.remove.push({ bucket, paths })
          return { data: null, error: opts.removeError ?? null }
        },
        createSignedUrl: async (path: string, expires: number) => {
          calls.sign.push({ bucket, path, expires })
          return opts.signed ? { data: { signedUrl: opts.signed }, error: null } : { data: null, error: { message: 'Object not found' } }
        },
      }),
    },
  }
  return { sb, calls }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function fakeFetch(response: Response | (() => Promise<Response>)) {
  return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    typeof response === 'function' ? response() : response)
}

const file = (name = 'P&L 2025.xlsx', size = 1000) => new File([new Uint8Array(size)], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })

const DOC = { id: 'doc-1', file_name: 'P&L 2025.xlsx', doc_type: 'pl_report', parse_status: 'queued', processing_stage: 'validated' }

describe('uploadClientDocument', () => {
  it('uploads to the private bucket in the user folder and finalizes with the contract body', async () => {
    const { sb, calls } = fakeSupabase()
    const f = fakeFetch(jsonResponse(201, { ok: true, duplicate: false, data: DOC }))
    const phases: string[] = []
    const res = await uploadClientDocument(file(), {
      docType: 'pl_report',
      period: { quarter: 'Q2', year: 2025 },
      companyId: 'company-a',
      onPhase: (p) => phases.push(p),
    }, { supabase: sb, fetch: f, uuid: () => UUID })

    expect(res).toEqual({ kind: 'created', document: DOC })
    expect(phases).toEqual(['storage', 'register'])
    expect(calls.upload).toHaveLength(1)
    expect(calls.upload[0].bucket).toBe('client-documents')
    expect(calls.upload[0].path).toBe(`${USER}/${UUID}.xlsx`)
    expect(calls.upload[0].opts).toMatchObject({ upsert: false })

    expect(f).toHaveBeenCalledTimes(1)
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('/api/v1/documents')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({
      storage_path: `${USER}/${UUID}.xlsx`,
      bucket: 'client-documents',
      file_name: 'P&L 2025.xlsx',
      doc_type: 'pl_report',
      period: { quarter: 'Q2', year: 2025 },
      company_id: 'company-a',
    })
    expect(calls.remove).toHaveLength(0)
  })

  it('omits an empty period and company', async () => {
    const { sb } = fakeSupabase()
    const f = fakeFetch(jsonResponse(201, { ok: true, duplicate: false, data: DOC }))
    await uploadClientDocument(file('a.PDF'), { docType: 'other', period: { quarter: null, year: null } }, { supabase: sb, fetch: f, uuid: () => UUID })
    const body = JSON.parse(String(f.mock.calls[0][1]?.body))
    expect(body).toEqual({ storage_path: `${USER}/${UUID}.pdf`, bucket: 'client-documents', file_name: 'a.PDF', doc_type: 'other' })
  })

  it('200 duplicate → «Такой файл уже загружен» with the existing document', async () => {
    const { sb } = fakeSupabase()
    const existing = { ...DOC, id: 'old', parse_status: 'parsed' }
    const res = await uploadClientDocument(file(), { docType: 'pl_report' }, {
      supabase: sb, fetch: fakeFetch(jsonResponse(200, { ok: true, duplicate: true, data: existing })), uuid: () => UUID,
    })
    expect(res).toEqual({ kind: 'duplicate', document: existing, message: 'Такой файл уже загружен' })
  })

  it('422 rejected → the server reason and the rejected row; object is not touched by the client', async () => {
    const { sb, calls } = fakeSupabase()
    const rejected = { ...DOC, parse_status: 'rejected', security_status: 'rejected' }
    const res = await uploadClientDocument(file(), { docType: 'pl_report' }, {
      supabase: sb,
      fetch: fakeFetch(jsonResponse(422, { ok: false, rejected: true, code: 'MACRO_ENABLED', error: 'Файл содержит макросы.', data: rejected })),
      uuid: () => UUID,
    })
    expect(res).toEqual({ kind: 'rejected', document: rejected, code: 'MACRO_ENABLED', error: 'Файл содержит макросы.' })
    expect(calls.remove).toHaveLength(0)
  })

  it('409 NO_COMPANY → server message, code kept, orphan object removed', async () => {
    const { sb, calls } = fakeSupabase()
    const res = await uploadClientDocument(file(), { docType: 'pl_report' }, {
      supabase: sb,
      fetch: fakeFetch(jsonResponse(409, { ok: false, code: 'NO_COMPANY', error: 'Сначала заполните данные компании — документы привязываются к компании.' })),
      uuid: () => UUID,
    })
    expect(res).toEqual({
      kind: 'failed', stage: 'register', status: 409, code: 'NO_COMPANY',
      error: 'Сначала заполните данные компании — документы привязываются к компании.',
    })
    expect(calls.remove).toEqual([{ bucket: 'client-documents', paths: [`${USER}/${UUID}.xlsx`] }])
  })

  it.each([
    [400, { ok: false, code: 'BAD_REQUEST', error: 'Неизвестный тип документа.' }, 'Неизвестный тип документа.', true],
    [403, { ok: false, code: 'FORBIDDEN', error: 'Роль «наблюдатель» не может загружать документы.' }, 'Роль «наблюдатель» не может загружать документы.', true],
    [429, { ok: false, code: 'RATE_LIMITED', error: 'Слишком много загрузок. Попробуйте через минуту.' }, 'Слишком много загрузок. Попробуйте через минуту.', true],
    [401, { ok: false, code: 'UNAUTHENTICATED', error: 'Требуется вход в систему' }, 'Сессия истекла — войдите в систему снова.', true],
    [404, { ok: false, code: 'NOT_FOUND', error: 'Файл не найден в хранилище. Загрузите его заново.' }, 'Файл не найден в хранилище. Загрузите его заново.', false],
    [503, { ok: false, code: 'STORAGE_UNAVAILABLE', error: 'Хранилище временно недоступно. Повторите попытку.' }, 'Хранилище временно недоступно. Повторите попытку.', false],
  ] as const)('HTTP %i → failed/register with a Russian message', async (status, body, message, cleaned) => {
    const { sb, calls } = fakeSupabase()
    const res = await uploadClientDocument(file(), { docType: 'pl_report' }, {
      supabase: sb, fetch: fakeFetch(jsonResponse(status, body)), uuid: () => UUID,
    })
    expect(res).toEqual({ kind: 'failed', stage: 'register', status, code: body.code, error: message })
    expect(calls.remove.length > 0).toBe(cleaned)
  })

  it('non-JSON error page → status-based Russian message', async () => {
    const { sb } = fakeSupabase()
    const res = await uploadClientDocument(file(), { docType: 'pl_report' }, {
      supabase: sb, fetch: fakeFetch(new Response('<html>Bad gateway</html>', { status: 502 })), uuid: () => UUID,
    })
    expect(res).toEqual({ kind: 'failed', stage: 'register', status: 502, code: 'HTTP_502', error: 'Ошибка сервера (HTTP 502).' })
  })

  it('network failure on finalize keeps the object (the server may have registered it)', async () => {
    const { sb, calls } = fakeSupabase()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await uploadClientDocument(file(), { docType: 'pl_report' }, {
      supabase: sb, fetch: vi.fn(async () => { throw new TypeError('Failed to fetch') }), uuid: () => UUID,
    })
    warn.mockRestore()
    expect(res).toMatchObject({ kind: 'failed', stage: 'register', status: null, code: 'NETWORK' })
    expect(calls.remove).toHaveLength(0)
  })

  it('storage errors are reported, finalize is not called', async () => {
    const f = fakeFetch(jsonResponse(201, { ok: true, data: DOC }))
    const rls = fakeSupabase({ uploadError: { message: 'new row violates row-level security policy', statusCode: '403' } })
    expect(await uploadClientDocument(file(), { docType: 'pl_report' }, { supabase: rls.sb, fetch: f, uuid: () => UUID })).toEqual({
      kind: 'failed', stage: 'storage', status: null, code: 'STORAGE_UPLOAD',
      error: 'Нет доступа к хранилищу документов. Войдите в систему снова и повторите.',
    })
    const net = fakeSupabase({ uploadThrows: true })
    expect(await uploadClientDocument(file(), { docType: 'pl_report' }, { supabase: net.sb, fetch: f, uuid: () => UUID })).toMatchObject({
      kind: 'failed', stage: 'storage', error: 'Нет связи с хранилищем. Проверьте подключение и повторите.',
    })
    expect(f).not.toHaveBeenCalled()
  })

  it('no session → auth failure before any upload', async () => {
    const { sb, calls } = fakeSupabase({ user: null })
    const f = fakeFetch(jsonResponse(201, { ok: true, data: DOC }))
    const res = await uploadClientDocument(file(), { docType: 'pl_report' }, { supabase: sb, fetch: f })
    expect(res).toMatchObject({ kind: 'failed', stage: 'auth', status: 401, code: 'UNAUTHENTICATED' })
    expect(calls.upload).toHaveLength(0)
    expect(f).not.toHaveBeenCalled()
  })

  it('validation: doc type is required and must be a known value; size and format are checked first', async () => {
    const { sb, calls } = fakeSupabase()
    const f = fakeFetch(jsonResponse(201, { ok: true, data: DOC }))
    const deps = { supabase: sb, fetch: f }
    expect(await uploadClientDocument(file(), { docType: '' }, deps)).toMatchObject({ kind: 'failed', stage: 'validation', code: 'BAD_DOC_TYPE' })
    expect(await uploadClientDocument(file(), { docType: 'invoice' }, deps)).toMatchObject({ kind: 'failed', stage: 'validation', code: 'BAD_DOC_TYPE' })
    expect(await uploadClientDocument(file('a.doc'), { docType: 'other' }, deps)).toMatchObject({
      kind: 'failed', stage: 'validation', error: 'Формат .doc (Word 97–2003) не поддерживается — сохраните документ как DOCX или PDF.',
    })
    expect(calls.upload).toHaveLength(0)
    expect(f).not.toHaveBeenCalled()
  })
})

describe('checkClientFile', () => {
  it('caps at 25 MB like the server default', () => {
    expect(CLIENT_DOCUMENT_MAX_BYTES).toBe(DEFAULT_DOCUMENT_MAX_BYTES)
    expect(CLIENT_DOCUMENT_MAX_BYTES).toBe(25 * 1024 * 1024)
    expect(checkClientFile({ name: 'a.pdf', size: CLIENT_DOCUMENT_MAX_BYTES })).toEqual({ ok: true, ext: 'pdf' })
    const big = checkClientFile({ name: 'a.pdf', size: CLIENT_DOCUMENT_MAX_BYTES + 1 })
    expect(big.ok).toBe(false)
    if (!big.ok) expect(big.error).toContain('25 МБ')
    expect(checkClientFile({ name: 'a.pdf', size: 0 })).toEqual({ ok: false, error: 'Файл пуст.' })
  })

  it('rejects executables, archives and legacy / macro Office formats', () => {
    for (const name of ['setup.exe', 'data.zip', 'a.rar', 'old.doc', 'old.ppt', 'm.xlsm', 'm.docm', 'm.pptm', 'noext']) {
      expect(checkClientFile({ name, size: 10 }).ok).toBe(false)
    }
  })

  it('accepts exactly what the server preflight accepts', () => {
    expect(CLIENT_DOCUMENT_BUCKET).toBe(UPLOAD_BUCKET)
    const probe = Buffer.from('hello')
    for (const ext of CLIENT_DOCUMENT_EXTENSIONS) {
      expect(checkClientFile({ name: `a.${ext}`, size: 10 }).ok).toBe(true)
      const r = preflightDocument(probe, `a.${ext}`)
      // Content may not match (it is a probe), but the extension itself is known.
      expect(r.ok || r.code !== 'UNSUPPORTED_TYPE').toBe(true)
    }
    for (const ext of ['doc', 'ppt', 'xlsm', 'docm', 'pptm', 'exe', 'zip', 'rtf', 'odt']) {
      expect(checkClientFile({ name: `a.${ext}`, size: 10 }).ok).toBe(false)
      const r = preflightDocument(probe, `a.${ext}`)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.code).toBe('UNSUPPORTED_TYPE')
    }
  })
})

describe('list / reprocess / delete / download', () => {
  it('fetchClientDocuments returns the session list', async () => {
    const f = fakeFetch(jsonResponse(200, { ok: true, data: [DOC, { nope: true }] }))
    expect(await fetchClientDocuments({ fetch: f })).toEqual({ ok: true, documents: [DOC] })
    expect(f.mock.calls[0][0]).toBe('/api/v1/onboarding/documents')
    expect(await fetchClientDocuments({ fetch: fakeFetch(jsonResponse(401, { ok: false, error: 'Unauthorized' })) })).toEqual({
      ok: false, status: 401, error: 'Сессия истекла — войдите в систему снова.',
    })
  })

  it('reprocess: 202 queued / already queued / 409 rejected', async () => {
    const queued = await reprocessClientDocument('doc-1', {
      fetch: fakeFetch(jsonResponse(202, { ok: true, task_id: 't1', status: 'queued', data: DOC })),
    })
    expect(queued).toEqual({ ok: true, taskId: 't1', alreadyQueued: false, document: DOC })
    const again = await reprocessClientDocument('doc-1', {
      fetch: fakeFetch(jsonResponse(202, { ok: true, task_id: 't1', status: 'running', already_queued: true })),
    })
    expect(again).toEqual({ ok: true, taskId: 't1', alreadyQueued: true, document: null })
    const rejected = await reprocessClientDocument('doc-1', {
      fetch: fakeFetch(jsonResponse(409, { ok: false, code: 'REJECTED', error: 'Файл отклонён проверкой безопасности. Загрузите другой файл.' })),
    })
    expect(rejected).toEqual({ ok: false, status: 409, code: 'REJECTED', error: 'Файл отклонён проверкой безопасности. Загрузите другой файл.' })
  })

  it('delete maps English server errors to Russian', async () => {
    expect(await deleteClientDocument('doc-1', { fetch: fakeFetch(jsonResponse(200, { ok: true })) })).toEqual({ ok: true })
    expect(await deleteClientDocument('doc-1', { fetch: fakeFetch(jsonResponse(404, { ok: false, error: 'Document not found' })) })).toEqual({
      ok: false, status: 404, error: 'Документ не найден.',
    })
  })

  it('download link: signed URL for storage rows, legacy http URL, otherwise an error', async () => {
    const ok = fakeSupabase({ signed: 'https://x.supabase.co/storage/v1/object/sign/client-documents/u/a.pdf?token=t' })
    expect(await documentDownloadUrl({ storage_bucket: 'client-documents', storage_path: 'u/a.pdf', file_url: 'u/a.pdf' }, { supabase: ok.sb }))
      .toEqual({ ok: true, url: 'https://x.supabase.co/storage/v1/object/sign/client-documents/u/a.pdf?token=t' })
    expect(ok.calls.sign).toEqual([{ bucket: 'client-documents', path: 'u/a.pdf', expires: 3600 }])

    const missing = fakeSupabase({ signed: null })
    expect(await documentDownloadUrl({ storage_bucket: 'client-documents', storage_path: 'u/a.pdf', file_url: null }, { supabase: missing.sb }))
      .toEqual({ ok: false, error: 'Файл не найден в хранилище.' })
    expect(await documentDownloadUrl({ storage_bucket: null, storage_path: null, file_url: 'https://legacy/x.pdf' }, { supabase: missing.sb }))
      .toEqual({ ok: true, url: 'https://legacy/x.pdf' })
    expect(await documentDownloadUrl({ storage_bucket: null, storage_path: null, file_url: 'u/a.pdf' }, { supabase: missing.sb }))
      .toEqual({ ok: false, error: 'Файл недоступен для просмотра.' })
  })

  it('httpErrorMessage prefers Russian server text', () => {
    expect(httpErrorMessage(400, 'Некорректное поле: period.year')).toBe('Некорректное поле: period.year')
    expect(httpErrorMessage(400, 'bad', 'Запасной текст')).toBe('Запасной текст')
    expect(httpErrorMessage(null, null)).toContain('Нет связи с сервером')
  })
})

describe('doc-type labels', () => {
  it('label every server doc_type; picker groups only offer server values, once', () => {
    expect(Object.keys(DOCUMENT_TYPE_LABELS).sort()).toEqual([...DOCUMENT_TYPES].sort())
    const offered = DOCUMENT_TYPE_GROUPS.flatMap((g) => g.types)
    expect(new Set(offered).size).toBe(offered.length)
    for (const t of offered) expect(DOCUMENT_TYPES).toContain(t)
    expect(documentTypeLabel('pl_report')).toBe('P&L (отчёт о прибылях и убытках)')
    expect(documentTypeLabel('unknown_type')).toBe('unknown_type')
    expect(documentTypeLabel(null)).toBe('Тип не указан')
  })
})
