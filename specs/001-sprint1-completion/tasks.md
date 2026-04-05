---
description: "Sprint 1 Completion — Auth, Error Boundaries, Real Data"
---

# Tasks: Sprint 1 Completion — Auth, Error Boundaries, Real Data

**Input**: Design documents from `/specs/001-sprint1-completion/`
**Prerequisites**: plan.md ✓, spec.md ✓, research.md ✓, data-model.md ✓, contracts/ ✓

**Tests**: TDD — тесты пишутся ПЕРВЫМИ в каждой US-фазе (запрошено в спецификации).

**Organization**: Задачи сгруппированы по User Story для независимой реализации и тестирования.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Можно запускать параллельно (разные файлы, нет зависимостей)
- **[Story]**: К какой User Story относится задача (US1–US6)
- Тесты ДОЛЖНЫ быть написаны и провалены ДО реализации

---

## Phase 1: Setup

**Purpose**: Подготовка тестовой инфраструктуры — блокирует все US-фазы.

- [x] T001 Установить зависимости: `npm install -D vitest @vitest/coverage-v8`
- [x] T002 [P] Создать `vitest.config.ts` в корне проекта (environment: node, include: tests/**/*.test.ts, globals: true)
- [x] T003 [P] Добавить скрипты в `package.json`: `"test": "vitest"`, `"test:coverage": "vitest --coverage"`
- [x] T004 Создать `tests/helpers/db.ts` — хелпер Prisma `$transaction` rollback паттерн с классом `RollbackMarker`

**Checkpoint**: `npm run test` запускается без ошибок (0 тестов — OK)

---

## Phase 2: Foundational

**Purpose**: Общая инфраструктура, необходимая для ВСЕХ User Stories.

**⚠️ КРИТИЧНО**: User Story работа не начинается до завершения этой фазы.

- [x] T005 [P] Проверить `lib/db.ts` — Prisma singleton должен экспортировать именованный `prisma` без изменений
- [x] T006 [P] Добавить `RESEND_API_KEY=your_key_here` в `.env.local` (получить из Resend Dashboard)
- [x] T007 [P] Добавить `RESEND_API_KEY` в список обязательных ENV в `README.md` или `SUPABASE_SETUP.md`

**Checkpoint**: Foundation ready — User Story реализация может начинаться параллельно

---

## Phase 3: User Story 1 — Безопасный вход (Priority: P1) 🎯 MVP

**Goal**: Убрать `btoa`/`localStorage` из auth-слоя. Весь поток через Server Actions + cookies.

**Independent Test**: Запустить `loginAction` → кука выставлена, `localStorage` не тронут.
Grep на `btoa`/`atob` возвращает 0 совпадений.

### Тесты для US1 — написать ПЕРВЫМИ, убедиться что ПАДАЮТ ⚠️

- [x] T008 [P] [US1] Написать тест «login success устанавливает cookies» в `tests/integration/auth.test.ts` — вызвать `loginAction`, проверить что кука содержит роль и userId
- [x] T009 [P] [US1] Написать тест «неверный пароль возвращает error: WRONG_PASSWORD» в `tests/integration/auth.test.ts`
- [x] T010 [P] [US1] Написать тест «btoa/atob отсутствует в коде» в `tests/integration/auth.test.ts` — grep через `fs.readdirSync` или встроенный `execSync`

### Реализация US1

- [x] T011 [US1] Удалить вызов `authService.init()` из метода `init` в `stores/auth.store.ts`
- [x] T011b [US1] Удалить `btoa`/`atob` из `shared/api/auth.service.ts` — заменить `btoa(password)` на заглушку `'[legacy-removed]'` в seed-данных, либо удалить весь блок `SEED_USERS` и `generateToken`; файл оставить как пустой экспорт до полного удаления в Sprint 2 *(fix: C1 — SC-001 провалится без этой задачи)*
- [x] T012 [US1] Удалить импорт `authService` из `stores/auth.store.ts` (строка `import { authService } from '@/shared/api/auth.service'`)
- [x] T013 [US1] Добавить Zod-валидацию входных данных в `loginAction` в `app/actions/auth.ts`
- [x] T014 [US1] Добавить Zod-валидацию входных данных в `registerAction` в `app/actions/auth.ts`
- [x] T014b [US1] Добавить `httpOnly: true, sameSite: 'lax'` к обоим вызовам `cookieStore.set` в `app/actions/auth.ts` — строки ~48 и ~88; без этого кука читаема из JS и нарушает Constitution §Security *(fix: C2)*
- [x] T015 [US1] Добавить `logoutAction` в `app/actions/auth.ts` — удаляет cookies `aistart360_role` и `aistart360_user_id` (`maxAge: 0, httpOnly: true`), редирект на `/login`
- [x] T016 [US1] Обновить кнопку logout во всех layouts (`app/(dashboard)/layout.tsx`, `app/(expert)/layout.tsx`, `app/(owner)/layout.tsx`) — вызывать `logoutAction` вместо `authService.logout()`

**Checkpoint**: US1 полностью функциональна и тестируема независимо. Все 3 теста зелёные.

---

## Phase 4: User Story 2 — RBAC для всех ролей (Priority: P1)

**Goal**: Middleware защищает `/client/*` наравне с другими маршрутами.
Неизвестная роль в куке → редирект на `/login`.

**Independent Test**: HTTP GET `/client/waiting-room` без куки → 307. Неизвестная роль → 307.

### Тесты для US2 — написать ПЕРВЫМИ ⚠️

- [x] T017 [P] [US2] Написать тест «/dashboard без куки → 307» в `tests/integration/rbac.test.ts` — импортировать `{ NextRequest }` из `next/server` (node environment, не edge); передать `new NextRequest('http://localhost/dashboard')` в middleware
- [x] T018 [P] [US2] Написать тест «/client/waiting-room без куки → 307» в `tests/integration/rbac.test.ts`
- [x] T018b [P] [US2] Написать тест «/expert/dashboard без куки → 307» в `tests/integration/rbac.test.ts` *(fix: A3 — SC-002 требует этот маршрут)*
- [x] T019 [P] [US2] Написать тест «кука aistart360_role=nonsense → 307» в `tests/integration/rbac.test.ts`

### Реализация US2

- [x] T020 [US2] Обновить `middleware.ts` — удалить блок `isClientPortal` который пропускает `/client/*` без проверки (строки 53–57)
- [x] T021 [US2] Обновить `middleware.ts` — добавить `/client` в массив `ADMIN_PATHS` или создать отдельную проверку: role `client` → доступ к `/client/*`; все остальные роли на `/client/*` → редирект на свой дэшборд
- [x] T022 [US2] Обновить `middleware.ts` — добавить проверку на неизвестную роль: если `role` не входит в `['admin', 'expert', 'owner', 'client', 'super_admin']` → редирект `/login`

**Checkpoint**: US2 независимо тестируема. Все 3 теста зелёные. US1 по-прежнему работает.

---

## Phase 5: User Story 3 — Settings с реальными данными (Priority: P2)

**Goal**: `/settings` показывает email, имя и должность текущего пользователя из БД.

**Independent Test**: Войти под двумя разными пользователями → `/settings` показывает разные email.

### Тесты для US3 — написать ПЕРВЫМИ ⚠️

- [x] T023 [P] [US3] Написать тест «settings читает реальный email пользователя» в `tests/integration/settings.test.ts` — создать тестового пользователя через tx, установить куку, проверить что page.tsx получает правильный email

### Реализация US3

- [x] T024 [US3] Обновить `app/(dashboard)/settings/page.tsx` — добавить `import { cookies } from 'next/headers'` и `import { prisma } from '@/lib/db'`
- [x] T025 [US3] Обновить `app/(dashboard)/settings/page.tsx` — сделать функцию `async`, читать `aistart360_user_id` из cookies, выполнить `prisma.user.findUnique({ where: { id: userId }, include: { org: true } })`
- [x] T026 [US3] Удалить все hardcoded строки из `app/(dashboard)/settings/page.tsx` — заменить `'Адиль'`, `'Ансари'`, `'adil@aistart360.com'`, `'Senior Manager'` на значения из `user.name`, `user.email`, `user.org?.name`
- [x] T027 [US3] Добавить обработку случая когда `userId` отсутствует или пользователь не найден в `settings/page.tsx` — показать сообщение об ошибке или redirect

**Checkpoint**: US3 независимо тестируема. Тест зелёный. US1 и US2 по-прежнему работают.

---

## Phase 6: User Story 4 — Dashboard без mock-данных (Priority: P2)

**Goal**: KPI-блоки `/dashboard` читают данные из `clients` + `organizations` через Prisma.

**Independent Test**: При пустой БД KPI показывают 0; импорт `MOCK_KPI` отсутствует.

### Тесты для US4 — написать ПЕРВЫМИ ⚠️

- [x] T028 [P] [US4] Написать тест «пустая БД → KPI возвращает 0» в `tests/integration/dashboard.test.ts` — через Prisma tx вызвать функцию агрегации, проверить что clientCount = 0, orgCount = 0

### Реализация US4

- [x] T029 [US4] Обновить `app/(dashboard)/dashboard/page.tsx` — убедиться что файл НЕ содержит `'use client'` (Server Component по умолчанию в App Router); импортировать `prisma` из `@/lib/db` *(fix: A4 — `'use server'` для страниц неверен)*
- [x] T030 [US4] Обновить `app/(dashboard)/dashboard/page.tsx` — добавить `Promise.all` запросы: `prisma.client.count({ where: { status: 'active' } })`, `prisma.organization.count()`, `prisma.griReport.aggregate({ _avg: { overallScore: true } })`
- [x] T031 [US4] Удалить импорт `MOCK_KPI` из `app/(dashboard)/dashboard/page.tsx` и заменить все вхождения `MOCK_KPI` на реальные данные из запросов
- [x] T032 [US4] Обновить компонент KPI-карточки — принять `clientCount`, `orgCount`, `avgGri` как props вместо hardcoded данных из mock

**Checkpoint**: US4 независимо тестируема. Тест зелёный. Предыдущие US работают.

---

## Phase 7: User Story 5 — Error Boundaries + Loading States (Priority: P2)

**Goal**: Все страницы `(dashboard)` имеют `error.tsx` + `loading.tsx`. Глобальные error boundaries созданы.

**Independent Test**: Отсутствие `app/error.tsx` → CI падает. Все директории (dashboard) содержат `loading.tsx`.

### Реализация US5 (тесты структурные — через quickstart.md шаги 3–4)

- [x] T033 [P] [US5] Создать `app/error.tsx` — Client Component с `'use client'`, props `{ error, reset }`, текст «Что-то пошло не так» на русском, кнопка «Попробовать снова» вызывает `reset()`
- [x] T034 [P] [US5] Создать `app/global-error.tsx` — аналогично `error.tsx`, дополнительно включает `<html>` и `<body>` теги (требование Next.js для global error)
- [x] T035 [P] [US5] Создать `app/(dashboard)/dashboard/loading.tsx` — skeleton: заголовок + 4 KPI-блока анимация `animate-pulse`
- [x] T036 [P] [US5] Создать `app/(dashboard)/gri/loading.tsx` — skeleton: заголовок + блок score `animate-pulse`
- [x] T037 [P] [US5] Создать `app/(dashboard)/market/loading.tsx` — skeleton: заголовок + таблица-placeholder `animate-pulse`
- [x] T038 [P] [US5] Создать `app/(dashboard)/competitors/loading.tsx` — skeleton: заголовок + список `animate-pulse`
- [x] T039 [P] [US5] Создать `app/(dashboard)/point-a/loading.tsx` — skeleton: заголовок + форма `animate-pulse`
- [x] T040 [P] [US5] Создать `app/(dashboard)/point-b/loading.tsx` — skeleton: заголовок + roadmap-блок `animate-pulse`
- [x] T041 [P] [US5] Создать `app/(dashboard)/insights/loading.tsx` — skeleton: заголовок + карточки `animate-pulse`
- [x] T042 [P] [US5] Создать `app/(dashboard)/metrics/loading.tsx` — skeleton: заголовок + графики `animate-pulse`
- [x] T043 [P] [US5] Создать `app/(dashboard)/analytics/loading.tsx` — skeleton: заголовок + chart-placeholder `animate-pulse`
- [x] T044 [P] [US5] Создать `app/(dashboard)/clients/loading.tsx` — skeleton: заголовок + таблица-placeholder `animate-pulse`
- [x] T045 [P] [US5] Создать `app/(dashboard)/reports/loading.tsx` — skeleton: заголовок + список `animate-pulse`
- [x] T046 [P] [US5] Создать `app/(dashboard)/team/loading.tsx` — skeleton: заголовок + grid аватаров `animate-pulse`
- [x] T047 [P] [US5] Создать `app/(dashboard)/notifications/loading.tsx` — skeleton: заголовок + список `animate-pulse`
- [x] T048 [P] [US5] Создать `app/(dashboard)/profile/loading.tsx` — skeleton: аватар + поля `animate-pulse`
- [x] T049 [P] [US5] Создать `app/(dashboard)/settings/loading.tsx` — skeleton: сайдбар + форма `animate-pulse`
- [x] T050 [P] [US5] Создать `app/(dashboard)/users/loading.tsx` — skeleton: заголовок + таблица `animate-pulse`
- [x] T051 [P] [US5] Создать `app/(dashboard)/pulse/loading.tsx` — skeleton: заголовок + метрики `animate-pulse`
- [x] T052 [P] [US5] Создать `app/(dashboard)/ai-scanner/loading.tsx` — skeleton: заголовок + форма-шаги `animate-pulse`
- [x] T053 [P] [US5] Создать `app/(dashboard)/intelligence/loading.tsx` — skeleton: заголовок + карточки `animate-pulse`

**Checkpoint**: Quickstart шаги 3–4 проходят. Все 19 `loading.tsx` существуют. Оба `error.tsx` существуют.

---

## Phase 8: User Story 6 — Восстановление пароля (Priority: P3)

**Goal**: `/forgot-password` отправляет реальное письмо через Resend. `/auth/reset-password` обновляет пароль в БД.

**Independent Test**: Реальный email → письмо за 60 секунд. Токен одноразовый.

### Тесты для US6 — написать ПЕРВЫМИ ⚠️

- [x] T054 [P] [US6] Написать тест «resetPasswordRequestAction создаёт VerificationToken» в `tests/integration/password-reset.test.ts` — через tx создать пользователя, вызвать action, проверить что токен создан в БД (Resend замокать через `vi.mock`)
- [x] T055 [P] [US6] Написать тест «истёкший токен возвращает TOKEN_EXPIRED» в `tests/integration/password-reset.test.ts` — создать токен с `expires: new Date(0)`, вызвать `resetPasswordAction`
- [x] T056 [P] [US6] Написать тест «успешный сброс обновляет passwordHash» в `tests/integration/password-reset.test.ts` — создать пользователя + валидный токен, вызвать action, проверить bcrypt hash изменился

### Реализация US6

- [x] T057 [US6] Добавить `resetPasswordRequestAction` в `app/actions/auth.ts` — Zod validate email, `crypto.randomBytes(32).toString('hex')` для токена, `prisma.verificationToken.upsert` (upsert чтобы не дублировать), `resend.emails.send`
- [x] T058 [US6] Добавить `resetPasswordAction` в `app/actions/auth.ts` — Zod validate (token, email, newPassword), найти `VerificationToken`, проверить `expires > now()`, `bcrypt.hash(newPassword, 10)`, обновить `users.passwordHash`, удалить токен
- [x] T059 [US6] Обновить `app/(auth)/forgot-password/page.tsx` — заменить `await new Promise(setTimeout)` на вызов `resetPasswordRequestAction(email)`, добавить реальную обработку ошибок
- [x] T060 [US6] Создать `app/auth/reset-password/page.tsx` — Client Component, читает `token` и `email` из `useSearchParams`, форма нового пароля + подтверждения, вызывает `resetPasswordAction`, редирект на `/login` при успехе
- [x] T061 [US6] Добавить обработку expired/invalid ссылки в `app/auth/reset-password/page.tsx` — показывать сообщение «Ссылка недействительна или истекла» без формы

**Checkpoint**: Все 3 теста US6 зелёные. Quickstart шаги 7–8 проходят.

---

## Phase N: Polish & Sprint Gate

**Purpose**: Финальная верификация конституции. Все задачи должны быть выполнены.

- [x] T062 [P] Запустить quickstart шаг 1: `grep -r "btoa\|atob" --include="*.ts" --include="*.tsx" --exclude-dir=node_modules .` → 0 совпадений
- [x] T063 [P] Запустить quickstart шаг 2: `npm run build` → 0 ошибок TypeScript
- [x] T064 [P] Запустить quickstart шаг 3: проверить `loading.tsx` во всех директориях `(dashboard)/`
- [x] T065 Запустить `npm run test` — все тесты зелёные (T008–T010, T017–T019, T023, T028, T054–T056)
- [ ] T066 Запустить quickstart шаги 5–8 вручную — RBAC, settings, dashboard, password reset

### Constitution Sprint Gate (ref: .specify/memory/constitution.md §Development Workflow)

- [x] TGATE-1 `npm run build` завершается без ошибок
- [x] TGATE-2 `grep -r "btoa\|atob" --include="*.ts" --include="*.tsx"` → 0 совпадений вне node_modules
- [ ] TGATE-3 Все navigation items возвращают HTTP 200 (не 404)
- [x] TGATE-4 `/settings` показывает реальный email авторизованного пользователя (не hardcoded)
- [ ] TGATE-5 Все Supabase таблицы имеют RLS включён
- [ ] TGATE-6 Lighthouse score ≥ 80 на production Vercel URL
- [x] TGATE-7 Нет TypeScript `any` без `// TODO(type):` аннотации в новых файлах

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: Нет зависимостей — начинать немедленно
- **Foundational (Phase 2)**: Зависит от Setup — блокирует все US
- **US1 (Phase 3)**: Зависит от Foundational — блокирует остальные US (auth нужен всем)
- **US2 (Phase 4)**: Зависит от US1 (logoutAction нужен middleware-тестам)
- **US3, US4, US5 (Phase 5–7)**: Зависят от US1+US2 — могут идти параллельно
- **US6 (Phase 8)**: Зависит от US1 (loginAction паттерн); независима от US3–US5
- **Polish (Phase N)**: Зависит от всех US

### User Story Dependencies

- **US1 (P1)**: После Foundational — нет зависимостей от других US
- **US2 (P1)**: После US1 — тесты используют loginAction
- **US3 (P2)**: После US1+US2 — независима от US4, US5, US6
- **US4 (P2)**: После US1+US2 — независима от US3, US5, US6
- **US5 (P2)**: После US1+US2 — полностью независима, все [P] задачи параллельны
- **US6 (P3)**: После US1 — независима от US2–US5

### Parallel Opportunities

- Все `loading.tsx` задачи (T035–T053) — 19 файлов параллельно
- Тесты внутри каждой US (помечены [P]) — параллельно
- US3, US4, US5 — параллельно друг другу (разные файлы, нет зависимостей)
- T033 (`error.tsx`) + T034 (`global-error.tsx`) — параллельно

---

## Parallel Example: US5 (Loading States)

```bash
# Все 19 loading.tsx создать одновременно (разные файлы):
Task T035: app/(dashboard)/dashboard/loading.tsx
Task T036: app/(dashboard)/gri/loading.tsx
Task T037: app/(dashboard)/market/loading.tsx
# ... и т.д. до T053

# Плюс параллельно:
Task T033: app/error.tsx
Task T034: app/global-error.tsx
```

---

## Implementation Strategy

### MVP First (US1 + US2 Only — Sprint 1 Critical)

1. Завершить Phase 1: Setup
2. Завершить Phase 2: Foundational
3. Завершить Phase 3: US1 — убрать btoa/localStorage ← САМОЕ ВАЖНОЕ
4. Завершить Phase 4: US2 — защитить /client/*
5. **СТОП и ВАЛИДАЦИЯ**: btoa grep = 0, RBAC тесты зелёные
6. Deploy на Vercel — Sprint 1 Critical выполнен

### Incremental Delivery

1. Setup + Foundational → инфраструктура готова
2. US1 → безопасный auth (MVP sprint 1)
3. US2 → полный RBAC (MVP sprint 1 complete)
4. US3 + US4 + US5 параллельно → реальные данные + error handling
5. US6 → password reset
6. Polish + Sprint Gate → деплой

### Parallel Team Strategy

При двух разработчиках после US1+US2:
- Разработчик A: US3 (Settings) + US4 (Dashboard KPI)
- Разработчик B: US5 (все loading.tsx) + US6 (Password Reset)

---

## Notes

- [P] = разные файлы, нет зависимостей — запускать параллельно
- Тесты ДОЛЖНЫ быть написаны и ПРОВАЛЕНЫ до реализации (TDD)
- Только Resend мокается в тестах (внешний сервис); Prisma — никогда
- Коммитить после каждой US или логической группы
- Останавливаться на каждом checkpoint для независимой валидации
