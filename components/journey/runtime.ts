import type { JourneyWorkspaceView } from './model'
import { isJourneyPublicDemoEnabled } from '@/lib/journey/public-demo'

/**
 * Browser-local Journey state is intentionally disabled in production unless
 * an isolated, explicitly labelled public demo deployment opts in at build
 * time. Canonical production therefore remains fail-closed by default.
 */
export function allowsJourneyLocalDemo(
  nodeEnv = process.env.NODE_ENV,
  publicDemo = process.env.NEXT_PUBLIC_JOURNEY_PUBLIC_DEMO,
): boolean {
  return nodeEnv !== 'production' || isJourneyPublicDemoEnabled(publicDemo)
}

export function isJourneyPublicDemo(
  publicDemo = process.env.NEXT_PUBLIC_JOURNEY_PUBLIC_DEMO,
): boolean {
  return isJourneyPublicDemoEnabled(publicDemo)
}

/** Keep rich browser-local demo content while treating provider and
 * persistence metadata as server-owned truth. */
export function selectJourneyInitialState(
  local: JourneyWorkspaceView,
  remote: JourneyWorkspaceView,
  allowLocalDemo: boolean,
): JourneyWorkspaceView {
  if (!allowLocalDemo || remote.workspaceId !== local.workspaceId) return remote

  const selected = remote.persistence.mode === 'local'
    ? local
    : newerJourneyState(local, remote)

  return {
    ...selected,
    provider: remote.provider,
    persistence: remote.persistence,
  }
}

function newerJourneyState(
  local: JourneyWorkspaceView,
  remote: JourneyWorkspaceView,
): JourneyWorkspaceView {
  const localRevision = local.serverRevision ?? 0
  const remoteRevision = remote.serverRevision ?? 0
  if (remoteRevision !== localRevision) return remoteRevision > localRevision ? remote : local
  const localTime = Date.parse(local.updatedAt)
  const remoteTime = Date.parse(remote.updatedAt)
  return Number.isFinite(localTime) && localTime > remoteTime ? local : remote
}
