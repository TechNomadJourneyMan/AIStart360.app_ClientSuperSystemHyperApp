# Journey UX priority release

## Outcome

Make the first three minutes conversation-led: the user describes a business, verifies AI understanding, sets a measurable Point B, and then deliberately opens a progressively revealed A→B workspace.

## Work areas

1. **Experience state and summary (new isolated component files)**
   - Derive `describe → confirm → goal → ready` from the existing validated Journey state; add no new persisted fields.
   - Render a four-step progress strip plus grounded Point A / Point B / next-action summaries.
2. **Chat and workspace integration (`ChatDock.tsx`, `Workspace.tsx`, `FactReview.tsx`)**
   - Center the chat during discovery on desktop and open it first on mobile.
   - Keep suggestions inside the conversation during onboarding.
   - Add explicit actions to refine the goal, discuss the next step, and open the completed path.
   - Keep chat reachable from every mobile surface.
3. **Progressive disclosure and copy (`JourneyCanvas.tsx`, `DeviceConnectDialog.tsx`, widget rendering)**
   - De-emphasize the board until Point A is confirmed, preserve drag/drop and the typed widget registry.
   - Replace implementation terminology in device linking with user-facing copy.
   - Always show goal metric, target, and deadline together.
4. **Verification (`tests/unit/journey`, `tests/e2e/journey.spec.ts`)**
   - Focused tests for stage derivation and first-run actions.
   - Existing tomato, insurance, Honor, persistence, upload, sync, and security suites remain green.
   - Typecheck, lint, full tests, production build, then desktop/mobile Playwright screenshots.

## Guardrails

- No schema, database, AI prompt, or API expansion for this UX release.
- No arbitrary generated UI; widgets remain allowlisted and schema-validated.
- Do not touch unrelated worktrees or `artifacts/` history.
- Public demo must stay explicit; production authentication remains fail-closed.
