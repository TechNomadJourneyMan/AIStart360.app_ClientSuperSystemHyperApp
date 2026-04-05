# Implementation Plan: Sprint 1 Completion — Auth, Error Boundaries, Real Data

**Branch**: `001-sprint1-completion` | **Date**: 2026-03-30 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-sprint1-completion/spec.md`

---

## Summary

Закрыть 5 незакрытых задач из Sprint 1–3 Master Prompt:
1. Убрать `btoa`/`localStorage` из auth (S1-01)
2. Защитить `/client/*` в middleware (S1-04)
3. Показать реальные данные на `/settings` и Dashboard (S2-01)
4. Добавить `error.tsx` + `loading.tsx` на все страницы (S3-01)
5. Реализовать восстановление пароля через Resend (S3-02)

Технический подход: минимальные точечные изменения в существующий код.
Новых таблиц нет. Auth остаётся на Prisma + Server Actions + bcrypt.
Тесты на Vitest с Prisma `$transaction` rollback.

---

## Technical Context

**Language/Version**: TypeScript 5 / Next.js 14 App Router
**Primary Dependencies**: Prisma 5, bcryptjs, Resend, Zod, React Hook Form, Zustand, Tailwind CSS, shadcn/ui
**Storage**: PostgreSQL — Supabase `tpxwrwxpdcwmiynjjquy` (EU-West-1) через Prisma ORM
**Testing**: Vitest + `@vitest/coverage-v8` + Prisma `$transaction` rollback
**Target Platform**: Vercel (Node.js serverless functions)
**Project Type**: Web application / SaaS (B2B)
**Performance Goals**: Lighthouse ≥ 80 на production; LCP ≤ 2.5s
**Constraints**: HTTP-only cookie TTL 7д; bcrypt rounds=10; Zod на всех формах; no btoa
**Scale/Scope**: ~100 concurrent users; 6 user stories; ~25 файлов к изменению/созданию

---

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **I. Code Quality** — `btoa`/`atob` удаляются из `auth.service.ts` (перестают вызываться);
  все новые файлы типизированы; Server/Client boundary соблюдён (Server Components для KPI)
- [x] **II. Testing Standards** — Vitest + Prisma `$transaction` rollback; auth/RBAC/settings
  тестируются против реальной БД; БД не мокается
- [x] **III. UX Consistency** — `app/error.tsx` + `app/global-error.tsx` создаются;
  `loading.tsx` добавляется в каждую директорию `(dashboard)/`;
  `/settings` читает данные из БД по `aistart360_user_id` из куки
- [x] **IV. Performance** — KPI дэшборда через `prisma.client.count()` / `prisma.griReport.aggregate()`
  в Server Component; `Promise.all` для параллельных запросов; нет N+1
- [x] **Security** — Новых таблиц нет → RLS не применимо; `RESEND_API_KEY` только server-side;
  Zod на `loginAction`, `registerAction`, `resetPasswordRequestAction`, `resetPasswordAction`

*Post-design re-check*: все gates подтверждены после Phase 1.

---

## Project Structure

### Documentation (this feature)

```text
specs/001-sprint1-completion/
├── plan.md          ✓ (этот файл)
├── research.md      ✓ (Phase 0)
├── data-model.md    ✓ (Phase 1)
├── quickstart.md    ✓ (Phase 1)
├── contracts/
│   ├── server-actions.md   ✓ (Phase 1)
│   └── middleware-rbac.md  ✓ (Phase 1)
└── tasks.md         — (Phase 2, /speckit.tasks)
```

### Source Code (изменяемые файлы)

```text
# AUTH — убрать btoa/localStorage
stores/auth.store.ts                    [update] — удалить authService.init()
app/actions/auth.ts                     [update] — добавить logoutAction,
                                                    resetPasswordRequestAction,
                                                    resetPasswordAction

# MIDDLEWARE — защитить /client/*
middleware.ts                           [update] — добавить client в проверку куки

# SETTINGS — реальные данные
app/(dashboard)/settings/page.tsx       [update] — читать из БД по aistart360_user_id

# DASHBOARD KPI — убрать mock
app/(dashboard)/dashboard/page.tsx      [update] — Prisma count/aggregate вместо MOCK_KPI

# ERROR BOUNDARIES
app/error.tsx                           [new]
app/global-error.tsx                    [new]
app/(dashboard)/layout.tsx              [check] — убедиться что error boundary активен

# LOADING STATES (один файл на каждый route)
app/(dashboard)/dashboard/loading.tsx   [new]
app/(dashboard)/gri/loading.tsx         [new]
app/(dashboard)/market/loading.tsx      [new]
app/(dashboard)/competitors/loading.tsx [new]
app/(dashboard)/point-a/loading.tsx     [new]
app/(dashboard)/point-b/loading.tsx     [new]
app/(dashboard)/insights/loading.tsx    [new]
app/(dashboard)/metrics/loading.tsx     [new]
app/(dashboard)/analytics/loading.tsx   [new]
app/(dashboard)/clients/loading.tsx     [new]
app/(dashboard)/reports/loading.tsx     [new]
app/(dashboard)/team/loading.tsx        [new]
app/(dashboard)/notifications/loading.tsx [new]
app/(dashboard)/profile/loading.tsx     [new]
app/(dashboard)/settings/loading.tsx    [new]
app/(dashboard)/users/loading.tsx       [new]
app/(dashboard)/pulse/loading.tsx       [new]
app/(dashboard)/ai-scanner/loading.tsx  [new]
app/(dashboard)/intelligence/loading.tsx [new]

# PASSWORD RESET
app/(auth)/forgot-password/page.tsx     [update] — реальный Resend вызов
app/auth/reset-password/page.tsx        [new] — форма нового пароля

# TESTS
vitest.config.ts                        [new]
tests/integration/auth.test.ts          [new]
tests/integration/rbac.test.ts          [new]
tests/integration/settings.test.ts      [new]
tests/integration/password-reset.test.ts [new]
```

---

## Complexity Tracking

> Нарушений конституции нет. Таблица не заполняется.
