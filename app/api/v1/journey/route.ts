import { NextResponse } from 'next/server'
import { hasOpenRouterKey } from '@/lib/ai/structured'
import { createEmptyJourneyState } from '@/lib/journey/demo'
import {
  identityFromRequest,
  JOURNEY_DEVICE_COOKIE,
  JOURNEY_DEVICE_COOKIE_MAX_AGE_SECONDS,
  journeyErrorResponse,
  resolveJourneyActor,
  withJourneyDeadline,
  withJourneyRequestIdentity,
} from '@/lib/journey/http'
import { resolveAuthenticatedJourneyState } from '@/lib/journey/auth-bootstrap'
import { loadJourneyStateFromOnboarding } from '@/lib/journey/onboarding-seed'
import { loadJourneyState, saveJourneyState } from '@/lib/journey/persistence'
import { enforceJourneyStatePolicy } from '@/lib/journey/policy'
import { journeyPatchRequestSchema, journeyStateSchema } from '@/lib/journey/schema'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const resolved = await withJourneyDeadline(async () => {
      const actorUserId = await resolveJourneyActor()
      const identity = identityFromRequest(request)
      if (actorUserId) {
        const authenticated = await resolveAuthenticatedJourneyState({
          identity,
          actorUserId,
          buildInitialState: (workspaceId) => (
            loadJourneyStateFromOnboarding(actorUserId, workspaceId)
          ),
        })
        return {
          identity,
          state: authenticated.state,
          persistence: authenticated.persistence,
          deviceToken: authenticated.deviceToken,
        }
      }
      const loaded = await loadJourneyState(identity, null)
      return {
        identity,
        state: loaded.state,
        persistence: loaded.persistence,
        deviceToken: undefined,
      }
    })
    const base = resolved.state ?? createEmptyJourneyState(resolved.identity.workspaceId)
    const state = journeyStateSchema.parse({
      ...base,
      provider: hasOpenRouterKey()
        ? { mode: 'live', label: 'AI готов · structured output' }
        : { mode: 'demo', label: 'Демо-режим · OPENROUTER_API_KEY не задан' },
      persistence: resolved.persistence,
    })
    const response = NextResponse.json({
      state,
      provider: state.provider,
      persistence: state.persistence,
      credentialMode: resolved.deviceToken ? 'cookie' : 'existing',
    })
    if (resolved.deviceToken) {
      response.cookies.set(JOURNEY_DEVICE_COOKIE, resolved.deviceToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/api/v1/journey',
        maxAge: JOURNEY_DEVICE_COOKIE_MAX_AGE_SECONDS,
      })
    }
    response.headers.set('cache-control', 'no-store')
    return response
  } catch (error) {
    return journeyErrorResponse(error)
  }
}

export async function PATCH(request: Request) {
  try {
    const actorUserId = await resolveJourneyActor()
    const payload = journeyPatchRequestSchema.parse(
      withJourneyRequestIdentity(request, await request.json()),
    )
    const identity = identityFromRequest(request, payload)
    const normalized = enforceJourneyStatePolicy(limitExpandedWidgets(payload.state))
    const saved = await saveJourneyState(identity, normalized, actorUserId)
    return NextResponse.json({
      state: saved.state,
      provider: saved.state.provider,
      persistence: saved.persistence,
    })
  } catch (error) {
    return journeyErrorResponse(error)
  }
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
