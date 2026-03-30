# Data Model: Sprint 1 Completion

**Branch**: `001-sprint1-completion` | **Date**: 2026-03-30

> Новых таблиц не создаётся. Все сущности уже существуют в `prisma/schema.prisma`.
> Этот документ фиксирует роль каждой модели в рамках sprint 1 и описывает
> единственное изменение — добавление поля `position` в `User`.

---

## Существующие модели (используемые в sprint)

### User (`users`)

Используется в: US1 (auth), US2 (RBAC), US3 (settings).

| Поле | Тип | Роль в sprint |
|------|-----|---------------|
| `id` | String (cuid) | Хранится в cookie `aistart360_user_id` |
| `email` | String unique | Показывается на /settings; используется при входе |
| `passwordHash` | String? | Верифицируется через bcrypt; НИКОГДА не через btoa |
| `name` | String? | Показывается на /settings |
| `role` | UserRole enum | Читается middleware для RBAC |
| `orgId` | String? | FK → organizations; используется для KPI |
| `lastLogin` | DateTime? | Обновляется при успешном loginAction |

**Валидационные правила**:
- `email` — обязателен, уникален, формат RFC 5321
- `passwordHash` — минимум 8 символов в оригинальном пароле (Zod на входе)
- `role` — только из enum: `SUPER_ADMIN | ADMIN | MANAGER | ANALYST | CLIENT`

**Маппинг роли (UI ↔ Prisma)**:

| Cookie value | Prisma UserRole | Дэшборд |
|-------------|-----------------|---------|
| `admin` | `ADMIN` | `/dashboard` |
| `expert` | `MANAGER` | `/expert/dashboard` |
| `owner` | `SUPER_ADMIN` | `/owner/dashboard` |
| `client` | `CLIENT` | `/client/waiting-room` |
| `super_admin` | `SUPER_ADMIN` | `/admin-giga-panel` |

---

### Organization (`organizations`)

Используется в: US4 (Dashboard KPI — счётчик организаций).

| Поле | Тип | Роль в sprint |
|------|-----|---------------|
| `id` | String (cuid) | PK |
| `name` | String | Показывается в контексте дэшборда |
| `slug` | String unique | Идентификатор |

**KPI-запрос**: `prisma.organization.count()` → «Всего организаций»

---

### Client (`clients`)

Используется в: US4 (Dashboard KPI — счётчик клиентов, средний GRI).

| Поле | Тип | Роль в sprint |
|------|-----|---------------|
| `id` | String (cuid) | PK |
| `status` | ClientStatus enum | Фильтр для KPI: `active` |
| `orgId` | String | FK → organizations |
| `griReports` | GriReport[] | Источник overallScore для avg GRI |

**KPI-запросы**:
```
prisma.client.count({ where: { status: 'active' } })   → «Активные клиенты»
prisma.client.count()                                   → «Всего клиентов»
```

---

### GriReport (`gri_reports`)

Используется в: US4 (Dashboard KPI — средний GRI).

| Поле | Тип | Роль в sprint |
|------|-----|---------------|
| `overallScore` | Float | Агрегируется для avg GRI KPI |
| `clientId` | String | FK → clients |
| `calculatedAt` | DateTime | Последний расчёт |

**KPI-запрос**:
```
prisma.griReport.aggregate({ _avg: { overallScore: true } })
→ avgGri._avg.overallScore ?? 0
```

---

### VerificationToken (`verification_tokens`)

Используется в: US6 (восстановление пароля).

| Поле | Тип | Роль в sprint |
|------|-----|---------------|
| `identifier` | String | Email пользователя |
| `token` | String | `crypto.randomBytes(32).toString('hex')` |
| `expires` | DateTime | `now() + 1 час` |

**Уникальный индекс**: `[identifier, token]` — встроен в схему.

**Жизненный цикл токена**:
```
1. POST /forgot-password
   → create VerificationToken { identifier: email, token: hex, expires: +1h }
   → send email с ссылкой /auth/reset-password?token=<hex>&email=<email>

2. GET /auth/reset-password?token=<hex>&email=<email>
   → find VerificationToken { identifier: email, token: hex }
   → проверить expires > now()
   → показать форму нового пароля

3. POST /auth/reset-password (submit)
   → bcrypt.hash(newPassword, 10)
   → prisma.user.update({ where: { email }, data: { passwordHash } })
   → prisma.verificationToken.delete({ where: { identifier_token: { identifier, token } } })
   → redirect /login
```

**Constraints**:
- Токен одноразовый — удаляется сразу после использования
- Повторный запрос удаляет старый токен и создаёт новый

---

## Session (cookie — не в БД)

Сессия хранится в парe HTTP-only cookies, устанавливаемых server action:

| Cookie | Значение | maxAge |
|--------|----------|--------|
| `aistart360_role` | `admin \| expert \| owner \| client \| super_admin` | 7 дней (604800s) |
| `aistart360_user_id` | `cuid` из `users.id` | 7 дней (604800s) |

**Атрибуты cookie**: `httpOnly: true`, `sameSite: 'lax'`, `path: '/'`.
На production Vercel автоматически добавляется `secure: true`.

---

## Нет новых миграций

Все таблицы уже существуют. Никаких `prisma migrate` в этом спринте не требуется.
