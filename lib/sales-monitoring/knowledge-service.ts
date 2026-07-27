import { createHash } from 'crypto'
import { gateway } from '@ai-sdk/gateway'
import { embed, generateText } from 'ai'
import type {
  ActionDraft,
  AssistantAnswer,
  AssistantCitation,
} from '@/types/sales-monitoring'
import type { SalesAccessContext } from './access'
import { requireSalesPermission } from './access'
import { getSalesDashboard } from './analytics-service'
import { query, withTransaction } from './database'
import { DomainError } from './errors'
import { createExpense } from './expense-service'
import { createPlan } from './plan-service'
import { createProductRequest } from './product-service'
import { createSale, reverseSale } from './sales-service'
import { reverseExpense } from './expense-service'
import {
  createExpenseSchema,
  createPlanSchema,
  createSaleSchema,
  productRequestSchema,
} from './schemas'

export const KNOWLEDGE_MODELS = {
  generation: 'anthropic/claude-sonnet-4.6',
  embedding: 'openai/text-embedding-3-small',
} as const

interface KnowledgeHit {
  chunk_id: string
  document_id: string
  content: string
  source_locator: Record<string, unknown>
  score: number
}

function vectorLiteral(values: number[]): string {
  return `[${values.join(',')}]`
}

async function embedQuestion(question: string): Promise<number[] | null> {
  if (!process.env.AI_GATEWAY_API_KEY) return null
  const result = await embed({
    model: gateway.embeddingModel(KNOWLEDGE_MODELS.embedding),
    value: question,
  })
  return result.embedding
}

export async function retrieveKnowledge(input: {
  organizationId: string
  question: string
  limit?: number
}): Promise<KnowledgeHit[]> {
  const embedding = await embedQuestion(input.question)
  if (embedding) {
    return query<KnowledgeHit>(
      `SELECT * FROM match_knowledge_chunks($1, $2, $3::vector, $4)`,
      [
        input.organizationId,
        input.question,
        vectorLiteral(embedding),
        Math.min(input.limit ?? 8, 20),
      ],
    )
  }
  return query<KnowledgeHit>(
    `SELECT
       kc.id AS chunk_id, kc.document_id, kc.content, kc.source_locator,
       ts_rank_cd(kc.content_tsv, websearch_to_tsquery('simple', $2))::float8 AS score
     FROM knowledge_chunks kc
     JOIN knowledge_documents kd ON kd.id = kc.document_id
     WHERE kc.organization_id = $1 AND kd.status = 'ready'
       AND kc.content_tsv @@ websearch_to_tsquery('simple', $2)
     ORDER BY score DESC
     LIMIT $3`,
    [input.organizationId, input.question, Math.min(input.limit ?? 8, 20)],
  )
}

function defaultPeriod(filters: { from?: string; to?: string }) {
  const now = new Date()
  return {
    from: filters.from ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10),
    to: filters.to ?? now.toISOString().slice(0, 10),
  }
}

function isFinancialQuestion(question: string) {
  return /выруч|продаж|марж|прибыл|расход|p&l|ддс|план|факт|себестоим|бонус/i.test(question)
}

async function ensureConversation(
  organizationId: string,
  actorId: string,
  conversationId?: string,
) {
  if (conversationId) {
    const rows = await query<{ id: string }>(
      `SELECT id FROM assistant_conversations
       WHERE id = $1::uuid AND organization_id = $2 AND user_id = $3`,
      [conversationId, organizationId, actorId],
    )
    if (!rows[0]) throw new DomainError('CONVERSATION_NOT_FOUND', 'Диалог не найден', 404)
    return conversationId
  }
  const rows = await query<{ id: string }>(
    `INSERT INTO assistant_conversations (organization_id, user_id)
     VALUES ($1,$2) RETURNING id`,
    [organizationId, actorId],
  )
  return rows[0].id
}

export async function answerQuestion(input: {
  organizationId: string
  conversationId?: string
  question: string
  filters: {
    from?: string
    to?: string
    regionId?: string
    channelId?: string
  }
  access: SalesAccessContext
}): Promise<AssistantAnswer> {
  const conversationId = await ensureConversation(
    input.organizationId,
    input.access.actorId,
    input.conversationId,
  )
  const period = defaultPeriod(input.filters)
  const financial = isFinancialQuestion(input.question)
    ? await getSalesDashboard({
      organizationId: input.organizationId,
      from: period.from,
      to: period.to,
      regionId: input.filters.regionId,
      channelId: input.filters.channelId,
    })
    : null
  const hits = await retrieveKnowledge({
    organizationId: input.organizationId,
    question: input.question,
  })

  const citations: AssistantCitation[] = []
  if (financial) {
    citations.push({
      kind: 'metric',
      sourceId: `dashboard:${input.organizationId}:${period.from}:${period.to}`,
      label: `Управленческий ledger за ${period.from} — ${period.to}`,
      locator: financial.filters,
    })
  }
  hits.forEach((hit, index) => {
    citations.push({
      kind: 'document',
      sourceId: hit.document_id,
      label: `Документ ${index + 1}`,
      locator: hit.source_locator,
      excerpt: hit.content.slice(0, 260),
    })
  })

  const context = [
    financial ? `ПРОВЕРЕННЫЕ SQL-МЕТРИКИ:\n${JSON.stringify(financial)}` : '',
    hits.length
      ? `ФРАГМЕНТЫ ДОКУМЕНТОВ:\n${hits.map((hit, index) => `[D${index + 1}] ${hit.content}`).join('\n\n')}`
      : '',
  ].filter(Boolean).join('\n\n')

  let answer: string
  let model = 'deterministic-fallback'
  if (process.env.AI_GATEWAY_API_KEY) {
    const generated = await generateText({
      model: gateway(KNOWLEDGE_MODELS.generation),
      system: `Ты — финансовый аналитик системы AIStart360.
Отвечай только по предоставленным SQL-метрикам и фрагментам документов.
Не придумывай цифры. Финансовые метрики из SQL имеют приоритет над текстом.
Каждое утверждение со ссылкой помечай [M1] для метрик или [D1], [D2] для документов.
Если данных недостаточно, прямо скажи об этом.
Ты не изменяешь данные и не обещаешь, что действие выполнено.`,
      prompt: `Вопрос пользователя:\n${input.question}\n\nКонтекст:\n${context || 'Контекст не найден.'}`,
      maxRetries: 2,
      providerOptions: {
        gateway: { zeroDataRetention: true },
      },
    })
    answer = generated.text
    model = KNOWLEDGE_MODELS.generation
  } else if (financial) {
    answer = `За период ${period.from} — ${period.to}: выручка ${financial.kpis.revenue} ₸, валовая прибыль ${financial.kpis.grossProfit} ₸, расходы ${financial.kpis.expenses} ₸, операционный результат ${financial.kpis.operatingProfit} ₸. [M1]`
    if (hits[0]) answer += `\n\nСвязанный документ: ${hits[0].content.slice(0, 320)} [D1]`
  } else if (hits[0]) {
    answer = `${hits[0].content.slice(0, 900)} [D1]`
  } else {
    answer = 'В доступных данных и документах не найдено достаточно информации для подтверждённого ответа.'
  }

  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO assistant_messages (conversation_id, role, content)
       VALUES ($1::uuid,'user',$2)`,
      [conversationId, input.question],
    )
    await client.query(
      `INSERT INTO assistant_messages (
         conversation_id, role, content, citations, retrieval_trace, model_id, prompt_version
       ) VALUES ($1::uuid,'assistant',$2,$3::jsonb,$4::jsonb,$5,'sales-rag-v1')`,
      [
        conversationId,
        answer,
        JSON.stringify(citations),
        JSON.stringify({
          financialQuery: Boolean(financial),
          documentHits: hits.map((hit) => ({ id: hit.chunk_id, score: hit.score })),
        }),
        model,
      ],
    )
  })

  return {
    conversationId,
    answer,
    asOf: new Date().toISOString(),
    citations,
    model,
    grounded: citations.length > 0,
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function validateActionPayload(actionType: ActionDraft['actionType'], payload: Record<string, unknown>) {
  if (actionType === 'create_sale') return createSaleSchema.parse(payload)
  if (actionType === 'create_expense') return createExpenseSchema.parse(payload)
  if (actionType === 'create_plan') return createPlanSchema.parse(payload)
  if (actionType === 'create_product_request') return productRequestSchema.parse(payload)
  if (actionType === 'reverse_sale') {
    if (!payload.saleId || !payload.reason) throw new DomainError('ACTION_PAYLOAD_INVALID', 'Нужны saleId и reason', 422)
  }
  if (actionType === 'reverse_expense') {
    if (!payload.expenseId || !payload.reason) throw new DomainError('ACTION_PAYLOAD_INVALID', 'Нужны expenseId и reason', 422)
  }
  return payload
}

export async function createActionDraft(input: {
  organizationId: string
  conversationId?: string
  actionType: ActionDraft['actionType']
  payload: Record<string, unknown>
  access: SalesAccessContext
}): Promise<ActionDraft> {
  const validated = validateActionPayload(input.actionType, input.payload) as Record<string, unknown>
  const conversationId = input.conversationId
    ? await ensureConversation(input.organizationId, input.access.actorId, input.conversationId)
    : undefined
  const preview = {
    actionType: input.actionType,
    values: validated,
    warning: 'Перед выполнением права, период, справочники и суммы будут проверены повторно.',
  }
  const checksum = createHash('sha256')
    .update(canonicalJson({ actionType: input.actionType, payload: validated, preview }))
    .digest('hex')
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000)
  const rows = await query<{ id: string }>(
    `INSERT INTO assistant_action_drafts (
       organization_id, conversation_id, created_by, action_type,
       payload, preview, checksum, expires_at
     ) VALUES ($1,$2::uuid,$3,$4,$5::jsonb,$6::jsonb,$7,$8)
     RETURNING id`,
    [
      input.organizationId,
      conversationId ?? null,
      input.access.actorId,
      input.actionType,
      JSON.stringify(validated),
      JSON.stringify(preview),
      checksum,
      expiresAt,
    ],
  )
  return {
    id: rows[0].id,
    actionType: input.actionType,
    payload: validated,
    preview,
    checksum,
    status: 'pending',
    expiresAt: expiresAt.toISOString(),
  }
}

const actionPermission = {
  create_sale: 'sales:write',
  create_expense: 'expenses:write',
  create_plan: 'plans:write',
  reverse_sale: 'sales:reverse',
  reverse_expense: 'expenses:reverse',
  create_product_request: 'sales:write',
} as const

export async function confirmActionDraft(input: {
  organizationId: string
  draftId: string
  checksum: string
  request?: Request
}) {
  const drafts = await query<{
    id: string
    created_by: string
    action_type: ActionDraft['actionType']
    payload: Record<string, unknown>
    checksum: string
    status: string
    expires_at: Date
    result: Record<string, unknown> | null
  }>(
    `SELECT id, created_by, action_type, payload, checksum, status, expires_at, result
     FROM assistant_action_drafts
     WHERE id = $1::uuid AND organization_id = $2`,
    [input.draftId, input.organizationId],
  )
  const draft = drafts[0]
  if (!draft) throw new DomainError('ACTION_DRAFT_NOT_FOUND', 'Черновик действия не найден', 404)
  const access = await requireSalesPermission(
    input.organizationId,
    actionPermission[draft.action_type],
  )
  if (draft.created_by !== access.actorId) {
    throw new DomainError('ACTION_DRAFT_FORBIDDEN', 'Подтвердить черновик может только его автор', 403)
  }
  if (draft.status === 'confirmed' && draft.result) return draft.result
  if (draft.status !== 'pending') throw new DomainError('ACTION_DRAFT_NOT_PENDING', 'Черновик уже недоступен', 409)
  if (draft.expires_at.getTime() <= Date.now()) {
    await query(`UPDATE assistant_action_drafts SET status = 'expired' WHERE id = $1::uuid`, [draft.id])
    throw new DomainError('ACTION_DRAFT_EXPIRED', 'Срок подтверждения черновика истёк', 409)
  }
  if (draft.checksum !== input.checksum) {
    throw new DomainError('ACTION_DRAFT_CHANGED', 'Контрольная сумма черновика не совпадает', 409)
  }

  const key = `assistant-draft:${draft.id}`
  let result: unknown
  if (draft.action_type === 'create_sale') {
    result = await createSale(
      createSaleSchema.parse(draft.payload),
      access,
      key,
      input.request,
    )
  } else if (draft.action_type === 'create_expense') {
    result = await createExpense(
      createExpenseSchema.parse(draft.payload),
      access,
      key,
      input.request,
    )
  } else if (draft.action_type === 'create_plan') {
    result = await createPlan(
      createPlanSchema.parse(draft.payload),
      access,
      key,
      input.request,
    )
  } else if (draft.action_type === 'reverse_sale') {
    result = await reverseSale({
      organizationId: input.organizationId,
      saleId: String(draft.payload.saleId),
      reason: String(draft.payload.reason),
    }, access, key, input.request)
  } else if (draft.action_type === 'reverse_expense') {
    result = await reverseExpense({
      organizationId: input.organizationId,
      expenseId: String(draft.payload.expenseId),
      reason: String(draft.payload.reason),
    }, access, key, input.request)
  } else {
    result = await createProductRequest(
      productRequestSchema.parse(draft.payload),
      access,
      input.request,
    )
  }
  const stored = JSON.parse(JSON.stringify(result)) as Record<string, unknown>
  await query(
    `UPDATE assistant_action_drafts
     SET status = 'confirmed', confirmed_at = now(), result = $2::jsonb
     WHERE id = $1::uuid`,
    [draft.id, JSON.stringify(stored)],
  )
  return stored
}
