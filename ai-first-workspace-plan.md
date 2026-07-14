# AI-first workspace: implementation plan

## Approach

Turn the existing tracked `/client/journey` mock into a real vertical on an isolated top-level test route, `/journey`, without changing the current dashboard/navigation. Reuse the project's OpenRouter + Zod, Supabase Auth/RLS, document parser, Point A/B engines and existing brand tokens; keep an explicitly labelled deterministic demo path for local environments without auth, DB or `OPENROUTER_API_KEY`.

## Current architecture (verified)

- Stack: Next.js 14 App Router, React 18, TypeScript, Tailwind, Framer Motion, Zod, Vitest; `@dnd-kit`, Radix, Lucide, React Dropzone and Recharts are already installed.
- Auth/source of identity: Supabase SSR session (`lib/supabase-server.ts`, `middleware.ts`); do not introduce another auth path or trust a body/query `user_id`. NextAuth/Prisma remain in legacy/admin areas.
- AI: server-only OpenRouter client and schema-validated helper in `lib/ai/openrouter.ts` and `lib/ai/structured.ts`; missing key already degrades honestly.
- Persistence: Supabase tables for `companies`, `survey_answers`, `diagnostics`, `point_b_analysis`, `action_items`, `documents`, `ai_conversations`, `ai_messages`, `dashboard_layouts`, CRM connections and RLS policies. Prisma is used for legacy entities and document embeddings, not as the primary client-workspace identity layer.
- Uploads: `client-documents` Storage + `documents` table + `/api/v1/onboarding/documents/*`; parsing supports PDF, DOCX, XLS/XLSX, CSV and TXT with heuristic fallback. The current UI advertises PPTX, but `lib/documents/parse.ts` does not parse it.
- Existing journey code (`app/client/journey`, `components/journey`, `lib/journey`) is mock-only: fake timeout response, static widget actions, no persisted state, fixed-position/non-pannable canvas and fabricated demo links/data. It is useful as styling/reference, not as the functional core.

## Scope

- In: isolated `/journey` route; dialog onboarding; upload/analyse/confirm facts; Point A -> Point B -> roadmap; safe widget registry; pan/zoom/focus and widget controls; authenticated Supabase persistence; clearly labelled demo fallback; responsive/mobile states; focused tests and Playwright screenshots.
- Out: replacing the dashboard or onboarding, exposing AI keys, arbitrary model-generated UI/code, pretending news/video/CRM providers are connected, broad refactors, or production-public rollout of the preview route.

## Action items

- [x] **Define the validated contract.** Added strict Zod schemas in `lib/journey/schema.ts` and the client view model in `components/journey/model.ts`: assistant message, one next question, suggested replies, sourced facts with confirmation, Point A/B nodes, roadmap/dependencies, camera target and a discriminated allowlist of widget specs. Strings, arrays and widget counts are capped; unknown kinds and unsafe URLs are rejected.
- [x] **Add deterministic orchestration.** Added `lib/journey/orchestrator.ts`, `lib/journey/prompt.ts` and `lib/journey/demo.ts`. The model receives curated business context and parsed facts; documents are explicitly untrusted. Missing key, timeout or invalid schema returns a labelled deterministic demo state without invented facts, links or integrations.
- [x] **Persist the workspace compatibly.** Added `supabase/migrations/063_ai_first_workspace.sql` for journey workspaces, messages and file metadata, followed by `064_ai_journey_device_sync.sql` for hash-only device credentials, one-time connect codes and server-owned CAS revisions. Browser-local persistence remains the explicit local fallback when the migration/service role is unavailable.
- [x] **Expose a secure API vertical.** Added `app/api/v1/journey/route.ts` (GET/PATCH) and `app/api/v1/journey/chat/route.ts` (POST turn -> validated update -> policy enforcement -> persistence). Identity comes from Supabase in production; development guests use an isolated local token. Paid calls are rate-limited and keys/prompts remain server-only.
- [x] **Integrate real file handling.** Added `app/api/v1/journey/documents/route.ts` with server-side extension, MIME, size and file-signature checks plus PDF/DOCX archive guards and untrusted-content handling. The UI exposes queued/processing/ready/error states and pending facts for confirmation. This experiment advertises only PDF, DOCX, CSV and TXT up to 4 MB; PPTX/XLSX stay explicitly unsupported.
- [x] **Build the isolated shell.** Implemented `app/journey/page.tsx` and the journey-specific workspace, chat, suggestion, module, fact-review and renderer components. History is expandable, async states use accessible status messaging, and empty/analysing/partial/ready/error/demo states are represented without adding the preview to existing navigation.
- [x] **Make the A -> B board genuinely interactive.** Rebuilt `components/journey/JourneyCanvas.tsx` as a transform plane with pointer pan, wheel zoom, recenter/focus, soft camera targeting and a responsive mobile board mode. Point A, gaps/priorities/dependencies/progress and measurable Point B are rendered with reduced-motion support.
- [x] **Finish the allowlisted widget system.** Added `lib/journey/widget-registry.ts` and typed rendering for business facts, health, goals, roadmap/actions, CRM readiness, funnel/KPIs, marketing, finance, process/team, risks/opportunities, knowledge/files, tasks/reminders and external sources. News/resources show a disconnected state unless verified sources exist. Only four modules can be expanded; the rest live in a compact dock, with persisted collapse/expand/focus/hide/move/discuss controls.
- [x] **Protect isolation and responsive layout.** `/journey` is public only in development and uses normal Supabase authentication in production. Desktop uses the canvas workspace; mobile uses board/chat/module tabs and touch-sized controls.
- [x] **Verify the complete scenario.** Added focused schema/orchestrator/state/security tests and Playwright coverage for text/file -> analysis -> fact confirmation -> Point A -> Point B -> roadmap plus widget controls and reload persistence. Typecheck, lint, unit suite, production build and both desktop/mobile Playwright projects have passed; screenshots are saved under `artifacts/journey/`.
- [x] **Add cross-device and explainable AI selection.** Linked devices receive a distinct secret in an HttpOnly cookie; connect codes are hash-only, short-lived, one-time and rate-limited. Every AI-selected widget now has a persisted allowlisted decision with a concise business-specific reason and evidence ids. Tomato retail and insurance renewal scenarios have deterministic server/browser parity tests.

## Dependency/file decisions

- Reuse installed `framer-motion`, `@dnd-kit`, `zod`, `react-dropzone`, `lucide-react`, Radix and the existing fetch-based OpenRouter client.
- New dev dependency: `@playwright/test` only. Add `jszip` only if PPTX is included in the supported list; otherwise do not advertise PPTX.
- Prefer small journey-specific files; do not mutate the dashboard widget registry or existing Point A/B pages.

## Main risks and mitigations

- **Two data models/Auth stacks:** keep all new user-scoped writes in Supabase/RLS; call Prisma only through existing document-embedding helpers.
- **Public demo vs private business data:** demo mode must be visibly labelled, local-only and never call authenticated persistence; production route remains session-protected.
- **Model hallucination/prompt injection:** strict Zod allowlist, source IDs/confidence, confirmation before promotion to Point A, untrusted-document delimiters, no arbitrary URLs or executable UI.
- **Upload mismatch and serverless limits:** align UI with parser support, cap size before upload/parse, retain explicit progress/error/retry, and use the existing async Inngest path when available.
- **JSONB drift:** version the workspace payload, sanitise on read, and cover migration/schema reconciliation with tests.
- **Canvas/mobile regressions:** cap simultaneously expanded widgets, provide list/focus mobile mode, respect reduced motion, and validate with desktop/mobile Playwright screenshots.
