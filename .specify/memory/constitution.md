<!--
SYNC IMPACT REPORT
==================
Version change: [template] → 1.0.0 (initial ratification from blank template)
Modified principles: none (initial creation)
Added sections:
  - Core Principles (4 principles: Code Quality, Testing Standards, UX Consistency, Performance)
  - Security Requirements
  - Development Workflow
  - Governance
Removed sections: none (template placeholders replaced)
Templates reviewed:
  - .specify/templates/plan-template.md ✅ aligned (Constitution Check section present)
  - .specify/templates/spec-template.md ✅ aligned (acceptance scenarios + measurable outcomes match principles)
  - .specify/templates/tasks-template.md ✅ aligned (phase structure matches workflow principle)
  - .specify/templates/commands/ — no command files found, N/A
Deferred TODOs: none
-->

# AIStart360 Constitution

## Core Principles

### I. Code Quality (NON-NEGOTIABLE)

Every file committed to this repository MUST meet the following standards:

- **No security anti-patterns**: `btoa`/`atob` for passwords, credentials in `localStorage`,
  `eval`, or inline secrets are forbidden at all times — not only in production branches.
- **No dead code**: unused variables, imports, commented-out code blocks, and orphaned files
  MUST be removed before merging.
- **Typed interfaces over `any`**: TypeScript `any` is forbidden in new code; existing `any`
  usages MUST be annotated with `// TODO(type): <reason>` and resolved within the same sprint.
- **Server/client boundary discipline**: Server Components MUST NOT import browser-only APIs;
  Client Components MUST be marked `'use client'` and kept as leaves in the component tree.
- **Single responsibility**: Each file, component, or function MUST have one clearly stated
  purpose. Split anything that does two unrelated things.

**Rationale**: The initial audit (March 2026) identified `btoa` password hashing and
`localStorage` auth as critical vulnerabilities. This principle ensures those classes of
issues never re-enter the codebase regardless of which developer or AI agent writes the code.

### II. Testing Standards

All user-facing features MUST include tests before a PR can be merged:

- **Authentication flows**: login, logout, registration, password reset — MUST have
  integration tests against a real database (no mocks for the DB layer).
- **RBAC and route protection**: every protected route MUST have a test asserting that
  an unauthenticated or wrong-role request is redirected, not just allowed through.
- **Server Actions and API routes**: MUST have at minimum one happy-path and one
  error-path test per action/route.
- **UI components with business logic**: MUST have component-level tests (React Testing
  Library or Playwright) covering the critical interaction.
- **Mock policy**: External third-party services (email, OAuth providers) MAY be mocked.
  The database MUST NOT be mocked — use a dedicated test Supabase project or transaction
  rollback strategy.
- **Tests MUST fail before implementation**: Red-Green-Refactor is required; committing
  a green test written after the implementation is a violation.

**Rationale**: Prior incident — mocked auth tests passed while production had broken
login due to btoa/plaintext mismatch. Real database tests prevent this class of failure.

### III. User Experience Consistency

Every page and component MUST conform to these rules:

- **No blank or empty pages**: Every route MUST render either real content, a skeleton
  loader (`loading.tsx`), or a meaningful empty state — never a white screen or 404 for
  a navigation item that exists in the sidebar.
- **Error boundaries on all pages**: Every page directory MUST contain an `error.tsx`
  (Next.js App Router error boundary). Global `app/error.tsx` and `app/global-error.tsx`
  are required at the root level.
- **Loading states**: All data-fetching pages MUST export a `loading.tsx` with a skeleton
  that matches the page layout — no spinner-only placeholders.
- **User-specific data**: Pages that display user information (profile, settings, email)
  MUST read from the authenticated session — hardcoded names or emails are forbidden.
- **Language consistency**: All user-facing strings MUST be in Russian. Technical
  identifiers (code, IDs, enum values) remain in English.
- **Design token usage**: Colors, spacing, and typography MUST use CSS variables defined
  in `globals.css` or Tailwind config tokens — raw hex codes and arbitrary values are
  forbidden in new components.

**Rationale**: 9 of 10 navigation items returning 404, settings showing a hardcoded email,
and missing error boundaries were the three highest-impact UX failures in the March 2026 audit.

### IV. Performance Requirements

- **Core Web Vitals targets** (measured on Vercel production, not localhost):
  - LCP ≤ 2.5 s
  - CLS ≤ 0.1
  - INP ≤ 200 ms
- **Lighthouse score**: Overall score MUST be ≥ 80 on production before each sprint release.
- **Server Components first**: Data fetching MUST happen in Server Components unless
  interactivity requires a Client Component. Never `useEffect` + `fetch` when a Server
  Component can do the job.
- **No N+1 queries**: Database queries MUST use `select` with explicit column lists and
  `join`/`include` to avoid cascading individual row fetches.
- **Bundle discipline**: Adding a new npm dependency requires explicit justification in
  the PR. Dependencies that duplicate existing ones (e.g., a second date library) are
  rejected.
- **Image optimization**: All images MUST use Next.js `<Image>` — raw `<img>` tags are
  forbidden.

**Rationale**: The platform targets business users on corporate networks in Kazakhstan.
Sub-3-second LCP is the baseline expectation; Lighthouse ≥ 80 is required for Vercel
deployment sign-off at the end of each sprint.

## Security Requirements

These constraints apply to ALL code merged into this repository, regardless of sprint or
feature scope:

- **Authentication MUST use server-side sessions**: Supabase Auth (`@supabase/ssr`) or
  NextAuth v5 with Prisma adapter are the only approved auth mechanisms. Custom
  localStorage tokens are permanently forbidden.
- **Passwords MUST be hashed with bcrypt** (cost factor ≥ 10). `btoa`, `atob`, MD5,
  SHA-1, and any reversible encoding are permanently forbidden for credential storage.
- **`SUPABASE_SERVICE_ROLE_KEY`** MUST NOT appear in any client-side file, environment
  variable prefixed `NEXT_PUBLIC_`, or git-tracked `.env` file.
- **Row-Level Security (RLS)** MUST be enabled on every Supabase table. A migration
  that creates a table without enabling RLS MUST NOT be merged.
- **All user inputs** from forms and API routes MUST be validated with Zod before
  reaching the database layer.
- **OAuth callbacks** MUST be handled server-side via `/app/auth/callback/route.ts`;
  tokens MUST NOT be exposed to the browser in URL fragments or query params beyond
  the standard code-exchange flow.
- **OWASP Top 10 review** is required for every PR that touches auth, API routes,
  or database queries.

## Development Workflow

### Branch and Commit Strategy

- One feature = one PR. Mixing auth fixes with unrelated UI changes in a single PR
  is not allowed.
- Commit messages MUST follow Conventional Commits: `feat:`, `fix:`, `refactor:`,
  `test:`, `docs:`, `chore:`.
- Every sprint concludes with a tagged release: `sprint-N-done`.

### Sprint Gate Checklist (required before sprint sign-off)

1. All items in the sprint Definition of Done are checked.
2. `npm run build` completes without errors or type-check failures.
3. Lighthouse score ≥ 80 on production Vercel URL.
4. No `btoa`/`atob` calls remain in the codebase (`grep -r "btoa\|atob" --include="*.ts" --include="*.tsx"`).
5. All navigation items return 200 (not 404).
6. Settings page displays the currently authenticated user's email.
7. All Supabase tables have RLS enabled.

### Code Review Requirements

- Every PR requires at least one approval.
- PRs touching `middleware.ts`, `app/actions/auth.ts`, or any API route under
  `/api/admin/` require explicit security review against the Security Requirements
  section above.
- AI-generated code is subject to the same review standards as human-written code.

### Definition of Done (per task)

A task is done when:
- Code passes TypeScript type-check (`tsc --noEmit`).
- The specific acceptance criteria from the feature spec are met.
- Relevant tests pass (or tests are explicitly deferred with a tracked TODO).
- No new ESLint errors are introduced.

## Governance

This constitution supersedes all other engineering practices documented in this repository.
In case of conflict, this document takes precedence.

**Amendment procedure**:
1. Open a PR with the proposed change to `.specify/memory/constitution.md`.
2. State the version bump type (MAJOR / MINOR / PATCH) and rationale in the PR description.
3. Update `LAST_AMENDED_DATE` and `CONSTITUTION_VERSION` in this file.
4. Propagate changes to dependent templates as described in the consistency checklist
   (plan-template, spec-template, tasks-template).
5. Merge only after approval from the project owner.

**Versioning policy**:
- MAJOR: principle removed, renamed, or made less restrictive (backward-incompatible governance change).
- MINOR: new principle or section added, or existing principle materially expanded.
- PATCH: wording clarification, typo fix, example added — no semantic change.

**Compliance review**: At the start of each sprint, the agent or lead developer MUST
re-read this constitution and verify that the sprint plan does not violate any principle.
Violations discovered mid-sprint MUST be addressed before the sprint closes.

**Version**: 1.0.0 | **Ratified**: 2026-03-30 | **Last Amended**: 2026-03-30
