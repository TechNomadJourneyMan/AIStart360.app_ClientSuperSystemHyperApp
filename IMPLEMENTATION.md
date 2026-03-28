# Документация реализации — AI Portal Admin System

Полное описание всего, что было разработано: ГИГА-Панель (Super Admin UI) и полноценный бэкенд операционной админ-панели.

---

## 1. Архитектурный обзор

```
AI-Portal/
├── app/
│   ├── admin-giga-panel/          # Изолированный Super Admin UI
│   │   ├── layout.tsx             # Deep Navy layout + GigaSidebar
│   │   └── page.tsx               # Командный центр (KPI + модули)
│   │
│   └── api/
│       ├── admin/                 # ← НОВЫЙ бэкенд (описан ниже)
│       │   ├── requests/          # Управление заявками
│       │   ├── users/             # CRM — пользователи
│       │   ├── companies/         # CRM — компании
│       │   ├── audit/             # Иммутабельный аудит-лог
│       │   └── analytics/         # Аналитика и метрики
│       │
│       └── giga-admin/            # Служебные эндпоинты ГИГА-Панели
│
├── components/giga-panel/         # UI-компоненты ГИГА-Панели
│   ├── GigaSidebar.tsx            # Сайдбар с навигацией (Заявки, CRM, Клиенты)
│   ├── RequestsModule.tsx
│   ├── CRMModule.tsx
│   ├── ClientsModule.tsx          # ← НОВЫЙ: Раздел клиентов платформы
│   ├── RejectModal.tsx
│   └── UserSettingsModal.tsx
│
├── lib/
│   ├── rbac.ts                    # ← НОВЫЙ: RBAC + permission matrix
│   ├── audit.ts                   # ← НОВЫЙ: Audit logger
│   ├── auth.ts                    # NextAuth v5 (Google OAuth)
│   └── db.ts                      # Prisma client singleton
│
├── prisma/schema.prisma           # ← ОБНОВЛЁН: новые модели
├── stores/gigaPanel.store.ts      # ← НОВЫЙ: Zustand store для UI
└── middleware.ts                  # ← ОБНОВЛЁН: защита /admin-giga-panel
```

---

## 2. ГИГА-Панель (Super Admin UI)

### Что это
Изолированный административный интерфейс, доступный **только** пользователям с ролью `SUPER_ADMIN`. Визуальный стиль: премиальный glassmorphism на тёмном Navy фоне с Electric Blue акцентами.

### Защита доступа
**Middleware** (`middleware.ts`) проверяет cookie `aistart360_role`:
```
/admin-giga-panel/*  →  если role ≠ 'super_admin'  →  rewrite /not-found (404)
```

Для активации доступа SUPER_ADMIN необходимо установить cookie:
```typescript
document.cookie = 'aistart360_role=super_admin; path=/; max-age=604800'
```

### Модули

#### А. Командный центр (`/admin-giga-panel`)
- 4 KPI-блока: Ожидают / Одобрено / Отклонено / Заблокировано
- Переключатель модулей: Заявки ↔ CRM
- Framer Motion анимации переходов

#### Б. Модуль заявок (RequestsModule)
- Три категории (tabs): Регистрация | Доступы | Поддержка
- Бейдж с количеством pending-заявок на каждом табе
- Карточка заявки: аватар, имя, email, компания, дата, статус-бейдж
- Раскрывающееся описание (expand/collapse)
- Кнопки: **Принять** (зелёный) / **Отклонить** (красный + модалка с причиной) / **В архив** (серый)
- Разделение: «ОЖИДАЮТ ОБРАБОТКИ» vs «ОБРАБОТАННЫЕ»
- Анимация появления карточек через `AnimatePresence`

#### В. CRM-модуль (CRMModule)
- Поиск по имени / email / компании
- Фильтр-табы: Все | Активные | Заблокированные | Ожидающие
- Сортируемая таблица (по имени, дате)
- Колонки: Пользователь, Роль, Статус, Компания, Даты, Действия
- **Блокировка**: кнопка с confirmation-диалогом → DELETE /sessions + статус blocked
- **Настройки**: открывает UserSettingsModal с чекбоксами видимых виджетов

#### Г. RejectModal
- Анимированное модальное окно
- Обязательное текстовое поле «причина»
- Валидация (кнопка неактивна без текста)

#### Е. UserSettingsModal
- Сетка виджетов (10 шт.)
- Быстрые кнопки «Выбрать все» / «Снять все»
- Счётчик выбранных
- Сохранение через `POST /api/giga-admin/users/:id/widgets`

### State Management
Zustand store (`stores/gigaPanel.store.ts`):
- `activeModule` — текущий модуль
- `activeRequestTab` — текущий таб заявок
- `requests[]` — 9 mock-заявок (3 + 3 + 3 по категориям)
- `users[]` — данные из Prisma через API
- Экшены: `approveRequest`, `rejectRequest`, `archiveRequest`, `blockUser`, `updateUserWidgets`

---

## 3. База данных — новые модели

### 3.1. Обновление User
```prisma
status  UserStatus @default(active)  // active | blocked

// Новые отношения:
submittedRequests AdminRequest[] @relation("RequestSubmitter")
assignedRequests  AdminRequest[] @relation("RequestAssignee")
comments          Comment[]
auditLogs         AuditLog[]
```

### 3.2. Company
Лид / активная / заблокированная компания в CRM.
```
id, name, domain (unique), status (lead|active|blocked), notes, createdAt, updatedAt
```

### 3.3. AdminRequest — State Machine
```
new → in_review → waiting_for_info → approved
                                  ↘ rejected
     → escalated → approved | rejected
```

Поля: `id, type, status, priority, userId, companyId, assignedAdminId, source, payload (JSON), rejectionReason, slaDeadline, createdAt, updatedAt`

**SLA deadlines по приоритету:**
| Приоритет | Срок  |
|-----------|-------|
| critical  | 2 ч   |
| high      | 8 ч   |
| medium    | 24 ч  |
| low       | 72 ч  |

### 3.4. Comment
Внутренняя заметка или сообщение пользователю.
```
id, requestId, authorId, text, isInternal (bool), createdAt
```

### 3.5. AuditLog
Иммутабельная запись каждого действия.
```
id, entityType, entityId, action, performedBy, timestamp, diff (JSON), ipAddress
```

**Для применения миграции:**
```bash
npx prisma migrate dev --name add_admin_portal_models
npx prisma generate
```

---

## 4. RBAC — Матрица прав (`lib/rbac.ts`)

| Permission           | SUPER_ADMIN | ADMIN | MANAGER | ANALYST | CLIENT |
|----------------------|:-----------:|:-----:|:-------:|:-------:|:------:|
| requests:read        | ✔           | ✔     | ✔       | ✔       | —      |
| requests:write       | ✔           | ✔     | —       | —       | —      |
| requests:approve     | ✔           | ✔     | —       | —       | —      |
| requests:assign      | ✔           | ✔     | ✔       | —       | —      |
| requests:bulk        | ✔           | ✔     | —       | —       | —      |
| users:read           | ✔           | ✔     | ✔       | —       | —      |
| users:write          | ✔           | ✔     | —       | —       | —      |
| roles:manage         | ✔           | —     | —       | —       | —      |
| companies:read       | ✔           | ✔     | ✔       | ✔       | —      |
| companies:write      | ✔           | ✔     | —       | —       | —      |
| audit:read           | ✔           | —     | —       | —       | —      |
| analytics:read       | ✔           | ✔     | —       | ✔       | —      |
| comments:write       | ✔           | ✔     | ✔       | —       | —      |

**Использование в API-роутах:**
```typescript
import { requirePermission } from '@/lib/rbac'

export async function GET(req: NextRequest) {
  const { session, error } = await requirePermission('requests:read')
  if (error) return error // автоматически 401 или 403
  // session.user.id, session.user.role доступны
}
```

---

## 5. Аудит (`lib/audit.ts`)

Все действия автоматически логируются в `AuditLog`. Fire-and-forget — ошибки записи не блокируют операцию.

```typescript
await logAudit({
  entityType: 'request',
  entityId: id,
  action: 'request.approved',
  performedBy: session.user.id,
  diff: { before: { status: 'in_review' }, after: { status: 'approved' } },
})
```

**Список action-типов:**
- `request.created` / `request.approved` / `request.rejected`
- `request.assigned` / `request.status_changed` / `request.info_requested`
- `request.escalated` / `request.commented`
- `request.bulk_approved` / `request.bulk_rejected` / `request.bulk_assigned`
- `user.blocked` / `user.unblocked` / `user.role_changed`
- `company.created` / `company.status_changed`

---

## 6. API Reference

### Requests

| Метод  | Путь                                      | Permission        | Описание                           |
|--------|-------------------------------------------|-------------------|------------------------------------|
| GET    | `/api/admin/requests`                     | requests:read     | Список с фильтрами и пагинацией   |
| POST   | `/api/admin/requests`                     | requests:write    | Создать заявку вручную            |
| GET    | `/api/admin/requests/:id`                 | requests:read     | Карточка заявки + комментарии     |
| PATCH  | `/api/admin/requests/:id`                 | requests:write    | Обновить поля заявки              |
| POST   | `/api/admin/requests/:id/approve`         | requests:approve  | Одобрить + side-effects           |
| POST   | `/api/admin/requests/:id/reject`          | requests:approve  | Отклонить (body: `{reason}`)      |
| POST   | `/api/admin/requests/:id/assign`          | requests:assign   | Назначить админа                  |
| POST   | `/api/admin/requests/:id/request-info`    | requests:assign   | Запросить инфо → waiting_for_info |
| GET    | `/api/admin/requests/:id/comments`        | requests:read     | Список комментариев               |
| POST   | `/api/admin/requests/:id/comments`        | comments:write    | Добавить комментарий              |
| POST   | `/api/admin/requests/bulk`                | requests:bulk     | Массовые операции (до 100 шт.)    |

### Users

| Метод  | Путь                          | Permission    | Описание                          |
|--------|-------------------------------|---------------|-----------------------------------|
| GET    | `/api/admin/users`            | users:read    | Список с фильтрами               |
| GET    | `/api/admin/users/:id`        | users:read    | Профиль + история заявок         |
| PATCH  | `/api/admin/users/:id`        | users:write   | Обновить имя / роль              |
| POST   | `/api/admin/users/:id/block`  | users:write   | Блок / разблок + удаление сессий |

### Companies

| Метод  | Путь                       | Permission        | Описание              |
|--------|----------------------------|-------------------|-----------------------|
| GET    | `/api/admin/companies`     | companies:read    | Список компаний      |
| POST   | `/api/admin/companies`     | companies:write   | Создать компанию     |
| GET    | `/api/admin/companies/:id` | companies:read    | Профиль + заявки     |
| PATCH  | `/api/admin/companies/:id` | companies:write   | Обновить статус/поля |

### Audit & Analytics

| Метод | Путь                   | Permission      | Описание                           |
|-------|------------------------|-----------------|------------------------------------|
| GET   | `/api/admin/audit`     | audit:read      | Аудит-лог (только SUPER_ADMIN)    |
| GET   | `/api/admin/analytics` | analytics:read  | KPI, SLA, конверсия, нагрузка     |

### GIGA-Panel служебные

| Метод | Путь                                | Описание                  |
|-------|-------------------------------------|---------------------------|
| GET   | `/api/giga-admin/users`             | Пользователи для CRM      |
| POST  | `/api/giga-admin/users/:id/block`   | Блок (cookie-auth)        |
| POST  | `/api/giga-admin/users/:id/widgets` | Сохранить виджет-конфиг   |

---

## 7. Бизнес-сценарии реализованы

### Регистрация нового пользователя
1. Заявка создаётся (`type: registration`, `status: new`)
2. SLA-дедлайн устанавливается автоматически по приоритету
3. Admin назначается → статус → `in_review`
4. **Approve**: создаётся User + активируется Company + логируется
5. **Reject**: фиксируется причина + логируется

### Запрос расширения доступа
1. `type: access`, payload содержит `targetRole`
2. **Approve**: обновляется `user.role` через `prisma.user.update`

### Массовые операции
`POST /api/admin/requests/bulk`
Поддерживаемые операции: `approve`, `reject`, `assign`, `archive`
Лимит: 100 заявок за один запрос. Терминальные статусы (approved/rejected) пропускаются.

### Блокировка пользователя
`POST /api/admin/users/:id/block` с `{block: true}`:
- Устанавливает `user.status = blocked`
- `DELETE FROM sessions WHERE userId = id` — мгновенный выход со всех устройств
- Записывает audit-лог

---

## 8. .env.local — переменные

```bash
# Database
DATABASE_URL="postgresql://..."
DIRECT_URL="postgresql://..."

# Supabase
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

# NextAuth v5
NEXTAUTH_SECRET=...
NEXTAUTH_URL=http://localhost:3000
AUTH_GOOGLE_ID=...         # NextAuth v5 convention (= GOOGLE_CLIENT_ID)
AUTH_GOOGLE_SECRET=...     # NextAuth v5 convention (= GOOGLE_CLIENT_SECRET)

# Legacy aliases
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

---

## 9. Что сделать после этого

| Шаг | Команда / Действие |
|-----|--------------------|
| Применить миграцию | `npx prisma migrate dev --name add_admin_portal_models` |
| Регенерировать клиент | `npx prisma generate` |
| Добавить SUPER_ADMIN в БД | `UPDATE users SET role = 'SUPER_ADMIN' WHERE email = 'your@email.com';` |
| Установить cookie в браузере | `document.cookie = 'aistart360_role=super_admin; path=/; max-age=3600'` |
| Перейти на ГИГА-Панель | `http://localhost:3000/admin-giga-panel` |

---

## 10. Нефункциональные требования — статус

| Требование | Статус | Реализация |
|------------|--------|------------|
| Аутентификация | ✅ | NextAuth v5 + session-based guard в каждом API-роуте |
| RBAC | ✅ | `lib/rbac.ts` — `requirePermission()` на каждом эндпоинте |
| Audit Log | ✅ | `lib/audit.ts` — иммутабельный, fire-and-forget |
| Пагинация | ✅ | Все list-эндпоинты: `page`, `limit`, `totalPages` |
| SLA | ✅ | `slaDeadline` auto-set, `GET /analytics` показывает overdue |
| Rate limiting | ⏳ | Upstash уже в зависимостях — добавить в middleware |
| Email-уведомления | ⏳ | Resend уже в зависимостях — раскомментировать TODO в request-info |
| Очереди (async) | ⏳ | Inngest уже в зависимостях — оборачивать side-effects в jobs |
| Антифрод | ⏳ | Проверка одноразовых email при approve registration |
