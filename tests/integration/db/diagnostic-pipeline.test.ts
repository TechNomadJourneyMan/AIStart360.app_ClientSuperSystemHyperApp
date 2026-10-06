/**
 * The multi-agent diagnostic pipeline end-to-end on the real database
 * (migrations 085/086/090 + lib/diagnostics + lib/agents/definitions/diagnostics):
 * session lifecycle, stage chaining, deterministic findings with evidence,
 * model hypotheses hidden until review, evidence validation, input-hash cache,
 * score reuse, failure and stall handling.
 *
 * The two Supabase-backed steps (metric materialisation, overview) are
 * replaced through setDiagnosticsIO; the model is a stubbed fetch.
 * Run: npm run test:db:setup && npm run test:db
 */
import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { dbTestsEnabled } from '../../helpers/db-env'
import { LEGACY_WEAK } from '../../unit/point-a/fixtures/answer-sets'
import type { PointAOverview } from '@/types/point-a-overview'

describe.skipIf(!dbTestsEnabled)('diagnostic pipeline', async () => {
  const { prisma } = await import('@/lib/db')
  const { __useTestAgents } = await import('@/lib/agents/registry')
  const { enqueueAgentTask, executeTaskById } = await import('@/lib/agents/queue')
  const { DIAGNOSTIC_AGENTS } = await import('@/lib/agents/definitions/diagnostics')
  const { setDiagnosticsIO } = await import('@/lib/diagnostics/io')
  const { failStalledSessions } = await import('@/lib/diagnostics/sessions')
  const { AgentError } = await import('@/lib/agents/types')
  const { DIAGNOSTIC_STAGES } = await import('@/lib/diagnostics/pipeline')

  const users: string[] = []
  const companies: string[] = []
  let materializeFails = false
  let llmCalls: string[] = []

  function overview(companyId: string, sources: Partial<PointAOverview['sources']> = {}): PointAOverview {
    return {
      companyId, companyName: 'Test', overallScore: 21, healthIndex: 13, maturity: null, griIndex: null,
      status: 'ready', completeness: 0.42, completenessLevel: 'medium', dataGaps: ['Загрузите P&L'],
      problemZones: [], keyRisks: [], strengths: [], criticalGaps: [],
      sources: {
        surveyStepsCompleted: 5, surveyStepsTotal: 12, documentsTotal: 1, documentsProcessed: 0, documentsFailed: 1,
        documentsPending: 0, griAssessments: 0, integrationsConnected: 0, metricsWithValue: 4, metricsTotal: 148, processedSources: 2,
        ...sources,
      },
      calculatedAt: null, lastInputAt: null, generatedAt: new Date().toISOString(),
    }
  }
  const emptyCompanies = new Set<string>()

  async function seedCompany(opts: { answers?: Record<string, unknown>; industry?: string | null } = {}) {
    const owner = randomUUID()
    users.push(owner)
    await prisma.$executeRaw`INSERT INTO auth.users (id, email) VALUES (${owner}::uuid, ${`${owner}@t.local`})`
    const companyId = randomUUID()
    companies.push(companyId)
    await prisma.$executeRaw`
      INSERT INTO public.companies (id, name, user_id, industry, stage, "updatedAt")
      VALUES (${companyId}, 'Pipeline Co', ${owner}::uuid, ${opts.industry === undefined ? 'Розничная торговля' : opts.industry}, 'early', now())`
    for (const [key, value] of Object.entries(opts.answers ?? {})) {
      await prisma.$executeRaw`
        INSERT INTO public.survey_answers (user_id, company_id, step, question_key, answer)
        VALUES (${owner}::uuid, ${companyId}, 2, ${key}, ${JSON.stringify({ value })}::jsonb)`
    }
    return { owner, companyId }
  }

  async function addMetric(companyId: string, key: string, value: number, source: string, unit = '₸') {
    await prisma.$executeRaw`
      INSERT INTO public.metrics (company_id, metric_key, metric_value, metric_unit, source, period_year, computed_at)
      VALUES (${companyId}, ${key}, ${String(value)}::numeric, ${unit}, ${source}, 2025, now())`
  }

  /** Execute the company's due tasks one at a time (never other tests' tasks). */
  async function drain(companyId: string, max = 30): Promise<string[]> {
    const ran: string[] = []
    for (let i = 0; i < max; i++) {
      const [t] = await prisma.$queryRaw<Array<{ id: string; agent_key: string }>>`
        SELECT id, agent_key FROM public.agent_tasks
        WHERE company_id = ${companyId} AND status = 'queued' AND run_after <= now()
        ORDER BY created_at LIMIT 1`
      if (!t) break
      const rep = await executeTaskById(t.id)
      if (process.env.DEBUG_PIPELINE) {
        const [row] = await prisma.$queryRaw<Array<{ last_error: string | null }>>`SELECT last_error FROM public.agent_tasks WHERE id = ${t.id}::uuid`
        console.log(t.agent_key, JSON.stringify(rep), row?.last_error)
      }
      ran.push(t.agent_key)
    }
    return ran
  }

  async function start(companyId: string, input: Record<string, unknown> = {}) {
    const { id } = await enqueueAgentTask({
      agentKey: 'diagnostic_orchestrator', companyId, trigger: 'manual', requestedBy: 'test',
      input, idempotencyKey: `test:${randomUUID()}`, kick: false,
    })
    return id
  }

  const sessions = (companyId: string) => prisma.$queryRaw<Array<Record<string, any>>>`
    SELECT * FROM public.diagnostic_sessions WHERE company_id = ${companyId} ORDER BY started_at`
  const findings = (companyId: string) => prisma.$queryRaw<Array<Record<string, any>>>`
    SELECT * FROM public.diagnostic_findings WHERE company_id = ${companyId} AND status = 'active' ORDER BY produced_by, title`
  const recommendations = (companyId: string) => prisma.$queryRaw<Array<Record<string, any>>>`
    SELECT * FROM public.diagnostic_recommendations WHERE company_id = ${companyId} AND status = 'proposed'`
  const events = (companyId: string) => prisma.$queryRaw<Array<{ name: string; payload: Record<string, any> }>>`
    SELECT name, payload FROM public.platform_events WHERE company_id = ${companyId} ORDER BY id`

  /** OpenRouter stub: answers the hypotheses or the recommendations prompt. */
  function stubModel() {
    llmCalls = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as { messages: Array<{ role: string; content: string }> }
      const system = body.messages.find((m) => m.role === 'system')?.content ?? ''
      const user = body.messages.find((m) => m.role === 'user')?.content ?? ''
      const hypotheses = system.includes('ГИПОТЕЗЫ')
      llmCalls.push(hypotheses ? 'hypotheses' : 'recommendations')
      const findingIds = [...user.matchAll(/\[(f\.\d+)\]/g)].map((m) => m[1])
      const content = hypotheses
        ? {
            hypotheses: [
              { kind: 'bottleneck', area: 'sales', title: 'Продажи зависят от одного канала привлечения', body: 'Нет CRM и единственный канал.', severity: 'critical', confidence: 0.95, evidence: ['b.sales', 'x.99'] },
              { kind: 'risk', area: 'finance', title: 'Гипотеза без доказательств', severity: 'high', confidence: 0.5, evidence: ['nope.1'] },
              { kind: 'risk', area: 'astrology', title: 'Гипотеза о неизвестной области', severity: 'low', confidence: 0.4, evidence: ['b.finance'] },
            ],
          }
        : {
            recommendations: [
              { area: 'sales', title: 'Внедрить CRM и регламент обработки лидов', body: 'Ответственный — РОП, срок 30 дней', expected_impact: '+10% конверсии', effort: 'medium', priority: 1, horizon_days: 30, confidence: 0.9, findings: findingIds.slice(0, 2) },
              { area: 'finance', title: 'Рекомендация без ссылок на выводы', effort: 'low', priority: 3, horizon_days: 90, confidence: 0.5, findings: ['f.999'] },
            ],
          }
      return new Response(JSON.stringify({
        model: 'anthropic/claude-sonnet-4.5',
        choices: [{ message: { content: JSON.stringify(content) } }],
        usage: { prompt_tokens: 3000, completion_tokens: 400, cost: 0.015 },
      }), { status: 200 })
    }))
    process.env.OPENROUTER_API_KEY = 'test-key'
  }

  beforeAll(async () => {
    process.env.AGENT_INLINE_EXECUTION = 'false'
    __useTestAgents(DIAGNOSTIC_AGENTS)
    setDiagnosticsIO({
      async materialize() {
        if (materializeFails) throw new AgentError('MATERIALIZE_DOWN', 'хранилище метрик недоступно', false)
        return { written: 4, total: 148, skipped: 144, errors: 0 }
      },
      async overview(companyId) {
        return emptyCompanies.has(companyId)
          ? overview(companyId, { surveyStepsCompleted: 0, documentsProcessed: 0, metricsWithValue: 0, documentsTotal: 0, documentsFailed: 0 })
          : overview(companyId)
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.OPENROUTER_API_KEY
    materializeFails = false
  })

  afterAll(async () => {
    setDiagnosticsIO(null)
    if (companies.length) {
      await prisma.$executeRaw`DELETE FROM public.platform_events WHERE company_id = ANY(${companies}::text[])`
      await prisma.$executeRaw`DELETE FROM public.notification_events WHERE company_id = ANY(${companies}::text[])`
      await prisma.$executeRaw`DELETE FROM public.metrics WHERE company_id = ANY(${companies}::text[])`
      await prisma.$executeRaw`DELETE FROM public.metric_value_history WHERE company_id = ANY(${companies}::text[])`
      await prisma.$executeRaw`DELETE FROM public.documents WHERE company_id = ANY(${companies}::text[])`
      await prisma.$executeRaw`DELETE FROM public.diagnostics WHERE company_id = ANY(${companies}::text[])`
      await prisma.$executeRaw`DELETE FROM public.companies WHERE id = ANY(${companies}::text[])`
    }
    if (users.length) await prisma.$executeRaw`DELETE FROM auth.users WHERE id = ANY(${users}::uuid[])`
  })

  it('runs every stage in order and finalises the session with evidence-backed findings', async () => {
    const { companyId } = await seedCompany({ answers: LEGACY_WEAK })
    // Two sources disagree on revenue (survey vs document) and one impossible value.
    await addMetric(companyId, 'biz.finansy.vyruchka_god', 100_000_000, 'survey')
    await addMetric(companyId, 'biz.finansy.vyruchka_god', 40_000_000, 'document')
    await addMetric(companyId, 'biz.marketing.cac', -500, 'manual')
    await prisma.$executeRaw`
      INSERT INTO public.documents (user_id, company_id, file_name, file_url, doc_type, parse_status)
      SELECT user_id, id, 'scan.pdf', 'x/scan.pdf', 'pl_report', 'needs_ocr' FROM public.companies WHERE id = ${companyId}`
    stubModel()

    await start(companyId)
    const ran = await drain(companyId)
    expect(ran).toEqual(['diagnostic_orchestrator', ...DIAGNOSTIC_STAGES, 'diagnostic_orchestrator'])

    const [s] = await sessions(companyId)
    expect(s.status).toBe('ready')
    expect(s.diagnostic_id).toBeTruthy()
    expect(s.overview.overallScore).toBe(21)
    expect(Number(s.completeness)).toBeCloseTo(0.42, 2)
    for (const stage of DIAGNOSTIC_STAGES) expect(['done', 'skipped']).toContain(s.stages[stage].status)
    expect(s.stages.diagnostic.llm).toBe('done')
    expect(s.stages.diagnostic.input_hash).toMatch(/^[0-9a-f]{32}$/)

    // The score of this session is the current diagnostic of the company.
    const [diag] = await prisma.$queryRaw<Array<Record<string, any>>>`
      SELECT id, session_id, is_current FROM public.diagnostics WHERE id = ${s.diagnostic_id}::uuid`
    expect(diag).toMatchObject({ session_id: s.id, is_current: true })

    const f = await findings(companyId)
    const kinds = f.filter((x) => x.produced_by === 'agent:data_quality').map((x) => x.kind).sort()
    expect(kinds).toEqual(['anomaly', 'data_gap', 'inconsistency'])
    const inconsistency = f.find((x) => x.kind === 'inconsistency')!
    expect(inconsistency.provenance_type).toBe('CALCULATED')
    expect(inconsistency.evidence).toHaveLength(2)
    expect(inconsistency.title).toContain('60%')
    expect(f.every((x) => Array.isArray(x.evidence) && x.evidence.length > 0)).toBe(true)

    // Benchmarks name their source as an expert estimate.
    const bench = f.filter((x) => x.produced_by === 'agent:benchmark')
    expect(bench.length).toBeGreaterThan(0)
    expect(bench.every((x) => x.body.includes('экспертная оценка') && Number(x.confidence) === 0.5)).toBe(true)

    // Model output: only the hypothesis with real evidence survives, hidden, capped, cited.
    const ai = f.filter((x) => x.produced_by === 'agent:diagnostic:ai')
    expect(ai).toHaveLength(1)
    expect(ai[0]).toMatchObject({ provenance_type: 'AI_HYPOTHESIS', visible_to_client: false, model: 'anthropic/claude-sonnet-4.5' })
    expect(Number(ai[0].confidence)).toBe(0.7)
    expect(ai[0].evidence.map((e: { evidence_id: string }) => e.evidence_id)).toEqual(['b.sales'])

    const recs = await recommendations(companyId)
    const rules = recs.filter((r) => r.produced_by === 'agent:recommendation')
    const aiRecs = recs.filter((r) => r.produced_by === 'agent:recommendation:ai')
    expect(rules.length).toBeGreaterThan(0)
    expect(rules.every((r) => r.visible_to_client === true && r.model === null)).toBe(true)
    expect(aiRecs).toHaveLength(1)
    expect(aiRecs[0]).toMatchObject({ visible_to_client: false, horizon_days: 30, priority: 1 })
    const ids = new Set(f.map((x) => x.id))
    expect(aiRecs[0].finding_ids.length).toBeGreaterThan(0)
    expect(aiRecs[0].finding_ids.every((id: string) => ids.has(id))).toBe(true)

    // Events: started, completed with the user's message fields; AI critical → needs review.
    const ev = await events(companyId)
    expect(ev.map((e) => e.name)).toEqual(expect.arrayContaining(['DIAGNOSTIC_STARTED', 'DIAGNOSTIC_COMPLETED', 'CRITICAL_RISK_FOUND']))
    const done = ev.find((e) => e.name === 'DIAGNOSTIC_COMPLETED')!
    expect(done.payload).toMatchObject({ score: 21, metrics_calculated: 4, agent_key: 'diagnostic_orchestrator' })
    const crit = ev.filter((e) => e.name === 'CRITICAL_RISK_FOUND')
    expect(crit.every((e) => e.payload.provenance !== 'AI_HYPOTHESIS' || e.payload.needs_review === true)).toBe(true)

    // Every LLM call went through the budget guard and was accounted.
    expect(llmCalls).toEqual(['hypotheses', 'recommendations'])
    const [cost] = await prisma.$queryRaw<Array<{ c: string; n: bigint }>>`
      SELECT coalesce(sum(cost_usd), 0)::text AS c, count(*) FILTER (WHERE llm_calls > 0) AS n
      FROM public.agent_runs WHERE company_id = ${companyId}`
    expect(Number(cost.n)).toBe(2)
    expect(Number(cost.c)).toBeCloseTo(0.03, 4)
  })

  it('a second pass over unchanged data reuses the score and does not call the model again', async () => {
    const { companyId } = await seedCompany({ answers: LEGACY_WEAK })
    stubModel()
    await start(companyId)
    await drain(companyId)
    const first = (await sessions(companyId))[0]
    const before = await findings(companyId)
    const calls = llmCalls.length

    await start(companyId)
    await drain(companyId)
    const [, second] = await sessions(companyId)
    expect(second.status).toBe('ready')
    expect(second.diagnostic_id).toBe(first.diagnostic_id) // same engine result → same row
    expect(second.stages.diagnostic).toMatchObject({ llm: 'done', cached: true })
    expect(llmCalls.length).toBe(calls) // no new model call
    const after = await findings(companyId)
    expect(after.map((x) => x.id).sort()).toEqual(before.map((x) => x.id).sort())
    const [{ n }] = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*) AS n FROM public.diagnostics WHERE company_id = ${companyId}`
    expect(Number(n)).toBe(1)
  })

  it('without a model key the deterministic result is kept and the stage says why', async () => {
    const { companyId } = await seedCompany({ answers: LEGACY_WEAK })
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    await start(companyId)
    await drain(companyId)
    const [s] = await sessions(companyId)
    expect(s.status).toBe('ready')
    expect(s.stages.diagnostic.llm).toBe('unavailable')
    expect(s.stages.recommendation.llm).toBe('unavailable')
    expect(fetchSpy).not.toHaveBeenCalled()
    const f = await findings(companyId)
    expect(f.some((x) => x.provenance_type === 'AI_HYPOTHESIS')).toBe(false)
    expect((await recommendations(companyId)).length).toBeGreaterThan(0)
  })

  it('stops with a reason when the company has no data at all', async () => {
    const { companyId } = await seedCompany()
    emptyCompanies.add(companyId)
    await start(companyId)
    const ran = await drain(companyId)
    expect(ran).toEqual(['diagnostic_orchestrator', 'data_collection'])
    const [s] = await sessions(companyId)
    expect(s.status).toBe('cancelled')
    expect(s.error).toContain('Недостаточно данных')
  })

  it('a stage that gives up fails the session; nothing after it runs', async () => {
    const { companyId } = await seedCompany({ answers: LEGACY_WEAK })
    materializeFails = true
    await start(companyId)
    const ran = await drain(companyId)
    expect(ran).toEqual(['diagnostic_orchestrator', 'data_collection', 'metrics'])
    const [s] = await sessions(companyId)
    expect(s.status).toBe('failed')
    expect(s.error).toContain('metrics')
    expect((await events(companyId)).map((e) => e.name)).toContain('AGENT_FAILED')
  })

  it('one session in flight per company: a second trigger marks a re-run instead', async () => {
    const { companyId } = await seedCompany({ answers: LEGACY_WEAK })
    const a = await start(companyId)
    await executeTaskById(a)
    const b = await enqueueAgentTask({
      agentKey: 'diagnostic_orchestrator', companyId, trigger: 'event', requestedBy: 'test', kick: false,
      input: { event: { id: 1, name: 'QUESTIONNAIRE_COMPLETED' } }, idempotencyKey: `test:${randomUUID()}`,
    })
    await executeTaskById(b.id)
    let s = await sessions(companyId)
    expect(s).toHaveLength(1)
    expect(s[0].rerun_requested).toBe(true)
    await drain(companyId)
    s = await sessions(companyId)
    // Inputs did not change after the session started → no second pass.
    expect(s).toHaveLength(1)
    expect(s[0].status).toBe('ready')
  })

  it('an empty processed document does not start a diagnostic', async () => {
    const { companyId } = await seedCompany({ answers: LEGACY_WEAK })
    const { id } = await enqueueAgentTask({
      agentKey: 'diagnostic_orchestrator', companyId, trigger: 'event', requestedBy: 'test', kick: false,
      input: { event: { id: 2, name: 'FILE_PROCESSED', payload: { field_count: 0, row_count: 0, bound_count: 0 } } },
      idempotencyKey: `test:${randomUUID()}`,
    })
    const r = await executeTaskById(id)
    expect(r?.finalStatus).toBe('succeeded')
    expect(await sessions(companyId)).toHaveLength(0)
  })

  it('a stage task outside a session dead-letters instead of touching data', async () => {
    const { companyId } = await seedCompany({ answers: LEGACY_WEAK })
    const { id } = await enqueueAgentTask({ agentKey: 'data_quality', companyId, trigger: 'manual', requestedBy: 'test', kick: false })
    const r = await executeTaskById(id)
    expect(r).toMatchObject({ finalStatus: 'dead', errorCode: 'NO_SESSION' })
    expect(await findings(companyId)).toHaveLength(0)
  })

  it('fails sessions whose chain broke (no live task) after the idle window', async () => {
    const { companyId } = await seedCompany()
    const [{ id }] = await prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO public.diagnostic_sessions (company_id, status, updated_at)
      VALUES (${companyId}, 'processing', now() - interval '1 hour') RETURNING id`
    // updated_at is maintained by a trigger on UPDATE only, so the insert keeps the old value.
    const failed = await failStalledSessions(15)
    expect(failed.map((x) => x.id)).toContain(id)
    const [s] = await sessions(companyId)
    expect(s).toMatchObject({ status: 'failed' })
    expect(s.error).toContain('нет активных задач')
  })
})
