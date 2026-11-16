/**
 * R3-PA — what runs after a written Point A (lib/point-a/snapshot.ts):
 *
 * B2: the automatic recalculation started the diagnostic pipeline with
 *     input.trigger 'event', which the orchestrator's schema refused → every
 *     task died with INVALID_INPUT (29 dead tasks on the staging copy). The
 *     input the snapshot enqueues must pass the REAL schema of the agent and
 *     open a session with the same trigger.
 * B3: the AI hypotheses of blocks without data ran for an owner whose Точка А
 *     is closed (Free) — budget spent on what he never sees.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  enqueued: [] as Array<Record<string, unknown>>,
  hypotheses: 0,
  generated: 0,
  saved: [] as Array<{ table: string; payload: Record<string, unknown>; id: unknown }>,
}))

vi.mock('@/lib/agents/queue', () => ({ enqueueAgentTask: async (t: Record<string, unknown>) => { h.enqueued.push(t); return { id: 't-1' } } }))
vi.mock('@/lib/background', () => ({
  runInBackground: async (_l: string, work: () => Promise<unknown>) => { await work() },
  trackBackground: () => undefined,
}))
vi.mock('@/lib/events/platform', () => ({ emitPlatformEventSafely: () => undefined }))
vi.mock('@/lib/events/track', () => ({ trackEvent: async () => undefined }))
vi.mock('@/lib/internal-auth', () => ({ internalBaseUrl: () => 'https://app.test', internalFetchHeaders: () => ({}) }))
vi.mock('@/lib/ai/budget', () => ({ assertAiBudget: async () => undefined, isAiBudgetError: () => false }))
vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({
    from: (table: string) => ({ update: (payload: Record<string, unknown>) => ({ eq: async (_c: string, id: unknown) => { h.saved.push({ table, payload, id }); return { error: null } } }) }),
  }),
}))
vi.mock('@/lib/point-a/v4/hypotheses', async () => {
  const real = await vi.importActual<typeof import('@/lib/point-a/v4/hypotheses')>('@/lib/point-a/v4/hypotheses')
  return {
    ...real,
    generateHypotheses: async (blocks: Array<Record<string, unknown>>) => {
      h.hypotheses += 1
      if (!h.generated) return { blocks, generated: 0 }
      return { blocks: blocks.map((b) => ({ ...b, hypothesis: { score: 42, confidence: 0.3, rationale: 'Оценка по неполным данным', generatedAt: '2026-11-15T10:00:00Z' } })), generated: blocks.length }
    },
  }
})

const { afterWritePlan, runAfterWrite } = await import('@/lib/point-a/snapshot')
const { startDiagnosticPipeline, pipelineTriggerOf } = await import('@/lib/point-a/diagnostic-row')
const { diagnosticOrchestratorAgent } = await import('@/lib/agents/definitions/diagnostics')

const ANALYZE = '/api/v1/diagnostics/ai-analyze' as const
const BLOCK_NEEDING = { key: 'marketing', title: 'Маркетинг', weight: 0.2, hiddenForClient: false, informational: false, order: 1, status: 'insufficient_data', score: null, coverage: 0.2, confidence: 0.1, earned: 1, possible: 2, checks: [], top_issues: [], recommendations: [], needs: [], conflicts: [], inputsHash: 'x' }

function input(over: Record<string, unknown> = {}) {
  return {
    companyId: 'co', ownerId: 'owner', diagnosticId: 'd-1', snapshotId: 's-1', engine: 'v4' as const,
    written: { overall_score: 61 } as never, preliminary: false, noScore: false, changes: [], trigger: 'event' as const,
    locale: 'ru', blocks: [BLOCK_NEEDING] as never, industry: null, paidPaths: [ANALYZE] as const,
    ...over,
  }
}

beforeEach(() => {
  h.enqueued = []
  h.hypotheses = 0
  h.generated = 0
  h.saved = []
  process.env.OPENROUTER_API_KEY = 'k'
  // The paid fan-out of a Pro owner is fired too: answered here, never on the network.
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{"ok":true}', { status: 200 })))
})

afterEach(() => vi.unstubAllGlobals())

describe('B2 — the pipeline input passes the orchestrator\'s own schema', () => {
  for (const trigger of ['event', 'schedule', 'manual', 'expert'] as const) {
    it(`snapshot trigger «${trigger}» → a valid orchestrator input`, async () => {
      startDiagnosticPipeline({ companyId: 'co', diagnosticId: 'd-1', requestedBy: 'system:point-a', trigger: pipelineTriggerOf(trigger), reason: 'r' })
      await vi.waitFor(() => expect(h.enqueued).toHaveLength(1))
      const task = h.enqueued[0]
      expect(diagnosticOrchestratorAgent.inputSchema.safeParse(task.input).success).toBe(true)
      expect(task.trigger).toBe((task.input as { trigger: string }).trigger)
    })
  }

  it('the orchestrator opens the session with the trigger it was given (event stays event)', async () => {
    const parsed = diagnosticOrchestratorAgent.inputSchema.parse({ action: 'start', trigger: 'event', reason: 'пересчёт' })
    const calls: Array<[string, Record<string, unknown>]> = []
    const ctx = { sessionId: null, tool: async (name: string, args: Record<string, unknown>) => { calls.push([name, args]); return { session_id: 's', created: true, next: 'data_collection' } } }
    await diagnosticOrchestratorAgent.run(ctx as never, parsed)
    expect(calls[0]).toEqual(['session.open', expect.objectContaining({ trigger: 'event' })])
  })

  it('a manual run is unchanged', () => {
    expect(diagnosticOrchestratorAgent.inputSchema.safeParse({ action: 'start', trigger: 'manual' }).success).toBe(true)
    expect(diagnosticOrchestratorAgent.inputSchema.safeParse({ action: 'start', trigger: 'bogus' }).success).toBe(false)
  })

  it('runAfterWrite enqueues the pipeline with that input; never from the pipeline itself', async () => {
    await runAfterWrite(input({ trigger: 'schedule' }))
    expect(h.enqueued.map((t) => (t.input as Record<string, unknown>).trigger)).toEqual(['schedule'])
    h.enqueued = []
    await runAfterWrite(input({ fromPipeline: true }))
    expect(h.enqueued).toEqual([])
  })
})

describe('B3 — AI hypotheses only for an owner whose Точка А is open', () => {
  it('the plan: Free (no paid path) → no hypotheses; Pro → yes; before the full survey → no', () => {
    const env = { aiConfigured: true, baseUrl: 'https://app.test' }
    expect(afterWritePlan(input({ paidPaths: [] }), env).hypotheses).toBe(false)
    expect(afterWritePlan(input(), env).hypotheses).toBe(true)
    expect(afterWritePlan(input({ paidPaths: undefined }), env).hypotheses).toBe(true)
    expect(afterWritePlan(input({ preliminary: true }), env).hypotheses).toBe(false)
    expect(afterWritePlan(input(), { ...env, aiConfigured: false }).hypotheses).toBe(false)
    // no official score: no paid analysis, hypotheses still (they help to get the data)
    expect(afterWritePlan(input({ noScore: true }), env)).toMatchObject({ fanOut: false, hypotheses: true })
  })

  it('runAfterWrite: a Free owner gets no hypothesis call; a Pro owner does', async () => {
    await runAfterWrite(input({ paidPaths: [] }))
    expect(h.hypotheses).toBe(0)
    await runAfterWrite(input())
    expect(h.hypotheses).toBe(1)
  })

  it('a generated hypothesis is saved into ITS snapshot (the save path itself works)', async () => {
    h.generated = 1
    await runAfterWrite(input())
    const saved = h.saved.filter((x) => x.table === 'point_a_snapshots')
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ table: 'point_a_snapshots', id: 's-1' })
    expect((saved[0].payload.blocks as Array<{ hypothesis?: { score: number } }>)[0].hypothesis?.score).toBe(42)
  })
})
