/**
 * Documents pipeline on the real database (migration 089 + lib/documents +
 * the document_intelligence / document_reaper agents):
 *
 *   - the guard trigger: owners cannot forge parsed_data / status / security /
 *     location columns through PostgREST; the server can
 *   - the per-company sha256 dedupe index
 *   - upload → finalize → FILE_UPLOADED → agent → parsed_data with provenance
 *     → FILE_PROCESSED, LLM usage on the run
 *   - tenant binding: a task of company A cannot touch company B's document
 *   - reprocess, needs_ocr, swapped file, storage outage (retry → error),
 *     reaper, delete cascade
 *
 * Storage is an injected in-memory backend (lib/documents/storage.ts
 * setDocumentStorage); the model is a stubbed OpenRouter endpoint.
 * Run: npm run test:db:setup && npm run test:db
 */
import { createHash, randomUUID } from 'node:crypto'
import PDFDocument from 'pdfkit'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { dbTestsEnabled } from '../../helpers/db-env'
import { asService, asUser, closeTestPool, inRollback, pgErrorCode, seedCompany, seedUser } from '../../helpers/pg-rls'

function makePdf(pages: string[]): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument()
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    pages.forEach((p, i) => {
      if (i > 0) doc.addPage()
      if (p === '__scan__') doc.rect(20, 20, 300, 300).fill('#222')
      else doc.text(p)
    })
    doc.end()
  })
}

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex')

describe.skipIf(!dbTestsEnabled)('documents table: guard and dedupe (089)', () => {
  afterAll(async () => {
    await closeTestPool()
  })

  const insertAsOwner = (db: Parameters<Parameters<typeof inRollback>[0]>[0], userId: string, companyId: string | null, extra = '', values: unknown[] = []) =>
    db.query(
      `INSERT INTO public.documents (user_id, company_id, file_name, file_url, doc_type${extra ? `, ${extra}` : ''})
       VALUES ($1, $2, 'a.pdf', $3, 'pl_report'${values.map((_, i) => `, $${i + 4}`).join('')}) RETURNING id`,
      [userId, companyId, `${userId}/a.pdf`, ...values],
    )

  it('owners keep editing descriptive columns but cannot forge pipeline, security or location columns', async () => {
    await inRollback(async (db) => {
      const owner = await seedUser(db)
      const company = await seedCompany(db, owner)
      const id = await asUser(db, owner, async () => (await insertAsOwner(db, owner, company)).rows[0].id as string)

      await asUser(db, owner, () => db.query(`UPDATE public.documents SET file_name = 'P&L.pdf', doc_type = 'pl_statement', period_year = 2025 WHERE id = $1`, [id]))

      const forged: Array<[string, unknown]> = [
        ['parsed_data', JSON.stringify({ summary: 'x', fields: [{ key: 'revenue', value: 999999999 }] })],
        ['parse_status', 'parsed'],
        ['parse_error', null],
        ['security_status', 'clean'],
        ['sha256', 'a'.repeat(64)],
        ['sniffed_mime', 'application/pdf'],
        ['processing_stage', 'done'],
        ['attempts', 3],
        ['extraction_version', 'forged'],
        ['processed_at', new Date().toISOString()],
        ['storage_bucket', 'client-documents'],
        ['file_url', 'someone-else/secret.pdf'],
        ['company_id', null],
      ]
      for (const [col, val] of forged) {
        if (col === 'parse_error') {
          // parse_error starts NULL: forging a value is the change.
          expect(await pgErrorCode(asUser(db, owner, () => db.query(`UPDATE public.documents SET parse_error = 'ok' WHERE id = $1`, [id]))), col).toBe('42501')
          continue
        }
        const cast = col === 'parsed_data' ? '::jsonb' : col === 'processed_at' ? '::timestamptz' : ''
        expect(
          await pgErrorCode(asUser(db, owner, () => db.query(`UPDATE public.documents SET ${col} = $2${cast} WHERE id = $1`, [id, val]))),
          col,
        ).toBe('42501')
      }

      // The server (service role) writes them.
      await asService(db, () => db.query(
        `UPDATE public.documents SET parse_status = 'parsed', parsed_data = '{"summary":"ok","fields":[]}', security_status = 'clean',
           processing_stage = 'done', extraction_version = 'v' WHERE id = $1`, [id]))
      const { rows } = await db.query(`SELECT file_name, doc_type, parse_status, security_status, updated_at > uploaded_at - interval '1 minute' AS touched FROM public.documents WHERE id = $1`, [id])
      expect(rows[0]).toMatchObject({ file_name: 'P&L.pdf', doc_type: 'pl_statement', parse_status: 'parsed', security_status: 'clean', touched: true })
    })
  })

  it('owners cannot insert pre-processed rows or attach a company they cannot read', async () => {
    await inRollback(async (db) => {
      const owner = await seedUser(db)
      const stranger = await seedUser(db)
      const company = await seedCompany(db, owner)
      const foreign = await seedCompany(db, stranger)
      expect(await pgErrorCode(asUser(db, owner, () => insertAsOwner(db, owner, company, 'parse_status', ['parsed'])))).toBe('42501')
      expect(await pgErrorCode(asUser(db, owner, () => insertAsOwner(db, owner, company, 'parsed_data', ['{"fields":[]}'])))).toBe('42501')
      expect(await pgErrorCode(asUser(db, owner, () => insertAsOwner(db, owner, company, 'security_status', ['clean'])))).toBe('42501')
      expect(await pgErrorCode(asUser(db, owner, () => insertAsOwner(db, owner, company, 'storage_bucket, storage_path', ['client-documents', `${stranger}/x.pdf`])))).toBe('42501')
      expect(await pgErrorCode(asUser(db, owner, () => insertAsOwner(db, owner, foreign)))).toBe('42501')
      expect(await pgErrorCode(asUser(db, owner, () => insertAsOwner(db, owner, company)))).toBeNull()
    })
  })

  it('accepts the new statuses and document types, rejects unknown stages', async () => {
    await inRollback(async (db) => {
      const owner = await seedUser(db)
      const company = await seedCompany(db, owner)
      for (const status of ['needs_ocr', 'rejected']) {
        await asService(db, () => db.query(
          `INSERT INTO public.documents (user_id, company_id, file_name, file_url, doc_type, parse_status) VALUES ($1, $2, 'a', 'p', 'presentation', $3)`,
          [owner, company, status]))
      }
      for (const t of ['pl_statement', 'business_plan', 'marketplace_report', 'ecommerce_customers', 'patient_base']) {
        await asService(db, () => db.query(
          `INSERT INTO public.documents (user_id, company_id, file_name, file_url, doc_type) VALUES ($1, $2, 'a', 'p', $3)`, [owner, company, t]))
      }
      expect(await pgErrorCode(db.query(
        `INSERT INTO public.documents (user_id, file_name, file_url, doc_type, processing_stage) VALUES ($1, 'a', 'p', 'other', 'teleported')`, [owner]))).toBe('23514')
    })
  })

  it('the same bytes are one document per company (rejected rows excluded)', async () => {
    await inRollback(async (db) => {
      const owner = await seedUser(db)
      const a = await seedCompany(db, owner, 'A')
      const b = await seedCompany(db, await seedUser(db), 'B') // one company per primary owner
      const hash = sha('same bytes')
      const ins = (company: string | null, security = 'clean') => db.query(
        `INSERT INTO public.documents (user_id, company_id, file_name, file_url, doc_type, sha256, security_status)
         VALUES ($1, $2, 'a.pdf', 'p', 'other', $3, $4)`, [owner, company, hash, security])
      await ins(a, 'rejected')
      await ins(a)
      expect(await pgErrorCode(db.query('SAVEPOINT s1').then(() => ins(a)))).toBe('23505')
      await db.query('ROLLBACK TO SAVEPOINT s1')
      await ins(b)
      await ins(null)
      expect(await pgErrorCode(db.query('SAVEPOINT s2').then(() => ins(null)))).toBe('23505')
      await db.query('ROLLBACK TO SAVEPOINT s2')
    })
  })
})

describe.skipIf(!dbTestsEnabled)('document_intelligence agent end-to-end', async () => {
  const { prisma } = await import('@/lib/db')
  const { setDocumentStorage, StorageError } = await import('@/lib/documents/storage')
  const repo = await import('@/lib/documents/repository')
  const { finalizeUpload } = await import('@/lib/documents/finalize')
  const { emitPlatformEvent } = await import('@/lib/events/platform')
  const { enqueueAgentTask, executeTaskById } = await import('@/lib/agents/queue')
  const { getAgent, __useTestAgents } = await import('@/lib/agents/registry')
  // The product definitions themselves (registry.ts loads them with a
  // bundler-only require, which vitest cannot resolve).
  const { documentIntelligenceAgent } = await import('@/lib/agents/definitions/document-intelligence')
  const { documentReaperAgent } = await import('@/lib/agents/definitions/document-reaper')
  const { getTool } = await import('@/lib/agents/tools')
  const { EXTRACTION_PROMPT_VERSION, EXTRACTION_VERSION } = await import('@/lib/documents/extraction')
  type StorageLocation = import('@/lib/documents/storage').StorageLocation

  const objects = new Map<string, Buffer>()
  let storageDown = false
  const key = (l: StorageLocation) => `${l.bucket}/${l.path}`
  const fakeStorage = {
    async download(loc: StorageLocation, { maxBytes }: { maxBytes: number }) {
      if (storageDown) throw new StorageError('UNAVAILABLE', 'down')
      const b = objects.get(key(loc))
      if (!b) throw new StorageError('NOT_FOUND', 'missing')
      if (b.length > maxBytes) throw new StorageError('TOO_LARGE', 'big')
      return b
    },
    async remove(loc: StorageLocation) {
      objects.delete(key(loc))
    },
    async signedUrl() {
      return null
    },
  }

  let ownerA: string
  let ownerB: string
  let companyA: string
  let companyB: string
  const reaperTasks: string[] = []

  const openrouter = vi.fn(async (_url: unknown, init: { body: string }) => {
    const body = JSON.parse(init.body) as { messages: Array<{ content: string }> }
    const [system, user] = [body.messages[0].content, body.messages[1].content]
    const content = system.includes('каталогом метрик')
      ? { bindings: [] }
      : {
          summary: 'Годовой отчёт компании.',
          fields: user.includes('Revenue for 2025')
            ? [
                { key: 'revenue', label: 'Revenue', value: 12500000, unit: 'KZT', period: '2025', quote: 'Revenue for 2025: 12 500 000 KZT', page: 1, confidence: 0.92 },
                { key: 'ebitda', label: 'EBITDA', value: 7, quote: 'EBITDA was 7 billion', confidence: 0.9 },
              ]
            : [],
        }
    return new Response(JSON.stringify({
      model: 'anthropic/claude-sonnet-4.5',
      choices: [{ message: { content: JSON.stringify(content) } }],
      usage: { prompt_tokens: 900, completion_tokens: 120, cost: 0.00453 },
    }), { status: 200 })
  })

  async function upload(owner: string, company: string, name: string, bytes: Buffer, opts: { emit?: boolean; docType?: string } = {}) {
    const path = `${owner}/${randomUUID()}-${name}`
    objects.set(`client-documents/${path}`, bytes)
    const pending: Array<Promise<unknown>> = []
    const out = await finalizeUpload({
      userId: owner, companyId: company, bucket: 'client-documents', storagePath: path, fileName: name,
      docType: opts.docType ?? 'pl_report', allowedBuckets: ['client-documents'],
    }, {
      storage: fakeStorage,
      findDuplicate: repo.findDuplicate,
      insertDocument: repo.insertDocument,
      emit: (e) => { if (opts.emit !== false) pending.push(emitPlatformEvent(e)) },
    })
    await Promise.all(pending)
    return out
  }

  const doc = async (id: string) =>
    (await prisma.$queryRaw<Array<Record<string, any>>>`SELECT * FROM public.documents WHERE id = ${id}::uuid`)[0]
  const tasksFor = (id: string) => prisma.$queryRaw<Array<Record<string, any>>>`
    SELECT * FROM public.agent_tasks WHERE agent_key = 'document_intelligence'
      AND (input->>'document_id' = ${id} OR input->'event'->>'subject_id' = ${id}) ORDER BY created_at`
  const events = (id: string) => prisma.$queryRaw<Array<Record<string, any>>>`
    SELECT name, dedupe_key, payload FROM public.platform_events WHERE subject_id = ${id} ORDER BY id`
  const manual = (company: string, documentId: string) => enqueueAgentTask({
    agentKey: 'document_intelligence', companyId: company, trigger: 'manual', requestedBy: 'test',
    input: { document_id: documentId }, idempotencyKey: `test:${randomUUID()}`, kick: false,
  })

  beforeAll(async () => {
    process.env.AGENT_INLINE_EXECUTION = 'false'
    delete process.env.DOCUMENT_OCR_ENABLED
    setDocumentStorage(fakeStorage)
    __useTestAgents([documentIntelligenceAgent, documentReaperAgent])
    expect(getAgent('document_intelligence')).toBe(documentIntelligenceAgent)
    ownerA = randomUUID()
    ownerB = randomUUID()
    for (const u of [ownerA, ownerB]) {
      await prisma.$executeRaw`INSERT INTO auth.users (id, email) VALUES (${u}::uuid, ${`${u}@t.local`})`
    }
    companyA = randomUUID()
    companyB = randomUUID()
    await prisma.$executeRaw`INSERT INTO public.companies (id, name, user_id, "updatedAt") VALUES (${companyA}, 'Doc A', ${ownerA}::uuid, now())`
    await prisma.$executeRaw`INSERT INTO public.companies (id, name, user_id, "updatedAt") VALUES (${companyB}, 'Doc B', ${ownerB}::uuid, now())`
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.OPENROUTER_API_KEY
    storageDown = false
  })

  afterAll(async () => {
    setDocumentStorage(null)
    await prisma.$executeRaw`DELETE FROM public.platform_events WHERE company_id IN (${companyA}, ${companyB})`
    for (const id of reaperTasks) await prisma.$executeRaw`DELETE FROM public.agent_tasks WHERE id = ${id}::uuid`
    await prisma.$executeRaw`DELETE FROM public.documents WHERE user_id IN (${ownerA}::uuid, ${ownerB}::uuid)`
    await prisma.$executeRaw`DELETE FROM public.companies WHERE id IN (${companyA}, ${companyB})`
    await prisma.$executeRaw`DELETE FROM auth.users WHERE id IN (${ownerA}::uuid, ${ownerB}::uuid)`
  })

  it('upload → FILE_UPLOADED → agent: parsed with field provenance, FILE_PROCESSED and recorded model cost', async () => {
    vi.stubGlobal('fetch', openrouter)
    process.env.OPENROUTER_API_KEY = 'test-key'
    const pdf = await makePdf(['Annual report of Test LLP for 2025.', 'Revenue for 2025: 12 500 000 KZT. Offices: 3.'])
    const up = await upload(ownerA, companyA, 'annual.pdf', pdf)
    expect(up.kind).toBe('created')
    if (up.kind !== 'created') return
    const id = up.document.id

    const [task] = await tasksFor(id)
    expect(task).toMatchObject({ trigger: 'event', trigger_ref: 'FILE_UPLOADED', company_id: companyA, status: 'queued' })
    const report = await executeTaskById(task.id)
    expect(report).toMatchObject({ finalStatus: 'succeeded' })

    const row = await doc(id)
    expect(row).toMatchObject({
      parse_status: 'parsed', processing_stage: 'done', security_status: 'clean', attempts: 1,
      extraction_version: EXTRACTION_VERSION, processing_task_id: null, parse_error: null,
    })
    expect(row.processed_at).not.toBeNull()
    const pd = row.parsed_data
    expect(pd).toMatchObject({ schema_version: 2, document_id: id, extraction_version: EXTRACTION_VERSION, prompt_version: EXTRACTION_PROMPT_VERSION, empty_reason: null, task_id: task.id })
    const revenue = pd.fields.find((f: any) => f.key === 'revenue')
    expect(revenue).toMatchObject({ value: 12500000, period: '2025' })
    expect(revenue.provenance).toMatchObject({
      document_id: id, method: 'llm', page: 2, quote_verified: true, model: 'anthropic/claude-sonnet-4.5', prompt_version: EXTRACTION_PROMPT_VERSION,
    })
    expect(revenue.provenance.quote.length).toBeLessThanOrEqual(200)
    // The invented EBITDA quote is not a fact.
    expect(pd.fields.some((f: any) => f.key === 'ebitda')).toBe(false)
    expect(pd.unverified_fields.map((f: any) => f.key)).toEqual(['ebitda'])

    expect((await events(id)).map((e) => [e.name, e.dedupe_key])).toEqual([
      ['FILE_UPLOADED', `file_uploaded:${id}`],
      ['FILE_PROCESSED', `file_processed:${id}:1`],
    ])

    const [run] = await prisma.$queryRaw<Array<Record<string, any>>>`SELECT * FROM public.agent_runs WHERE task_id = ${task.id}::uuid`
    expect(run).toMatchObject({ status: 'succeeded', prompt_version: EXTRACTION_PROMPT_VERSION, model: 'anthropic/claude-sonnet-4.5' })
    expect(run.llm_calls).toBeGreaterThanOrEqual(1)
    expect(Number(run.cost_usd)).toBeCloseTo(0.00453 * run.llm_calls, 6)
    expect(run.sources).toContainEqual({ type: 'document', ref: id })
    const calls = await prisma.$queryRaw<Array<Record<string, any>>>`
      SELECT tool, status, args_redacted FROM public.agent_tool_calls WHERE run_id = ${run.id}::uuid ORDER BY seq`
    expect(calls.map((c) => c.tool)).toEqual(expect.arrayContaining(['documents.update_status', 'documents.load', 'documents.save_extraction']))
    expect(calls.every((c) => c.status === 'ok')).toBe(true)
    const save = calls.find((c) => c.tool === 'documents.save_extraction')!
    expect(save.args_redacted.payload_json).toMatch(/^sha256:/)

    // Same bytes again in the same company: the existing document comes back.
    const again = await upload(ownerA, companyA, 'annual-copy.pdf', pdf)
    expect(again).toMatchObject({ kind: 'duplicate', document: { id } })
  })

  it('a task bound to company A can neither claim nor load a document of company B', async () => {
    const up = await upload(ownerB, companyB, 'b.csv', Buffer.from('Показатель;Значение\nВыручка;100\n'), { emit: false })
    if (up.kind !== 'created') throw new Error('fixture')
    const docB = up.document.id

    const { id } = await manual(companyA, docB)
    expect(await executeTaskById(id)).toMatchObject({ finalStatus: 'dead', errorCode: 'DOCUMENT_NOT_FOUND' })
    expect(await doc(docB)).toMatchObject({ parse_status: 'queued', attempts: 0, processing_task_id: null })

    const load = getTool('documents.load')!
    const ctxFor = (companyId: string) => ({ taskId: randomUUID(), runId: randomUUID(), agentKey: 'document_intelligence', companyId, sessionId: null, source: () => {} })
    await expect(load.handler(ctxFor(companyA), { document_id: docB })).rejects.toMatchObject({ code: 'DOCUMENT_NOT_FOUND' })
    const own = await load.handler(ctxFor(companyB), { document_id: docB })
    expect(own.buffer.length).toBeGreaterThan(0)
    const status = getTool('documents.update_status')!
    expect(await status.handler(ctxFor(companyA), { action: 'claim', document_id: docB })).toMatchObject({ claimed: false, reason: 'not_found' })
  })

  it('reprocess: back to the queue, a new run and a new FILE_PROCESSED', async () => {
    const up = await upload(ownerA, companyA, 'kpi.csv', Buffer.from('Показатель;Значение\nВыручка;12500000\nЧистая прибыль;900000\nСредний чек;25000\n'), { emit: false })
    if (up.kind !== 'created') throw new Error('fixture')
    const id = up.document.id
    const first = await manual(companyA, id)
    expect((await executeTaskById(first.id))?.finalStatus).toBe('succeeded')
    const row1 = await doc(id)
    expect(row1).toMatchObject({ parse_status: 'parsed', attempts: 1 })
    expect(row1.parsed_data.stats.llm_skipped).toBe('table_covered_deterministically')
    expect(row1.parsed_data.fields.find((f: any) => f.key === 'revenue').provenance).toMatchObject({ method: 'table', quote_verified: true })

    expect(await repo.liveTaskForDocument(id)).toBeNull()
    expect(await repo.resetForReprocess(id)).toMatchObject({ parse_status: 'queued', processing_stage: 'validated' })
    const second = await manual(companyA, id)
    expect((await executeTaskById(second.id))?.finalStatus).toBe('succeeded')
    expect(await doc(id)).toMatchObject({ parse_status: 'parsed', attempts: 2 })
    expect((await events(id)).filter((e) => e.name === 'FILE_PROCESSED').map((e) => e.dedupe_key))
      .toEqual([`file_processed:${id}:1`, `file_processed:${id}:2`])
  })

  it('a scan without text layer ends as needs_ocr with an explanation and no FILE_PROCESSED', async () => {
    const up = await upload(ownerA, companyA, 'scan.pdf', await makePdf(['__scan__']), { emit: false })
    if (up.kind !== 'created') throw new Error('fixture')
    const { id } = await manual(companyA, up.document.id)
    expect((await executeTaskById(id))?.finalStatus).toBe('succeeded')
    const row = await doc(up.document.id)
    expect(row).toMatchObject({ parse_status: 'needs_ocr', processing_stage: 'done', last_error_code: 'NEEDS_OCR' })
    expect(row.parse_error).toMatch(/OCR/)
    expect(row.parsed_data.empty_reason.code).toBe('NEEDS_OCR')
    expect((await events(up.document.id)).some((e) => e.name === 'FILE_PROCESSED')).toBe(false)
  })

  it('a file swapped in storage after finalize is rejected without retries', async () => {
    const up = await upload(ownerA, companyA, 'swap.csv', Buffer.from('Показатель;Значение\nВыручка;1\n'), { emit: false })
    if (up.kind !== 'created') throw new Error('fixture')
    objects.set(`client-documents/${up.document.storage_path}`, Buffer.from('Показатель;Значение\nВыручка;999999999\n'))
    const { id } = await manual(companyA, up.document.id)
    expect(await executeTaskById(id)).toMatchObject({ finalStatus: 'dead', errorCode: 'FILE_REJECTED' })
    expect(await doc(up.document.id)).toMatchObject({ parse_status: 'rejected', security_status: 'rejected', last_error_code: 'FILE_CHANGED', parsed_data: null })
  })

  it('storage outage: retried with the document back in the queue, then an honest error', async () => {
    const up = await upload(ownerA, companyA, 'later.csv', Buffer.from('Показатель;Значение\nВыручка;5\n'), { emit: false })
    if (up.kind !== 'created') throw new Error('fixture')
    const docId = up.document.id
    storageDown = true
    const { id } = await manual(companyA, docId)
    expect((await executeTaskById(id))?.finalStatus).toBe('queued')
    expect(await doc(docId)).toMatchObject({ parse_status: 'queued', processing_stage: 'validated', last_error_code: 'STORAGE_UNAVAILABLE', processing_task_id: null })
    for (let i = 0; i < 2; i += 1) {
      await prisma.$executeRaw`UPDATE public.agent_tasks SET run_after = now() WHERE id = ${id}::uuid`
      await executeTaskById(id)
    }
    const [task] = await prisma.$queryRaw<Array<Record<string, any>>>`SELECT status, attempts FROM public.agent_tasks WHERE id = ${id}::uuid`
    expect(task).toMatchObject({ status: 'dead', attempts: 3 })
    expect(await doc(docId)).toMatchObject({ parse_status: 'error', processing_stage: 'failed', last_error_code: 'STORAGE_UNAVAILABLE' })
  })

  it('document_reaper requeues a stuck document and gives up after the attempt limit', async () => {
    const mk = async (name: string) => {
      const up = await upload(ownerA, companyA, name, Buffer.from(`Показатель;Значение\nВыручка;${name.length}\n`), { emit: false })
      if (up.kind !== 'created') throw new Error('fixture')
      return up.document.id
    }
    const stuck = await mk('stuck.csv')
    const hopeless = await mk('hopeless.csv')
    const backdate = (id: string, attempts: number) => prisma.$transaction([
      prisma.$executeRaw`SET LOCAL session_replication_role = replica`,
      prisma.$executeRaw`UPDATE public.documents SET parse_status = 'processing', processing_stage = 'extracting',
        attempts = ${attempts}, updated_at = now() - interval '45 minutes' WHERE id = ${id}::uuid`,
    ])
    await backdate(stuck, 1)
    await backdate(hopeless, 5)

    const { id } = await enqueueAgentTask({ agentKey: 'document_reaper', companyId: null, trigger: 'manual', idempotencyKey: `test:${randomUUID()}`, kick: false })
    reaperTasks.push(id)
    const report = await executeTaskById(id)
    expect(report?.finalStatus).toBe('succeeded')

    expect(await doc(stuck)).toMatchObject({ parse_status: 'queued', processing_stage: 'validated', last_error_code: 'REAPED' })
    const [requeued] = await tasksFor(stuck)
    expect(requeued).toMatchObject({ trigger: 'agent', trigger_ref: 'document_reaper', parent_task_id: id, status: 'queued', company_id: companyA })
    expect(await doc(hopeless)).toMatchObject({ parse_status: 'error', processing_stage: 'failed', last_error_code: 'MAX_ATTEMPTS' })
    expect(await tasksFor(hopeless)).toEqual([])

    // The requeued document is processed normally afterwards.
    expect((await executeTaskById(requeued.id))?.finalStatus).toBe('succeeded')
    expect(await doc(stuck)).toMatchObject({ parse_status: 'parsed', attempts: 2 })
  })

  it('delete cascade removes RAG summaries and cancels queued processing', async () => {
    const up = await upload(ownerA, companyA, 'gone.csv', Buffer.from('Показатель;Значение\nВыручка;77\n'), { emit: false })
    if (up.kind !== 'created') throw new Error('fixture')
    const docId = up.document.id
    const summaryId = `sum-${randomUUID()}`
    await prisma.$transaction([
      prisma.$executeRaw`SET LOCAL session_replication_role = replica`,
      prisma.$executeRaw`INSERT INTO public.document_summaries (id, "clientId", content, metadata)
        VALUES (${summaryId}, 'no-client', 'text', ${JSON.stringify({ source_document_id: docId })}::jsonb)`,
    ])
    const { id: taskId } = await manual(companyA, docId)
    const res = await repo.deleteDocumentCascade(docId)
    expect(res).toEqual({ deleted: true, summaries: 1, tasksCancelled: 1 })
    expect(await doc(docId)).toBeUndefined()
    const [task] = await prisma.$queryRaw<Array<{ status: string; last_error_code: string }>>`SELECT status, last_error_code FROM public.agent_tasks WHERE id = ${taskId}::uuid`
    expect(task).toEqual({ status: 'cancelled', last_error_code: 'DOCUMENT_DELETED' })
  })
})
