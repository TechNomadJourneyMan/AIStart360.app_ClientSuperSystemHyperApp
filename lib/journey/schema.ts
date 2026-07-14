import { z } from 'zod'

const shortText = z.string().trim().min(1).max(240)
const bodyText = z.string().trim().min(1).max(4_000)
const optionalShortText = z.string().trim().max(240).optional()
const id = z.string().trim().min(1).max(120).regex(/^[a-zA-Z0-9:_-]+$/)
const httpsUrl = z
  .string()
  .url()
  .max(1_000)
  .refine((value) => value.startsWith('https://'), 'Only HTTPS URLs are allowed')

export const journeyPhaseSchema = z.enum([
  'empty',
  'loading',
  'analyzing',
  'partial',
  'ready',
  'error',
])

export const journeyMessageSchema = z
  .object({
    id,
    role: z.enum(['user', 'assistant', 'system']),
    text: bodyText,
    createdAt: z.string().datetime(),
  })
  .strict()

export const journeyFactSchema = z
  .object({
    id,
    label: shortText,
    value: z.string().trim().min(1).max(1_000),
    category: z.enum([
      'business',
      'product',
      'clients',
      'sales',
      'marketing',
      'finance',
      'operations',
      'team',
      'goal',
      'other',
    ]),
    sourceLabel: shortText,
    confidence: z.number().min(0).max(1).optional(),
    status: z.enum(['pending', 'confirmed', 'rejected']),
  })
  .strict()

export const journeyGoalSchema = z
  .object({
    id,
    title: bodyText,
    metric: optionalShortText,
    target: optionalShortText,
    deadline: optionalShortText,
    status: z.enum(['draft', 'confirmed']),
  })
  .strict()

export const journeyRoadmapItemSchema = z
  .object({
    id,
    title: shortText,
    description: z.string().trim().max(1_200),
    horizon: shortText,
    progress: z.number().min(0).max(100),
    status: z.enum(['next', 'planned', 'done']),
    dependsOn: z.array(id).max(8).optional(),
  })
  .strict()

export const journeyFileSchema = z
  .object({
    id,
    name: z.string().trim().min(1).max(255),
    sizeBytes: z.number().int().min(0).max(4 * 1024 * 1024),
    mime: z.string().trim().max(160),
    status: z.enum(['queued', 'uploading', 'analyzing', 'ready', 'local-only', 'error']),
    statusLabel: shortText,
    documentId: id.optional(),
  })
  .strict()

export const journeySuggestionSchema = z
  .object({
    id,
    label: shortText,
    value: z.string().trim().min(1).max(800),
    target: z.enum(['chat', 'point-a', 'roadmap', 'point-b', 'widget']),
    status: z.enum(['active', 'rejected', 'hidden']),
  })
  .strict()

const widgetPositionSchema = z
  .object({
    x: z.number().min(0).max(1_600),
    y: z.number().min(0).max(1_000),
  })
  .strict()

const widgetBase = {
  id,
  title: shortText,
  priority: z.number().int().min(0).max(100),
  collapsed: z.boolean(),
  hidden: z.boolean(),
  focused: z.boolean(),
  position: widgetPositionSchema,
}

const metricSchema = z
  .object({
    label: shortText,
    value: optionalShortText,
    status: z.enum(['known', 'unknown', 'assumption']),
    sourceLabel: optionalShortText,
  })
  .strict()

const noteSchema = z
  .object({
    title: shortText,
    detail: z.string().trim().max(800),
    status: z.enum(['known', 'question', 'opportunity', 'risk']),
  })
  .strict()

const businessPassportWidgetSchema = z
  .object({
    ...widgetBase,
    kind: z.literal('business_passport'),
    data: z.object({ facts: z.array(journeyFactSchema).max(16) }).strict(),
  })
  .strict()

const businessHealthWidgetSchema = z
  .object({
    ...widgetBase,
    kind: z.literal('business_health'),
    data: z
      .object({
        dimensions: z
          .array(
            z
              .object({
                label: shortText,
                score: z.number().min(0).max(100).nullable(),
                status: z.enum(['healthy', 'attention', 'unknown']),
                basis: z.string().trim().max(600),
              })
              .strict(),
          )
          .max(10),
      })
      .strict(),
  })
  .strict()

const pointBGoalsWidgetSchema = z
  .object({
    ...widgetBase,
    kind: z.literal('point_b_goals'),
    data: z.object({ goals: z.array(journeyGoalSchema).max(10) }).strict(),
  })
  .strict()

const roadmapActionsWidgetSchema = z
  .object({
    ...widgetBase,
    kind: z.literal('roadmap_actions'),
    data: z.object({ items: z.array(journeyRoadmapItemSchema).max(20) }).strict(),
  })
  .strict()

const crmReadinessWidgetSchema = z
  .object({
    ...widgetBase,
    kind: z.literal('crm_readiness'),
    data: z
      .object({
        hasCrm: z.boolean().nullable(),
        currentTool: optionalShortText,
        connectionStatus: z.enum(['unknown', 'not_connected', 'connected', 'not_needed_yet']),
        nextStep: bodyText,
        alternatives: z
          .array(z.object({ name: shortText, reason: z.string().trim().max(500) }).strict())
          .max(4),
      })
      .strict(),
  })
  .strict()

const salesFunnelWidgetSchema = z
  .object({
    ...widgetBase,
    kind: z.literal('sales_funnel'),
    data: z
      .object({
        connected: z.boolean(),
        metrics: z.array(metricSchema).max(10),
        nextQuestion: optionalShortText,
      })
      .strict(),
  })
  .strict()

const marketingGrowthWidgetSchema = z
  .object({
    ...widgetBase,
    kind: z.literal('marketing_growth'),
    data: z
      .object({
        channels: z.array(metricSchema).max(10),
        opportunities: z.array(noteSchema).max(8),
      })
      .strict(),
  })
  .strict()

const financeCashflowWidgetSchema = z
  .object({
    ...widgetBase,
    kind: z.literal('finance_cashflow'),
    data: z
      .object({
        metrics: z.array(metricSchema).max(12),
        sourceStatus: z.enum(['connected', 'file', 'manual', 'missing']),
        nextQuestion: optionalShortText,
      })
      .strict(),
  })
  .strict()

const operationsTeamWidgetSchema = z
  .object({
    ...widgetBase,
    kind: z.literal('operations_team'),
    data: z
      .object({
        signals: z.array(noteSchema).max(10),
        nextQuestion: optionalShortText,
      })
      .strict(),
  })
  .strict()

const risksOpportunitiesWidgetSchema = z
  .object({
    ...widgetBase,
    kind: z.literal('risks_opportunities'),
    data: z
      .object({
        risks: z.array(noteSchema).max(8),
        opportunities: z.array(noteSchema).max(8),
      })
      .strict(),
  })
  .strict()

const newsDigestWidgetSchema = z
  .object({
    ...widgetBase,
    kind: z.literal('news_digest'),
    data: z
      .object({
        connected: z.boolean(),
        statusText: shortText,
        items: z
          .array(
            z
              .object({
                title: shortText,
                source: shortText,
                url: httpsUrl,
                publishedAt: z.string().datetime(),
              })
              .strict(),
          )
          .max(8),
      })
      .strict(),
  })
  .strict()

const tasksRemindersWidgetSchema = z
  .object({
    ...widgetBase,
    kind: z.literal('tasks_reminders'),
    data: z
      .object({
        items: z
          .array(
            z
              .object({
                id,
                text: shortText,
                due: optionalShortText,
                done: z.boolean(),
              })
              .strict(),
          )
          .max(20),
      })
      .strict(),
  })
  .strict()

const learningResourcesWidgetSchema = z
  .object({
    ...widgetBase,
    kind: z.literal('learning_resources'),
    data: z
      .object({
        connected: z.boolean(),
        statusText: shortText,
        items: z
          .array(
            z
              .object({
                title: shortText,
                source: shortText,
                url: httpsUrl,
                reason: z.string().trim().max(500),
              })
              .strict(),
          )
          .max(8),
      })
      .strict(),
  })
  .strict()

const knowledgeBaseWidgetSchema = z
  .object({
    ...widgetBase,
    kind: z.literal('knowledge_base'),
    data: z.object({ files: z.array(journeyFileSchema).max(30) }).strict(),
  })
  .strict()

const externalSourcesWidgetSchema = z
  .object({
    ...widgetBase,
    kind: z.literal('external_sources'),
    data: z
      .object({
        sources: z
          .array(
            z
              .object({
                name: shortText,
                kind: z.enum(['crm', 'finance', 'analytics', 'commerce', 'other']),
                status: z.enum(['connected', 'available', 'not_connected', 'unsupported']),
                nextStep: shortText,
              })
              .strict(),
          )
          .max(12),
      })
      .strict(),
  })
  .strict()

/**
 * Safe domain adapters. The model may tailor titles, metrics and stages to a
 * tomato shop, insurer, clinic, factory, etc., but it still cannot emit markup,
 * scripts or a new component kind. Unknown values stay explicitly unknown.
 */
const domainMetricsWidgetSchema = z
  .object({
    ...widgetBase,
    kind: z.literal('domain_metrics'),
    data: z
      .object({
        domain: shortText,
        purpose: z.string().trim().max(600),
        metrics: z.array(metricSchema).min(1).max(12),
        guidance: z.array(noteSchema).max(6),
      })
      .strict(),
  })
  .strict()

const domainProcessWidgetSchema = z
  .object({
    ...widgetBase,
    kind: z.literal('domain_process'),
    data: z
      .object({
        domain: shortText,
        purpose: z.string().trim().max(600),
        stages: z
          .array(
            z
              .object({
                id,
                name: shortText,
                status: z.enum(['unknown', 'blocked', 'next', 'active', 'done']),
                metric: optionalShortText,
                nextAction: optionalShortText,
                dependsOn: z.array(id).max(6).optional(),
              })
              .strict(),
          )
          .min(1)
          .max(12),
      })
      .strict(),
  })
  .strict()

export const journeyWidgetSchema = z.discriminatedUnion('kind', [
  businessPassportWidgetSchema,
  businessHealthWidgetSchema,
  pointBGoalsWidgetSchema,
  roadmapActionsWidgetSchema,
  crmReadinessWidgetSchema,
  salesFunnelWidgetSchema,
  marketingGrowthWidgetSchema,
  financeCashflowWidgetSchema,
  operationsTeamWidgetSchema,
  risksOpportunitiesWidgetSchema,
  newsDigestWidgetSchema,
  tasksRemindersWidgetSchema,
  learningResourcesWidgetSchema,
  knowledgeBaseWidgetSchema,
  externalSourcesWidgetSchema,
  domainMetricsWidgetSchema,
  domainProcessWidgetSchema,
])

export const journeyWidgetDecisionSchema = z
  .object({
    widgetId: id,
    kind: z.enum([
      'business_passport',
      'business_health',
      'point_b_goals',
      'roadmap_actions',
      'crm_readiness',
      'sales_funnel',
      'marketing_growth',
      'finance_cashflow',
      'operations_team',
      'risks_opportunities',
      'news_digest',
      'tasks_reminders',
      'learning_resources',
      'knowledge_base',
      'external_sources',
      'domain_metrics',
      'domain_process',
    ]),
    action: z.enum(['create', 'update', 'keep', 'hide']),
    reason: z.string().trim().min(1).max(360),
    evidenceFactIds: z.array(id).max(12),
  })
  .strict()

export const journeyStateSchema = z
  .object({
    version: z.literal(1),
    workspaceId: z.string().trim().min(8).max(120),
    phase: journeyPhaseSchema,
    companyName: z.string().trim().max(240),
    businessDescription: z.string().trim().max(4_000),
    messages: z.array(journeyMessageSchema).max(80),
    facts: z.array(journeyFactSchema).max(80),
    goals: z.array(journeyGoalSchema).max(20),
    roadmap: z.array(journeyRoadmapItemSchema).max(30),
    widgets: z.array(journeyWidgetSchema).max(24),
    // Optional for backward compatibility with workspaces saved before
    // explainable widget selection was introduced. AI updates always provide it.
    widgetDecisions: z.array(journeyWidgetDecisionSchema).max(24).optional(),
    // User-owned layout metadata lives outside model-generated widget specs.
    // This lets the orchestrator refresh widget content without silently
    // resetting positions that a person arranged on the board.
    manualWidgetIds: z.array(id).max(24).optional(),
    // Visual ordering is also user-owned. It must not reuse AI `priority`,
    // which controls product relevance and progressive disclosure.
    widgetOrder: z.array(id).max(24).optional(),
    files: z.array(journeyFileSchema).max(30),
    suggestions: z.array(journeySuggestionSchema).max(8),
    provider: z
      .object({
        mode: z.enum(['live', 'demo', 'unavailable']),
        label: shortText,
      })
      .strict(),
    persistence: z
      .object({
        mode: z.enum(['database', 'local', 'unavailable']),
        label: shortText,
        reason: z.string().trim().max(500).optional(),
      })
      .strict(),
    // Synchronization metadata is written by the server, never by the model.
    serverRevision: z.number().int().min(0).optional(),
    updatedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((state, context) => {
    const widgets = new Map(state.widgets.map((widget) => [widget.id, widget]))
    const widgetKinds = new Set<JourneyWidgetKind>()
    const factIds = new Set(state.facts.map((fact) => fact.id))
    const decisions = new Set<string>()

    for (const [index, widget] of state.widgets.entries()) {
      if (widgetKinds.has(widget.kind)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['widgets', index, 'kind'],
          message: 'Only one widget is allowed per allowlisted kind',
        })
      }
      widgetKinds.add(widget.kind)
    }

    for (const [index, decision] of (state.widgetDecisions ?? []).entries()) {
      if (decisions.has(decision.widgetId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['widgetDecisions', index, 'widgetId'],
          message: 'Only one decision is allowed per widget',
        })
      }
      decisions.add(decision.widgetId)

      const widget = widgets.get(decision.widgetId)
      if (!widget || widget.kind !== decision.kind) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['widgetDecisions', index, 'kind'],
          message: 'Decision must reference an existing widget with the same allowlisted kind',
        })
      }
      for (const [factIndex, factId] of decision.evidenceFactIds.entries()) {
        if (!factIds.has(factId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['widgetDecisions', index, 'evidenceFactIds', factIndex],
            message: 'Decision evidence must reference a fact in the workspace',
          })
        }
      }
    }
    validateRoadmapGraph(state.roadmap, context)
  })

export const journeyAiUpdateSchema = z
  .object({
    phase: z.enum(['partial', 'ready']),
    companyName: z.string().trim().max(240).optional(),
    businessDescription: z.string().trim().max(4_000).optional(),
    assistantMessage: bodyText,
    facts: z.array(journeyFactSchema).max(20),
    goals: z.array(journeyGoalSchema).max(8),
    roadmap: z.array(journeyRoadmapItemSchema).max(20),
    widgets: z.array(journeyWidgetSchema).max(10),
    widgetDecisions: z.array(journeyWidgetDecisionSchema).max(10),
    suggestions: z.array(journeySuggestionSchema).max(4),
    cameraTarget: z
      .object({
        target: z.enum(['point-a', 'roadmap', 'point-b', 'widget']),
        widgetId: id.optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((update, context) => {
    if (
      update.phase === 'ready' &&
      (!update.goals.some(isMeasurableConfirmedGoal) || update.roadmap.length === 0)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['phase'],
        message: 'ready requires a confirmed goal with metric, target and deadline plus a roadmap',
      })
    }
    if (update.widgets.filter((widget) => !widget.hidden && !widget.collapsed).length > 4) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['widgets'],
        message: 'At most four widgets may be expanded',
      })
    }
    const widgetKinds = new Set<JourneyWidgetKind>()
    for (const [index, widget] of update.widgets.entries()) {
      if (widgetKinds.has(widget.kind)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['widgets', index, 'kind'],
          message: 'Only one widget is allowed per allowlisted kind',
        })
      }
      widgetKinds.add(widget.kind)
      if (widget.kind === 'business_passport' && widget.data.facts.some((fact) => fact.status !== 'pending')) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['widgets', index, 'data', 'facts'],
          message: 'Model-provided passport facts must remain pending',
        })
      }
      if (
        (widget.kind === 'news_digest' || widget.kind === 'learning_resources') &&
        (widget.data.connected || widget.data.items.length > 0)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['widgets', index, 'data'],
          message: 'External links are server-owned and cannot be supplied by the model',
        })
      }
      if (
        widget.kind === 'external_sources' &&
        widget.data.sources.some((source) => source.status === 'connected')
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['widgets', index, 'data', 'sources'],
          message: 'Connection status is server-owned',
        })
      }
      if (widget.kind === 'crm_readiness' && widget.data.connectionStatus === 'connected') {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['widgets', index, 'data', 'connectionStatus'],
          message: 'CRM connection status is server-owned',
        })
      }
    }

    const widgets = new Map(update.widgets.map((widget) => [widget.id, widget]))
    const proposedFacts = new Map(update.facts.map((fact) => [fact.id, fact]))
    const decisionIds = new Set<string>()
    for (const [index, decision] of update.widgetDecisions.entries()) {
      if (decisionIds.has(decision.widgetId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['widgetDecisions', index, 'widgetId'],
          message: 'Only one decision is allowed per widget',
        })
      }
      decisionIds.add(decision.widgetId)
      const widget = widgets.get(decision.widgetId)
      if (!widget || widget.kind !== decision.kind) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['widgetDecisions', index, 'kind'],
          message: 'Decision must match a widget in this update',
        })
      }
      if (decision.action === 'hide' && widget && !widget.hidden) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['widgetDecisions', index, 'action'],
          message: 'A hide decision requires a hidden widget',
        })
      }
      for (const [factIndex, factId] of decision.evidenceFactIds.entries()) {
        if (proposedFacts.get(factId)?.status === 'rejected') {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['widgetDecisions', index, 'evidenceFactIds', factIndex],
            message: 'Rejected facts cannot support a widget decision',
          })
        }
      }
    }
    for (const [index, widget] of update.widgets.entries()) {
      if (!decisionIds.has(widget.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['widgets', index, 'id'],
          message: 'Every model-selected widget requires an explainable decision',
        })
      }
    }

    validateRoadmapGraph(update.roadmap, context)
  })

function validateRoadmapGraph(
  roadmap: Array<z.infer<typeof journeyRoadmapItemSchema>>,
  context: z.RefinementCtx,
): void {
  const itemIndex = new Map<string, number>()
  for (const [index, item] of roadmap.entries()) {
    if (itemIndex.has(item.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['roadmap', index, 'id'],
        message: 'Roadmap item ids must be unique',
      })
    } else {
      itemIndex.set(item.id, index)
    }
  }
  for (const [index, item] of roadmap.entries()) {
    for (const [dependencyIndex, dependency] of (item.dependsOn ?? []).entries()) {
      const dependencyPosition = itemIndex.get(dependency)
      if (dependencyPosition === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['roadmap', index, 'dependsOn', dependencyIndex],
          message: 'Roadmap dependency must reference an item in this update',
        })
      } else if (dependencyPosition >= index) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['roadmap', index, 'dependsOn', dependencyIndex],
          message: 'Roadmap items must be returned in dependency order',
        })
      }
    }
  }
}

function isMeasurableConfirmedGoal(goal: z.infer<typeof journeyGoalSchema>): boolean {
  return goal.status === 'confirmed' && Boolean(goal.metric && goal.target && goal.deadline)
}

export const journeyIdentitySchema = z
  .object({
    workspaceId: z.string().trim().min(8).max(120).regex(/^[a-zA-Z0-9:_-]+$/),
    // Cookie-first clients omit the secret from JSON. Persistence still
    // requires either this legacy token or a validated HttpOnly credential.
    accessToken: z.string().min(24).max(240).optional(),
  })
  .strict()

export const journeyChatRequestSchema = journeyIdentitySchema
  .extend({
    state: journeyStateSchema,
    message: z.string().trim().min(1).max(4_000),
  })
  .strict()

export const journeyPatchRequestSchema = journeyIdentitySchema
  .extend({ state: journeyStateSchema })
  .strict()

export type JourneyPhase = z.infer<typeof journeyPhaseSchema>
export type JourneyMessage = z.infer<typeof journeyMessageSchema>
export type JourneyFact = z.infer<typeof journeyFactSchema>
export type JourneyGoal = z.infer<typeof journeyGoalSchema>
export type JourneyRoadmapItem = z.infer<typeof journeyRoadmapItemSchema>
export type JourneyFile = z.infer<typeof journeyFileSchema>
export type JourneySuggestion = z.infer<typeof journeySuggestionSchema>
export type JourneyWidget = z.infer<typeof journeyWidgetSchema>
export type JourneyWidgetKind = JourneyWidget['kind']
export type JourneyWidgetDecision = z.infer<typeof journeyWidgetDecisionSchema>
export type JourneyState = z.infer<typeof journeyStateSchema>
export type JourneyAiUpdate = z.infer<typeof journeyAiUpdateSchema>
export type JourneyIdentity = z.infer<typeof journeyIdentitySchema>
