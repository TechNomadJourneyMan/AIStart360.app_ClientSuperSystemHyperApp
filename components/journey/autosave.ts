export interface RevisionedJourneyState {
  serverRevision?: number
}

export interface AutosaveReconciliation<T> {
  state: T
  needsSave: boolean
}

/**
 * Applies a completed CAS response without replacing edits made while the
 * request was in flight. A newer local object keeps all of its fields and only
 * adopts the server revision, then goes through the serialized save queue.
 */
export function reconcileAutosaveResult<T extends RevisionedJourneyState>(
  sent: T,
  latest: T,
  saved: T,
): AutosaveReconciliation<T> {
  if (latest === sent) return { state: saved, needsSave: false }

  return {
    state: {
      ...latest,
      ...(saved.serverRevision === undefined
        ? {}
        : { serverRevision: saved.serverRevision }),
    },
    needsSave: true,
  }
}
