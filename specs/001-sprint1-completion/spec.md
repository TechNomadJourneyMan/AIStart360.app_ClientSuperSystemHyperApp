# Feature Specification: Sprint 1 Completion — Auth, Error Boundaries, Real Data

**Feature Branch**: `001-sprint1-completion`
**Created**: 2026-03-30
**Status**: Draft
**Input**: Закрыть все частично и не выполненные задачи из Sprint 1–3 Master Prompt.
Supabase проект остаётся тот, что в `.env` (`tpxwrwxpdcwmiynjjquy`). Тесты пишутся первыми.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Безопасный вход и регистрация (Priority: P1)

Пользователь открывает `/login`, вводит email и пароль. Система проверяет учётные данные
через сервер (bcrypt), устанавливает сессию через cookie, перенаправляет на дэшборд
по роли. Никакие пароли, токены или данные сессии не хранятся в `localStorage`.
`btoa`/`atob` не используются нигде в продуктовом коде.

**Why this priority**: Критическая уязвимость. Пароли в `btoa` и сессии в
`localStorage` — провальный пункт любого security-аудита.

**Independent Test**: Запустить `loginAction('email', 'password')` напрямую —
убедиться, что кука выставлена, `localStorage` не тронут, неверный пароль
возвращает ошибку без краша.

**Acceptance Scenarios**:

1. **Given** пользователь с верными учётными данными, **When** отправляет форму входа,
   **Then** cookie `aistart360_role` и `aistart360_user_id` выставлены,
   редирект на соответствующий дэшборд, `localStorage` не содержит сессии или пароля.
2. **Given** пользователь с неверным паролем, **When** отправляет форму,
   **Then** отображается сообщение об ошибке на русском, редиректа нет, cookies не выставлены.
3. **Given** проект без `node_modules`, **When** запускается
   `grep -r "btoa\|atob" --include="*.ts" --include="*.tsx"`,
   **Then** совпадений ноль.
4. **Given** пользователь выполнил logout, **When** обращается к `/dashboard`,
   **Then** middleware перенаправляет на `/login`, доступа нет.

---

### User Story 2 — Защита маршрутов и RBAC для всех ролей (Priority: P1)

Неавторизованный пользователь не может открыть ни одну защищённую страницу.
Авторизованный видит только разделы своей роли. Роль `client` защищена
наравне с остальными — обращение к `/client/*` без куки → редирект.

**Why this priority**: Middleware сейчас пропускает `/client/*` без проверки.
Любой знает URL — получает доступ.

**Independent Test**: HTTP GET на `/dashboard` и `/client/waiting-room` без
куки — оба должны вернуть 307 на `/login`.

**Acceptance Scenarios**:

1. **Given** запрос без куки `aistart360_role`, **When** обращение к любому
   защищённому маршруту (`/dashboard/*`, `/client/*`, `/expert/*`, `/owner/*`),
   **Then** возвращается редирект 307 на `/login?from=<path>`.
2. **Given** роль `expert`, **When** попытка открыть `/dashboard`,
   **Then** редирект на `/expert/dashboard`.
3. **Given** роль `client`, **When** открывает `/client/waiting-room`,
   **Then** страница доступна и отрисована.
4. **Given** кука `aistart360_role=nonsense` (неизвестная роль), **When** обращение
   к любому защищённому маршруту, **Then** редирект на `/login`.

---

### User Story 3 — Страница настроек с реальными данными пользователя (Priority: P2)

Вошедший пользователь открывает `/settings` и видит свой реальный email, имя и
должность — данные берутся из базы данных по ID из сессионной куки,
а не из захардкоженных строк в коде.

**Why this priority**: Settings показывает `adil@aistart360.com` всем пользователям —
UX-ошибка и потенциальная утечка данных.

**Independent Test**: Войти под двумя разными аккаунтами поочерёдно — на `/settings`
должны отображаться разные email и имена.

**Acceptance Scenarios**:

1. **Given** авторизованный пользователь с email `test@example.com`,
   **When** открывает `/settings`,
   **Then** поле Email показывает `test@example.com`.
2. **Given** имя пользователя обновлено в БД, **When** перезагружает `/settings`,
   **Then** новое имя отображается без перезапуска сервера.
3. **Given** исходный код файла `/settings/page.tsx`, **When** поиск строки
   `adil@aistart360.com`, **Then** совпадений нет.

---

### User Story 4 — Dashboard без mock-данных (Priority: P2)

Администратор открывает `/dashboard` и видит KPI-карточки с реальными значениями
из базы данных — не из `lib/mock-data.ts`.

**Why this priority**: Hardcoded числа вводят в заблуждение и не отражают
реальное состояние бизнеса.

**Independent Test**: При пустой базе данных KPI-карточки показывают 0 или
«нет данных», а не статичные числа.

**Acceptance Scenarios**:

1. **Given** в БД 0 активных клиентов, **When** открывается `/dashboard`,
   **Then** KPI «Клиенты» показывает 0, а не захардкоженное значение.
2. **Given** исходный код `/dashboard/page.tsx`, **When** поиск
   `import.*MOCK_KPI.*mock-data`, **Then** совпадений нет.
3. **Given** добавлен новый клиент в БД, **When** перезагружается `/dashboard`,
   **Then** счётчик клиентов увеличивается.

---

### User Story 5 — Error Boundaries и Loading States (Priority: P2)

Пользователь на любой странице портала при сетевой ошибке видит понятное
сообщение с кнопкой «Попробовать снова» — не белый экран. При загрузке данных
видна skeleton-заглушка.

**Why this priority**: Белые экраны разрушают доверие к платформе.

**Independent Test**: Передать заведомо неверные данные для запроса к БД —
открыть страницу дэшборда — должен показаться `error.tsx`, не пустой экран.

**Acceptance Scenarios**:

1. **Given** сбой при загрузке данных, **When** открывается любая страница
   `app/(dashboard)/`, **Then** отображается `error.tsx` с кнопкой «Попробовать снова».
2. **Given** медленный ответ от БД, **When** страница начинает рендер,
   **Then** виден skeleton-лоадер, не пустое пространство.
3. **Given** файловая система, **When** проверка `app/error.tsx` и
   `app/global-error.tsx`, **Then** оба файла существуют.
4. **Given** каждая директория внутри `app/(dashboard)/`, **When** проверка
   наличия `loading.tsx`, **Then** файл найден в каждой директории.

---

### User Story 6 — Восстановление пароля (Priority: P3)

Пользователь вводит email на `/forgot-password`. Система отправляет реальное
письмо через Resend. По ссылке открывается форма нового пароля. Пароль
обновляется в БД (bcrypt).

**Why this priority**: Сейчас форма — заглушка с `setTimeout`. Без реального
сброса заблокированные пользователи не могут восстановить доступ.

**Independent Test**: Ввести реальный email — через 60 секунд на почте
должно быть письмо со ссылкой сброса.

**Acceptance Scenarios**:

1. **Given** зарегистрированный email, **When** отправлена форма `/forgot-password`,
   **Then** на почту приходит письмо со ссылкой (не имитация через `setTimeout`).
2. **Given** ссылка из письма, **When** пользователь переходит по ней,
   **Then** открывается форма нового пароля на `/auth/reset-password`.
3. **Given** форма нового пароля, **When** пользователь вводит и подтверждает,
   **Then** пароль обновляется в БД (bcrypt), редирект на `/login`.
4. **Given** незарегистрированный email, **When** форма отправлена,
   **Then** показывается нейтральное сообщение (без указания, что email не найден —
   защита от перебора).
5. **Given** истёкшая ссылка сброса, **When** пользователь переходит,
   **Then** показывается сообщение «Ссылка недействительна или истекла».

---

### Edge Cases

- Что если кука `aistart360_role` подделана (несуществующее значение)?
  → Middleware перенаправляет на `/login`.
- Что если пользователь удалён из БД, но кука ещё действует?
  → `/settings` показывает ошибку или выполняет автоматический logout.
- Что если БД недоступна при входе?
  → Форма входа показывает понятное сообщение, не HTTP 500.
- Что если ссылка сброса пароля использована дважды?
  → Второй переход показывает «Ссылка уже использована».

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Система НЕ ДОЛЖНА хранить пароли, токены или данные сессии
  в `localStorage` или `sessionStorage`.
- **FR-002**: Система НЕ ДОЛЖНА использовать `btoa`/`atob` для хранения,
  сравнения или передачи паролей и токенов в продуктовом коде.
- **FR-003**: Сессия пользователя ДОЛЖНА храниться в HTTP-only cookie с TTL 7 дней
  (`maxAge: 604800`), устанавливаемой исключительно сервером (server action).
- **FR-004**: Middleware ДОЛЖЕН проверять сессионную куку для ВСЕХ защищённых
  маршрутов, включая `/client/*`. Неизвестная или отсутствующая роль →
  редирект на `/login`.
- **FR-005**: `shared/api/auth.service.ts` НЕ ДОЛЖЕН вызываться для инициализации
  сессии или входа — весь auth-поток идёт через server actions и cookies.
- **FR-006**: Страница `/settings` ДОЛЖНА отображать email, имя и должность
  текущего пользователя из БД по `aistart360_user_id` из куки.
- **FR-007**: Страница `/dashboard` ДОЛЖНА отображать KPI из таблиц `clients`
  и `organizations` (Prisma), а не из статичного файла mock-данных (`lib/mock-data.ts`).
  Конкретные KPI: количество активных клиентов (`clients`), количество организаций
  (`organizations`), средний GRI-балл (агрегат по `gri_reports.overallScore`).
- **FR-008**: Файлы `app/error.tsx` и `app/global-error.tsx` ДОЛЖНЫ существовать
  и показывать сообщение об ошибке с кнопкой «Попробовать снова» на русском.
- **FR-009**: Каждая директория внутри `app/(dashboard)/` ДОЛЖНА содержать
  `loading.tsx` со skeleton-заглушкой, соответствующей структуре страницы.
- **FR-010**: Форма `/forgot-password` ДОЛЖНА отправлять реальное email-сообщение
  через Resend, а не имитировать отправку через `setTimeout` или `Promise`.
- **FR-011**: Страница `/auth/reset-password` ДОЛЖНА существовать, принимать
  токен из URL, показывать форму нового пароля и обновлять запись в БД (bcrypt).

### Key Entities

- **User** — запись в таблице `users` (Prisma). Ключевые поля: `id`, `email`,
  `name`, `passwordHash`, `role`, `orgId`. Используется для верификации при входе
  и отображения данных в Settings.
- **Session** — пара HTTP-only cookie `aistart360_role` + `aistart360_user_id`,
  устанавливаемых server action. Не хранятся в JS-доступном хранилище.
- **Organization** — таблица `organizations`. Связана с User через `orgId`.
  Является одним из двух основных источников KPI дэшборда (наряду с `clients`).
- **PasswordResetToken** — временный токен (Prisma `VerificationToken`),
  связывающий email с одноразовой ссылкой сброса с TTL 1 час.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `grep -r "btoa\|atob" --include="*.ts" --include="*.tsx"` возвращает
  0 совпадений вне `node_modules` после завершения задач.
- **SC-002**: HTTP GET на `/dashboard`, `/client/waiting-room`, `/expert/dashboard`
  без куки возвращает статус 307 (не 200) во всех случаях.
- **SC-003**: Два разных пользователя, залогинившись поочерёдно, видят уникальные
  данные (email, имя) на странице `/settings`.
- **SC-004**: При недоступной БД любая страница дэшборда показывает `error.tsx`
  — не пустой белый экран и не дефолтный Next.js crash.
- **SC-005**: 100% директорий `app/(dashboard)/*/` содержат `loading.tsx`
  (проверяемо скриптом).
- **SC-006**: Реальное письмо сброса пароля приходит в течение 60 секунд
  после отправки формы на зарегистрированный email.
- **SC-007**: `npm run build` завершается без ошибок TypeScript и без предупреждений.

### Constitution Compliance *(mandatory — ref: .specify/memory/constitution.md)*

- **CC-001** (Code Quality): Нет `btoa`/`atob`; нет `any` без `// TODO(type):`
  аннотации; все новые файлы проходят `tsc --noEmit`.
- **CC-002** (Testing): Интеграционные тесты для login/logout/RBAC против реальной БД
  через Prisma `$transaction` rollback; БД не мокается.
- **CC-003** (UX): Все маршруты `(dashboard)/` имеют `error.tsx` + `loading.tsx`;
  `/settings` показывает реальные данные пользователя без хардкода.
- **CC-004** (Performance): KPI дэшборда загружаются в Server Component, не
  через `useEffect` на клиенте.
- **CC-005** (Security): Пароли только bcrypt; сессии только в HTTP-only cookie (TTL 7 дней);
  `SUPABASE_SERVICE_ROLE_KEY` только server-side; Zod-валидация на всех формах.

---

## Clarifications

### Session 2026-03-30

- Q: Из каких таблиц/моделей берутся KPI для Dashboard? → A: `clients` + `organizations` + `gri_reports` (количество клиентов, организаций, средний GRI-балл из `gri_reports.overallScore`)
- Q: Стратегия тестовой БД? → A: Транзакционный rollback через Prisma `$transaction` — отдельный Supabase проект не нужен
- Q: TTL сессионной HTTP-only cookie? → A: 7 дней (`maxAge: 604800`) — стандарт B2B SaaS

---

## Assumptions

- Supabase проект `tpxwrwxpdcwmiynjjquy` (EU-West-1) остаётся неизменным —
  миграция на другой проект не требуется.
- Auth-слой остаётся на Prisma + Server Actions + bcrypt. Переход на
  `@supabase/ssr` / Supabase Auth не входит в scope этого спринта.
- `supabase-client.ts` используется только для прямых запросов к данным,
  не для аутентификации.
- Email-сервис для сброса пароля — Resend (пакет `resend` уже в `package.json`).
- Для тестов используется транзакционный rollback через Prisma (`$transaction`) —
  тесты выполняются внутри транзакции, которая откатывается после каждого теста.
  Отдельный Supabase проект для тестов не требуется.
- Skeleton-заглушки в `loading.tsx` не обязаны быть pixel-perfect — достаточно
  структурного соответствия (заголовок + блок контента + анимация pulse).
- Роль `super_admin` и маршрут `/admin-giga-panel` выведены из scope —
  они уже работают корректно.
- Приложение деплоится на Vercel; переменные окружения уже настроены в Dashboard.
