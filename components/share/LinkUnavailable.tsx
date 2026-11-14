/**
 * LinkUnavailable — the page of a public link whose section is closed for the
 * owner of the data right now (R2-C: /r/<token> shares of Точка А / Б / GRI and
 * /r/v/<token> versions of the expert's report; lib/access/owner-access.ts).
 *
 * Renders NO data of the report: no company name, no numbers, no dates. The text
 * is NEUTRAL (product review L-6): it does not tell a link holder anything about
 * the owner's tariff, and it is the same when the right is closed and when the
 * decision failed. The link itself is not deleted — it opens again once the
 * owner has the access. Server-safe (no hooks).
 */
export const LINK_UNAVAILABLE_TITLE = 'Ссылка недоступна'
export const LINK_UNAVAILABLE_TEXT = 'Ссылка сейчас недоступна. Обратитесь к тому, кто ею поделился.'

export function LinkUnavailable() {
  return (
    <main className="min-h-screen bg-[#0A0B0F] flex items-center justify-center p-6" data-link-unavailable>
      <div className="max-w-md w-full bg-surface-container rounded-2xl border border-white/[0.06] shadow-card p-8 text-center">
        <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-5">
          <span className="material-symbols-outlined text-3xl text-primary" aria-hidden="true">lock</span>
        </div>
        <h1 className="font-headline text-xl font-bold text-on-surface mb-2">{LINK_UNAVAILABLE_TITLE}</h1>
        <p className="text-sm text-on-surface-variant">{LINK_UNAVAILABLE_TEXT}</p>
      </div>
    </main>
  )
}
