/**
 * lib/survey/recalc-after-submit.ts — the Point A recalculation right after
 * the questionnaire is sent (R3-PA, B5 / R-150): its failure is TOLD to the
 * client instead of being swallowed (`catch {}` sent him home with no word
 * while Point A did not recalculate).
 *
 * 409 «уже пересчитывается» is not a failure: a recalculation is running and
 * the page will show it. Browser-safe; `fetchImpl` is injectable for tests.
 */
export type RecalcOutcome = { ok: true; busy: boolean } | { ok: false; message: string }

export const RECALC_FAILED_MESSAGE = 'Точка А не пересчиталась. Ответы сохранены — мы попробуем пересчитать её автоматически, или повторите сейчас.'

export async function recalcAfterSubmit(fetchImpl: typeof fetch, userId: string | null): Promise<RecalcOutcome> {
  try {
    const res = await fetchImpl('/api/v1/diagnostics/recalculate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(userId ? { user_id: userId } : {}),
    })
    if (res.ok) return { ok: true, busy: false }
    if (res.status === 409) return { ok: true, busy: true }
    const body = (await res.json().catch(() => null)) as { error?: unknown } | null
    const said = typeof body?.error === 'string' && /[а-яё]/i.test(body.error) ? body.error : null
    return { ok: false, message: said ? `${said}. ${RECALC_FAILED_MESSAGE}` : RECALC_FAILED_MESSAGE }
  } catch {
    return { ok: false, message: `Нет связи с сервером. ${RECALC_FAILED_MESSAGE}` }
  }
}
