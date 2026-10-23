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
 *
 * Stale drafts (survey modes, spec 2026-10-23 §6.1 / §14.2): the same answer
 * can now change in another mode (express, the AI chat), by an expert or on
 * another device while this device still holds an unsaved edit. The draft (v3)
 * remembers, per key, the server's `updated_at` the edit started from
 * (`base`); if the server answer changed after that, the server answer wins
 * and the key is reported as stale («Ответ изменён в другом режиме»). Comparing
 * server times with server times avoids the device clock.
 */

export const DRAFT_PREFIX = 'aistart360_onboarding'
const DRAFT_VERSION = 3
/** v2 drafts (no per-key base) are still read. */
const READABLE_VERSIONS = new Set([2, 3])
/**
 * Our own save is stamped twice — by the route (the attribution it returns)
 * and by the database trigger (`now()`); a few seconds apart is the same write.
 */
export const STALE_TOLERANCE_MS = 5000

export interface SurveyDraft {
  v: typeof DRAFT_VERSION
  user_id: string
  current_step: number
  /** Unsaved edits only: question_key → value. */
  dirty: Record<string, unknown>
  /**
   * question_key → the server `updated_at` of that answer when the edit
   * started (null: no answer on the server then). Absent in v2 drafts.
   */
  base?: Record<string, string | null>
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
    const d = JSON.parse(raw) as Omit<Partial<SurveyDraft>, 'v'> & { v?: number }
    if (!READABLE_VERSIONS.has(Number(d?.v)) || d.user_id !== userId || typeof d.dirty !== 'object' || d.dirty === null) {
      storage.removeItem(draftKey(userId))
      return null
    }
    const step = Number(d.current_step)
    return {
      v: DRAFT_VERSION,
      user_id: userId,
      current_step: Number.isInteger(step) && step >= 1 && step <= 12 ? step : 1,
      dirty: d.dirty as Record<string, unknown>,
      ...(d.base && typeof d.base === 'object' && !Array.isArray(d.base) ? { base: sanitizeBase(d.base) } : {}),
      saved_at: String(d.saved_at ?? ''),
    }
  } catch {
    return null
  }
}

function sanitizeBase(raw: object): Record<string, string | null> {
  const out: Record<string, string | null> = {}
  for (const [k, v] of Object.entries(raw)) if (typeof v === 'string' || v === null) out[k] = v
  return out
}

export function writeDraft(
  storage: StorageLike,
  userId: string,
  currentStep: number,
  dirty: Record<string, unknown>,
  /** question_key → server `updated_at` the edit started from (see SurveyDraft.base). */
  base?: Readonly<Record<string, string | null>>,
): void {
  try {
    const draft: SurveyDraft = {
      v: DRAFT_VERSION,
      user_id: userId,
      current_step: currentStep,
      dirty,
      ...(base ? { base: Object.fromEntries(Object.keys(dirty).filter((k) => k in base).map((k) => [k, base[k]])) } : {}),
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

const time = (iso: string | null | undefined): number | null => {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : null
}

/**
 * Is the draft value of `key` older than the server answer? With a base (v3):
 * the server answer changed after the edit started (or appeared where there was
 * none). Without one (v2): the server answer is newer than the draft itself.
 */
export function isDraftKeyStale(draft: SurveyDraft, key: string, serverUpdatedAt: string | null | undefined): boolean {
  const server = time(serverUpdatedAt)
  if (server === null) return false
  if (draft.base && Object.prototype.hasOwnProperty.call(draft.base, key)) {
    const base = time(draft.base[key])
    return base === null ? true : server - base > STALE_TOLERANCE_MS
  }
  const saved = time(draft.saved_at)
  return saved !== null && server > saved
}

/**
 * Server answers are the truth; unsaved local edits are laid on top — except
 * an edit whose answer changed on the server after it started (another mode,
 * an expert, another device): that key keeps the server answer and is listed
 * in `staleKeys`. `serverUpdatedAt` is question_key → the answer's updated_at
 * (GET /api/v1/onboarding/survey `attribution[key].updatedAt`).
 */
export function mergeServerAndDraft(
  server: Record<string, unknown>,
  draft: SurveyDraft | null,
  serverUpdatedAt: Readonly<Record<string, string | null | undefined>> = {},
): { answers: Record<string, unknown>; dirtyKeys: string[]; staleKeys: string[] } {
  if (!draft) return { answers: { ...server }, dirtyKeys: [], staleKeys: [] }
  const answers: Record<string, unknown> = { ...server }
  const dirtyKeys: string[] = []
  const staleKeys: string[] = []
  for (const [key, value] of Object.entries(draft.dirty)) {
    if (isDraftKeyStale(draft, key, serverUpdatedAt[key])) { staleKeys.push(key); continue }
    answers[key] = value
    dirtyKeys.push(key)
  }
  return { answers, dirtyKeys, staleKeys }
}

/** question_key → updatedAt of the answer attribution map (for mergeServerAndDraft). */
export function updatedAtOf(attribution: Readonly<Record<string, { updatedAt?: string | null } | undefined>>): Record<string, string | null> {
  const out: Record<string, string | null> = {}
  for (const [k, a] of Object.entries(attribution)) out[k] = a?.updatedAt ?? null
  return out
}

/** `?step=N` deep link from «Мои данные → Редактировать»; null when absent/invalid. */
export function parseStepParam(raw: string | null | undefined, total = 12): number | null {
  if (raw == null || raw === '') return null
  const n = Number(raw)
  return Number.isInteger(n) && n >= 1 && n <= total ? n : null
}
