import { NextResponse } from 'next/server'
import { hasOpenRouterKey } from '@/lib/ai/structured'
import {
  resolveNamedOwnedJourneyState,
  storeJourneyWorkspaceId,
} from '@/lib/journey/auth-bootstrap'
import {
  JOURNEY_DEVICE_COOKIE_MAX_AGE_SECONDS,
  journeyErrorResponse,
  STORE_JOURNEY_DEVICE_COOKIE,
} from '@/lib/journey/http'
import { confirmDraftJourneyGoal } from '@/lib/journey/demo'
import { orchestrateJourneyTurn } from '@/lib/journey/orchestrator'
import { enforceJourneyStatePolicy } from '@/lib/journey/policy'
import {
  appendJourneyMessages,
  loadJourneyState,
  saveJourneyState,
} from '@/lib/journey/persistence'
import {
  journeyChatRequestSchema,
  journeyPatchRequestSchema,
  journeyStateSchema,
} from '@/lib/journey/schema'
import {
  redactStoreJourneyState,
  rehydrateStoreJourneyState,
  resolveStoreJourneyContext,
  storeJourneyIdentityFromRequest,
} from '@/lib/journey/store-context'
import { isExplicitStorePointBConfirmation } from '@/lib/journey/store-goal-contract'
import {
  getLatestCompleteStoreDraftGoal,
  requireStoreGoalConfirmation,
} from '@/lib/journey/store-goal-confirmation'
import { buildStoreJourneyState } from '@/lib/journey/store-seed'
import { isRateLimited, isRateLimitedKey } from '@/lib/rate-limit'

const STORE_HEADERS = { 'cache-control': 'private, no-store' }

export async function getStoreJourney(request: Request): Promise<NextResponse> {
  try {
    const context = await resolveStoreJourneyContext(request)
    const workspaceId = storeJourneyWorkspaceId(context.userId)
    const identity = storeJourneyIdentityFromRequest(request, context.userId)
    const live = buildStoreJourneyState(context.overview, { workspaceId })
    const authenticated = await resolveNamedOwnedJourneyState({
      workspaceId,
      identity,
      actorUserId: context.userId,
      buildInitialState: async () => redactStoreJourneyState(live),
      deviceLabel: 'Store Journey браузер',
    })
    const state = journeyStateSchema.parse({
      ...rehydrateStoreJourneyState(authenticated.state, live),
      provider: hasOpenRouterKey()
        ? { mode: 'live', label: 'AI готов · structured output' }
        : { mode: 'demo', label: 'Демо-режим · OPENROUTER_API_KEY не задан' },
      persistence: authenticated.persistence,
    })
    const response = NextResponse.json({
      state,
      provider: state.provider,
      persistence: state.persistence,
      credentialMode: authenticated.deviceToken ? 'cookie' : 'existing',
    }, { headers: STORE_HEADERS })
    if (authenticated.deviceToken) setStoreDeviceCookie(response, authenticated.deviceToken)
    return response
  } catch (error) {
    return storeJourneyErrorResponse(error)
  }
}

export async function patchStoreJourney(request: Request): Promise<NextResponse> {
  try {
    const context = await resolveStoreJourneyContext(request)
    const raw = await request.json()
    const supplied = raw && typeof raw === 'object' && !Array.isArray(raw)
      ? raw as Record<string, unknown>
      : {}
    const workspaceId = storeJourneyWorkspaceId(context.userId)
    const payload = journeyPatchRequestSchema.parse({
      ...supplied,
      workspaceId,
      accessToken: undefined,
    })
    const identity = storeJourneyIdentityFromRequest(request, context.userId, [
      typeof supplied.workspaceId === 'string' ? supplied.workspaceId : undefined,
      payload.state.workspaceId,
    ])
    requireStoreCredential(identity.accessToken)
    const live = buildStoreJourneyState(context.overview, { workspaceId })
    const loaded = await loadJourneyState(identity, context.userId)
    const persisted = loaded.state
      ? rehydrateStoreJourneyState(loaded.state, live)
      : live
    const clientGrounded = rehydrateStoreJourneyState(payload.state, live)
    // Store PATCH is an autosave/layout endpoint. Business content (goals,
    // roadmap, dialog and widget payloads) is accepted only from the dedicated
    // server chat/confirmation flow, never from a browser-supplied state.
    const grounded = mergeStoreOwnedLayout(persisted, clientGrounded)
    const normalized = enforceJourneyStatePolicy(limitExpandedWidgets(grounded))
    const saved = await saveJourneyState(
      identity,
      redactStoreJourneyState(normalized),
      context.userId,
    )
    const state = rehydrateStoreJourneyState(saved.state, live)
    return NextResponse.json({
      state,
      provider: state.provider,
      persistence: saved.persistence,
    }, { headers: STORE_HEADERS })
  } catch (error) {
    return storeJourneyErrorResponse(error)
  }
}

export async function postStoreJourneyChat(request: Request): Promise<NextResponse> {
  try {
    const context = await resolveStoreJourneyContext(request)
    const raw = await request.json()
    const supplied = raw && typeof raw === 'object' && !Array.isArray(raw)
      ? raw as Record<string, unknown>
      : {}
    const workspaceId = storeJourneyWorkspaceId(context.userId)
    const payload = journeyChatRequestSchema.parse({
      ...supplied,
      workspaceId,
      accessToken: undefined,
    })
    const identity = storeJourneyIdentityFromRequest(request, context.userId, [
      typeof supplied.workspaceId === 'string' ? supplied.workspaceId : undefined,
      payload.state.workspaceId,
    ])
    requireStoreCredential(identity.accessToken)
    if (
      await isRateLimited(request, 'journey-store-chat-ip', { max: 30, windowMs: 60 * 60_000 }) ||
      await isRateLimitedKey(workspaceId, 'journey-store-chat', { max: 12, windowMs: 60_000 })
    ) {
      return NextResponse.json(
        { error: { code: 'JOURNEY_RATE_LIMIT', message: 'Слишком много сообщений. Попробуйте через минуту.' } },
        { status: 429, headers: STORE_HEADERS },
      )
    }
    const loaded = await loadJourneyState(identity, context.userId)
    const live = buildStoreJourneyState(context.overview, { workspaceId })
    const clientState = rehydrateStoreJourneyState(payload.state, live)
    const explicitConfirmation = isExplicitStorePointBConfirmation(payload.message)
    const persistedState = loaded.state
      ? rehydrateStoreJourneyState(loaded.state, live)
      : live
    const state = explicitConfirmation
      ? requirePersistedStoreDraft(loaded.state, live)
      : mergeStoreOwnedLayout(persistedState, clientState)
    const previousMessageIds = new Set(state.messages.map((message) => message.id))
    const result = explicitConfirmation
      ? {
          state: confirmDraftJourneyGoal(
            state,
            requireCompleteStoreDraft(state).id,
            payload.message,
          ),
          mode: state.provider.mode === 'live' ? 'live' as const : 'demo' as const,
        }
      : await orchestrateJourneyTurn(state, payload.message).then((orchestrated) => ({
          ...orchestrated,
          state: requireStoreGoalConfirmation(state, orchestrated.state),
        }))
    const normalized = enforceJourneyStatePolicy(
      rehydrateStoreJourneyState(result.state, live),
    )
    const saved = await saveJourneyState(
      identity,
      redactStoreJourneyState(normalized),
      context.userId,
    )
    const responseState = rehydrateStoreJourneyState(saved.state, live)
    await appendJourneyMessages(
      identity,
      responseState.messages.filter((message) => !previousMessageIds.has(message.id)),
      responseState.provider.mode,
    )
    return NextResponse.json({
      state: responseState,
      provider: responseState.provider,
      persistence: saved.persistence,
      orchestration: { mode: result.mode, fallbackReason: result.fallbackReason },
    }, { headers: STORE_HEADERS })
  } catch (error) {
    return storeJourneyErrorResponse(error)
  }
}

export async function rejectStoreJourneyDocument(request: Request): Promise<NextResponse> {
  try {
    await resolveStoreJourneyContext(request)
    return NextResponse.json(
      {
        error: {
          code: 'STORE_JOURNEY_DOCUMENTS_DISABLED',
          message: 'Загрузка файлов в Store Journey отключена. Используйте публикацию Store Control Center.',
        },
      },
      { status: 405, headers: STORE_HEADERS },
    )
  } catch (error) {
    return storeJourneyErrorResponse(error)
  }
}

function setStoreDeviceCookie(response: NextResponse, token: string): void {
  response.cookies.set(STORE_JOURNEY_DEVICE_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/api/v1/journey/store',
    maxAge: JOURNEY_DEVICE_COOKIE_MAX_AGE_SECONDS,
  })
}

function requireStoreCredential(token: string | undefined): asserts token is string {
  if (!token) {
    const error = new Error('Сначала откройте Store Journey, чтобы подтвердить устройство.')
    error.name = 'StoreJourneyCredentialRequired'
    throw error
  }
}

function requirePersistedStoreDraft(
  persisted: ReturnType<typeof journeyStateSchema.parse> | null,
  live: ReturnType<typeof journeyStateSchema.parse>,
) {
  if (!persisted) throw storeGoalConfirmationRequired()
  const state = rehydrateStoreJourneyState(persisted, live)
  requireCompleteStoreDraft(state)
  return state
}

/** Chat content/goals are server-authoritative. Only harmless board layout can
 * be rebased from the browser after the autosave queue has drained. */
function mergeStoreOwnedLayout(
  persisted: ReturnType<typeof journeyStateSchema.parse>,
  supplied: ReturnType<typeof journeyStateSchema.parse>,
) {
  const layout = new Map(supplied.widgets.map((widget) => [widget.id, widget]))
  return journeyStateSchema.parse({
    ...persisted,
    widgets: persisted.widgets.map((widget) => {
      const clientWidget = layout.get(widget.id)
      if (!clientWidget || clientWidget.kind !== widget.kind) return widget
      return {
        ...widget,
        collapsed: clientWidget.collapsed,
        hidden: clientWidget.hidden,
        focused: clientWidget.focused,
        position: clientWidget.position,
      }
    }),
    manualWidgetIds: supplied.manualWidgetIds,
    widgetOrder: supplied.widgetOrder,
  })
}

function requireCompleteStoreDraft(state: ReturnType<typeof journeyStateSchema.parse>) {
  const draft = getLatestCompleteStoreDraftGoal(state)
  if (!draft) throw storeGoalConfirmationRequired()
  return draft
}

function storeGoalConfirmationRequired(): Error {
  const error = new Error('Сначала сохраните и проверьте измеримый черновик Точки B.')
  error.name = 'StoreGoalConfirmationRequired'
  return error
}

function storeJourneyErrorResponse(error: unknown): NextResponse {
  if (error instanceof Error && error.name === 'StoreJourneyCredentialRequired') {
    return NextResponse.json(
      { error: { code: 'STORE_JOURNEY_CREDENTIAL_REQUIRED', message: error.message } },
      { status: 403, headers: STORE_HEADERS },
    )
  }
  if (error instanceof Error && error.name === 'StoreGoalConfirmationRequired') {
    return NextResponse.json(
      { error: { code: 'STORE_GOAL_CONFIRMATION_REQUIRED', message: error.message } },
      { status: 409, headers: STORE_HEADERS },
    )
  }
  return journeyErrorResponse(error, STORE_HEADERS)
}

function limitExpandedWidgets(input: unknown) {
  const state = journeyStateSchema.parse(input)
  let expanded = 0
  const widgets = [...state.widgets]
    .sort((a, b) => b.priority - a.priority)
    .map((widget) => {
      if (widget.hidden || widget.collapsed) return widget
      expanded += 1
      return expanded <= 4 ? widget : { ...widget, collapsed: true }
    })
  return journeyStateSchema.parse({ ...state, widgets })
}
