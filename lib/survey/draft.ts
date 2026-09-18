/**
 * lib/survey/draft.ts — the browser-side draft of the onboarding survey.
 *
 * WHY (E2E 2026-09-10, P0 × 3):
 *  - The draft used ONE global key («aistart360_onboarding») and won over the
 *    server on load. A second user on the same browser (admin opening several
 *    clients, shared office PC, demo → real account) got the previous user's
 *    answers and saved them into their own account.
 *  - Because the draft held the WHOLE answer map and won over the server, edits
 *    made elsewhere (Point B revenue, admin panel, another device) were
 *    silently reverted by the next «Далее».
 *
 * Now the draft is per user and stores ONLY unsaved edits ("dirty" keys).
 * On load the server is the source of truth; the draft is overlaid on top.
 */

export const DRAFT_PREFIX = 'aistart360_onboarding'
const DRAFT_VERSION = 2

export interface SurveyDraft {
  v: typeof DRAFT_VERSION
  user_id: string
  current_step: number
  /** Unsaved edits only: question_key → value. */
  dirty: Record<string, unknown>
  saved_at: string
}

export function draftKey(userId: string): string {
  return `${DRAFT_PREFIX}:${userId}`
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> & { length?: number; key?: (i: number) => string | null }

/** Read this user's draft; anything malformed or belonging to someone else is dropped. */
export function readDraft(storage: StorageLike, userId: string): SurveyDraft | null {
  try {
    // The pre-fix global draft cannot be attributed to a user → never trust it.
    storage.removeItem(DRAFT_PREFIX)
    const raw = storage.getItem(draftKey(userId))
    if (!raw) return null
    const d = JSON.parse(raw) as Partial<SurveyDraft>
    if (d?.v !== DRAFT_VERSION || d.user_id !== userId || typeof d.dirty !== 'object' || d.dirty === null) {
      storage.removeItem(draftKey(userId))
      return null
    }
    const step = Number(d.current_step)
    return {
      v: DRAFT_VERSION,
      user_id: userId,
      current_step: Number.isInteger(step) && step >= 1 && step <= 12 ? step : 1,
      dirty: d.dirty as Record<string, unknown>,
      saved_at: String(d.saved_at ?? ''),
    }
  } catch {
    return null
  }
}

export function writeDraft(
  storage: StorageLike,
  userId: string,
  currentStep: number,
  dirty: Record<string, unknown>,
): void {
  try {
    const draft: SurveyDraft = {
      v: DRAFT_VERSION,
      user_id: userId,
      current_step: currentStep,
      dirty,
      saved_at: new Date().toISOString(),
    }
    storage.setItem(draftKey(userId), JSON.stringify(draft))
  } catch {
    // storage full / unavailable — the server copy is still the source of truth
  }
}

export function clearDraft(storage: StorageLike, userId: string): void {
  try {
    storage.removeItem(draftKey(userId))
  } catch {
    /* ignore */
  }
}

/** Remove every survey draft (all users) — called on logout. */
export function clearAllDrafts(storage: StorageLike): void {
  try {
    const n = typeof storage.length === 'number' ? storage.length : 0
    const doomed: string[] = []
    for (let i = 0; i < n; i++) {
      const k = storage.key?.(i)
      if (k && (k === DRAFT_PREFIX || k.startsWith(`${DRAFT_PREFIX}:`))) doomed.push(k)
    }
    for (const k of doomed) storage.removeItem(k)
  } catch {
    /* ignore */
  }
}

/** Server answers are the truth; unsaved local edits are laid on top. */
export function mergeServerAndDraft(
  server: Record<string, unknown>,
  draft: SurveyDraft | null,
): { answers: Record<string, unknown>; dirtyKeys: string[] } {
  if (!draft) return { answers: { ...server }, dirtyKeys: [] }
  return { answers: { ...server, ...draft.dirty }, dirtyKeys: Object.keys(draft.dirty) }
}

/** `?step=N` deep link from «Мои данные → Редактировать»; null when absent/invalid. */
export function parseStepParam(raw: string | null | undefined, total = 12): number | null {
  if (raw == null || raw === '') return null
  const n = Number(raw)
  return Number.isInteger(n) && n >= 1 && n <= total ? n : null
}
