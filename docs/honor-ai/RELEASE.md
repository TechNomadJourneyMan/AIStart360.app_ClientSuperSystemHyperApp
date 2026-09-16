# HONOR AI — deployment runbook

A release candidate extending the existing service-only omnichannel inbox.
Runtime observations and conversation analysis belong in local ignored artifacts.

## Candidate behavior

- Four channel modes: off, manager assistant on demand, automatic AI draft,
  and automatic response to new inbound messages. Assistant mode does not run
  unattended generation; the HONOR sandbox supplies on-demand suggestions.
- A conversation override cannot promote an off/draft/assistant channel to auto.
  The final database claim enforces this independently of model/application code.
- Emergency stop turns off both channels atomically. It cannot recall a message
  already accepted by the provider. Human replies pause AI until explicit resume.
- Live WhatsApp outbound echoes are persisted and never queued as new inbound
  requests. A newly observed outgoing echo conservatively pauses AI; an early
  AI echo can therefore pause the conversation before provider reconciliation.
- Honor binding is explicit by channel account and catalog user/company. Editing
  that binding/scenarios resets mode to draft and invalidates the live canary.
- Seven editable scenario guides affect generated replies. Guides cannot supply
  factual claims, invent product stock or grant permission to send.
- Product candidates come from the bound persisted catalog and are verified again
  against live product JSON-LD. Failed, out-of-stock, redirected, oversized or
  foreign-host sources are excluded; there is no stale-price fallback.
- Weather/keyword relevance and a stated budget rank candidates. When two complete
  suits are available they are preferred over individual accessories. The fallback
  gives real prices and product-card links, asks at most two essential questions,
  and does not promise temperature comfort or size availability.
- The sandbox displays genuine product photographs. WhatsApp Cloud text links
  to verified MyHonor product cards request link previews. Native multi-photo
  attachment delivery and its provider rendering have not been verified.
- Catalog proof is recorded separately from mutable message outcomes. Auto-send
  requires matching configuration proof no older than two minutes and a personal
  manager's live canary. Historic/catch-up messages remain draft-only.
- The canary checks a recent trusted inbound, a verified catalog draft and a
  subsequent successful manual response by the confirming personal manager,
  with AI paused. The inbox exposes a confirmation button on that inbound.
  Confirmation itself does not activate auto mode.
- Statistics distinguish AI, known manager, system and unknown. Shared login or
  phone echoes do not invent an individual employee identity. Filters cover
  channel, account, manager and dates (UTC, maximum 93 days).
- First/average response measures an unanswered burst to a confirmed outgoing.
  First means first *observed* in the selected history. Handoffs are the current
  conversation state, not fabricated historical transfer events. Truncated reads
  and unknown authors are disclosed.
- Signed commerce evidence is idempotent. Unconfirmed order/payment claims are
  rejected; revenue is reconciled against the current bound order source, so a
  later refund reduces revenue. Missing event coverage yields unavailable values.
  The storefront must still be connected to `/api/webhooks/honor-commerce` with
  its own secret and real source-event/outbound-message mappings. Do not fabricate
  click, cart or purchase events to populate the dashboard.

## Validation

Run the unit suite, TypeScript, lint and the production build. Database semantics
can be checked with `tests/integration/honor-ai-db.cjs` using an isolated installed
`@electric-sql/pglite` via `HONOR_PGLITE_PACKAGE`. This script never connects to a
production database. Use controlled test accounts for live provider checks.

## Deployment

1. Re-fetch refs and identify the actual deployed SHA, worktrees and dirty changes.
   Base this candidate on the current reviewed production branch, not an older main.
2. Apply `202609160001_honor_ai_controls.sql` transactionally, preserving ACLs;
   do not replay older migrations over a shared database. Record its checksum.
3. Deploy without promoting aliases, then verify personal authentication, tenant
   binding, sandbox catalog cards, stop and manual takeover. Keep draft/off modes.
4. Reconnect the intended store account through the existing supported connector.
   A QR connection requires the store phone, never an unrelated personal account.
5. Run a fresh inbound / reviewed draft / personal manager reply canary. Verify
   outbound echoes, duplicate delivery, stop and reconnect behavior. Only then
   enable auto replies and verify the exact public deployment SHA and behavior.
6. Connect the storefront evidence webhook only with a distinct server-side secret
   and provable mappings to outgoing messages and source orders. Never synthesize
   events to populate metrics.

## Rollback

First call `honor_ai_control('stop')` through authorized server access and verify
all modes are off. Restore the previously recorded known-good deployment. Keep
additive tables, evidence and tightened send guards; do not discard history.
Recheck public behavior and provider state before resuming.
