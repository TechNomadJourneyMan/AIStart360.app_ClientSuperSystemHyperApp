# Research: Sprint 1 Completion

**Branch**: `001-sprint1-completion` | **Date**: 2026-03-30

---

## Decision 1 — Удаление localStorage auth без разрыва существующих сессий

**Decision**: Удалить вызов `authService.init()` из `stores/auth.store.ts`. Убрать
импорт `authService` из store полностью. Весь auth-поток остаётся на `loginAction`
/ `registerAction` (Server Actions) + cookies. `shared/api/auth.service.ts` остаётся
в проекте как legacy-файл, но перестаёт вызываться.

**Rationale**: Куки `aistart360_role` и `aistart360_user_id` уже устанавливаются
через `loginAction` и читаются middleware. `authService.init()` только сеет
localStorage — если его не вызывать, localStorage просто не заполняется.
Существующие активные сессии (cookies) продолжат работать без изменений.

**Alternatives considered**:
- Полное удаление `auth.service.ts` — отклонено, риск неявных зависимостей в других
  местах; безопаснее перестать вызывать, а не удалять в рамках этого спринта.
- Рефакторинг `authService` на Supabase Auth — вне scope (пользователь подтвердил).

---

## Decision 2 — Источник KPI для Dashboard (Prisma aggregation)

**Decision**: Три запроса в Server Component (`app/(dashboard)/dashboard/page.tsx`):

```typescript
const [clientCount, orgCount, avgGri] = await Promise.all([
  prisma.client.count({ where: { status: 'active' } }),
  prisma.organization.count(),
  prisma.griReport.aggregate({ _avg: { overallScore: true } }),
])
```

KPI-блоки: «Активные клиенты» → `clientCount`, «Организации» → `orgCount`,
«Средний GRI» → `avgGri._avg.overallScore ?? 0`.

**Rationale**: Данные уже есть в таблицах `clients`, `organizations`, `gri_reports`.
`Promise.all` параллелизует запросы — нет N+1. Server Component — нет клиентского
`useEffect`, данные доступны на SSR.

**Alternatives considered**:
- Отдельный API route `/api/dashboard/kpi` — излишне для Server Component; добавляет
  round-trip.
- Денормализованный счётчик в `organizations` — преждевременная оптимизация.

---

## Decision 3 — Password Reset: хранение токена

**Decision**: Переиспользовать существующую Prisma модель `VerificationToken`:
- `identifier` = email пользователя
- `token` = `crypto.randomBytes(32).toString('hex')` (64-символьный hex)
- `expires` = `new Date(Date.now() + 3_600_000)` (1 час)

Ссылка в письме: `${process.env.NEXTAUTH_URL}/auth/reset-password?token=<token>&email=<email>`

При использовании: найти запись `{ identifier: email, token }`, проверить `expires > now()`,
обновить пароль, удалить запись (`prisma.verificationToken.delete`).

**Rationale**: `VerificationToken` уже существует в схеме и БД (создан Prisma migrate).
Добавлять новую таблицу не нужно. Уникальный индекс `[identifier, token]` встроен.

**Alternatives considered**:
- Новая модель `PasswordResetToken` — излишне, дублирует уже существующую структуру.
- JWT без хранения в БД — нельзя инвалидировать после использования; риск replay-атак.

---

## Decision 4 — Resend интеграция

**Decision**: Использовать `resend` (уже в `package.json`). Server Action
`resetPasswordRequestAction`:

```typescript
import { Resend } from 'resend'
const resend = new Resend(process.env.RESEND_API_KEY)

await resend.emails.send({
  from:    'noreply@aistart360.kz',
  to:      email,
  subject: 'Сброс пароля — AIStart360',
  html:    `<p>Перейдите по ссылке для сброса пароля: <a href="${resetUrl}">${resetUrl}</a></p>
            <p>Ссылка действительна 1 час.</p>`,
})
```

ENV: `RESEND_API_KEY` добавить в `.env.local` и Vercel Dashboard.

**Rationale**: `resend` уже установлен. Минимальная интеграция — прямой вызов
без абстракций.

**Alternatives considered**:
- Nodemailer + SMTP — требует SMTP-провайдера; Resend проще и уже в зависимостях.
- Supabase email — потребовало бы Supabase Auth; вне scope.

---

## Decision 5 — Тестовая стратегия (Prisma $transaction rollback)

**Decision**: Использовать Vitest (`vitest`) + `@vitest/coverage-v8`. Каждый
интеграционный тест оборачивается в `prisma.$transaction` с принудительным
откатом через брошенный маркер:

```typescript
beforeEach(async () => {
  // Транзакция начинается в тесте через try/finally
})

// Паттерн на уровне теста:
it('login sets correct cookie', async () => {
  await prisma.$transaction(async (tx) => {
    // создать seed-данные через tx
    // выполнить тест
    throw new RollbackMarker() // гарантированный откат
  }).catch((e) => { if (!(e instanceof RollbackMarker)) throw e })
})
```

**Rationale**: Не требует второго Supabase-проекта. Каждый тест изолирован.
`RollbackMarker` — стандартный паттерн для Prisma тестов без дополнительных библиотек.

**Alternatives considered**:
- `prisma-test-environment` пакет — дополнительная зависимость, не нужна при $transaction.
- Очистка через `afterEach(deleteMany)` — неатомарно, риск state pollution между тестами.

---

## Decision 6 — Тест-раннер

**Decision**: Vitest. Установить: `npm install -D vitest @vitest/coverage-v8`.
Config в `vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: true,
  },
})
```

**Rationale**: Vitest быстрее Jest для ESM-проектов, нативно поддерживает TypeScript
без трансформации, совместим с Prisma и Next.js Server Actions.

**Alternatives considered**:
- Jest — медленнее на TypeScript ESM, требует babel или ts-jest конфига.
