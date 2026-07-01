# ТЗ — Переработка разделов «Настройки», «Профиль», «Уведомления» + новый «Журнал действий»

**Продукт:** AIStart360 (B2B клиентский портал) · **Дата:** 2026-07-01 · **Роль-цель:** `client` (клиентский кабинет; owner/expert/admin — отдельные варианты, отмечены где важно)
**Стек (факт):** Next.js 14.2 App Router · React 18.3 · **Supabase** (auth + таблица `profiles`/`companies` + Realtime) · **Prisma 5** (Notification/ActivityLog/AuditLog/Company/Organization/User/Subscription) · Zustand · @tanstack/react-query (+persist) · **next-themes** · Tailwind + Radix · Sonner (toasts) · framer-motion · Upstash rate-limit (+in-memory fallback) · Inngest (jobs) · OpenRouter (AI)
**Дизайн-система:** тёмная glassmorphism, teal `#6effc0`, Material Symbols (иконки-лигатуры), шрифты Bricolage/DM Sans/Space Grotesk/JetBrains Mono через `--font-*`, MD3-токены (`surface-container`, `on-surface`, `outline-variant`…).

> **Легенда:** `[ЕСТЬ]` — уже в коде, переиспользуем · `[ДЕКОР]` — сейчас декоративно/не работает · `[НОВОЕ]` — создать · `Предположение` — продуктовое/техническое допущение (уточнить).
> Все находки текущего состояния — из аудита кодовой базы (`file:line`).

---

## 1. Краткое резюме

**Что есть сейчас (проверено по коду):**
- **Настройки** (`app/(dashboard)/settings/page.tsx`) — **чистый визуальный макет: 0 из 7 табов работают.** Server-компонент без интерактива: навигация без обработчиков и роутинга (активен только «Профиль»), Безопасность/Команда/Биллинг/API&Интеграции **не рендерят ничего**, инпуты `defaultValue` (uncontrolled), кнопка «Сохранить» **без `onClick`** (`:176-183`), 4 тумблера уведомлений — статичные `<div>` с хардкод-булевыми (`:150-155`).
- **Профиль** (`app/(dashboard)/profile/page.tsx`) — **полностью read-only**, двойной источник (Prisma staff-путь / Supabase REST service-role), без формы редактирования.
- **Уведомления** (`app/(dashboard)/notifications/page.tsx`) — **читает не ту таблицу**: `prisma.auditLog` (глобальные админ-действия), а не пользовательские `notification`. Рабочий `GET /api/notifications` (`route.ts:15`) **никто не вызывает**. Бейдж-колокол в шапке (`Header.tsx:329`) висит на пустом `notifications.store` → **всегда 0**. Продюсер `Notification` ровно один (`app/actions/diagnostics.ts:90`).
- **Журнал действий** — **не существует**. Модель `ActivityLog` есть, но **на 100% мёртвая** (ноль чтений/записей). `AuditLog` (админ-действия) — живой, писать в него продолжают 17 мест через `lib/audit.ts`.

**Какой должна стать логика:** превратить 4 раздела из декора в рабочие центры управления. Настройки — сервер-оболочка + клиентские табы с реальным сохранением в `profiles`/`companies`/новые таблицы; Профиль — просмотр+редактирование с валидацией и записью в журнал; Уведомления — единый пользовательский in-app-фид с realtime-колоколом, фильтрами и настройками каналов; Журнал действий — новый read-only аудит клиентских событий поверх `ActivityLog` с фильтрами/экспортом. Каждое важное действие → запись в журнал; критические → уведомление + подтверждение; обновление данных без перезагрузки страницы.

**Ядро переиспользования (не изобретать заново):** `useRealtimeSync` + `lib/realtime/*` (зрелый стек), `lib/audit.ts logAudit()` (шаблон для `logActivity`), `PATCH /api/expert/profile` (шаблон записи в `profiles`), `GET /api/notifications` + `read-all`, колонки `profiles`(`avatar_url/organization/position/phone/branding`) и `companies`, `next-themes`, Prisma `Subscription/PaymentTransaction`, wired-интеграции Bitrix24/AmoCRM (`/api/crm`).

---

## 2. Карта разделов

```text
Настройки (/settings?tab=…)
├── Профиль аккаунта      [ДЕКОР→переписать]  profiles + auth
├── Компания              [НОВОЕ таб]         companies (реюз onboarding/company)
├── Безопасность          [НОВОЕ]             пароль, 2FA(Предп.), сессии(Предп.), история входов
├── Уведомления           [ДЕКОР→переписать]  notification_settings [НОВОЕ]
├── Внешний вид           [НОВОЕ]             next-themes + profiles.preferences [НОВОЕ jsonb]
├── Команда               [НОВОЕ]             company_members [НОВОЕ] (Предп.)
├── Биллинг               [ЗАГЛУШКА]          Subscription/PaymentTransaction (реюз, read-only)
└── API & Интеграции      [ЧАСТ.]             CrmIntegration [ЕСТЬ] + integration_connections [НОВОЕ]

Профиль (/profile)
├── Основная карточка     [ЕСТЬ read-only]
├── Личная информация     [НОВОЕ edit]
├── Контакты и соцсети    [НОВОЕ]  profiles.socials [НОВОЕ jsonb]
├── Компания              [НОВОЕ]  companies
├── Активность            [НОВОЕ]  агрегаты (диагностики/отчёты/анкета)
└── Последние действия    [НОВОЕ]  ActivityLog (последние 5)

Уведомления (/notifications)
├── Все · Непрочитанные · Критические   (табы-фильтры)
├── Системные · Безопасность · Интеграции · Отчёты (категории)
└── Архив
   источник: notification (Prisma) + realtime

Журнал действий (/activity)   [НОВЫЙ РАЗДЕЛ]
├── Все события
├── Безопасность · Профиль · Настройки · Интеграции · Команда · Системные
   источник: ActivityLog (client-scoped), read-only, CSV-экспорт
```

`Предположение`: у роли `client` табы «Команда» и «Биллинг» показываются, но управление ограничено тарифом; для одиночного клиента без под-пользователей «Команда» = он сам + приглашения (заглушка-flow).

---

## 3. Полный список экранов и компонентов

| Раздел | Экран / компонент | Назначение | Данные | Действия | Состояния |
|---|---|---|---|---|---|
| Общее | `SettingsShell` (server) + `SettingsClient` (client) | Оболочка + табы (`?tab=`) | активный таб | смена таба (роутинг) | — |
| Настройки | `SettingsProfileTab` | Ред. личных данных | profiles: full_name, position, organization, phone, email | edit/save/cancel | loading/saving/error/success/dirty |
| Настройки | `AvatarUploader` | Загрузка аватара | Supabase Storage bucket `avatars` [НОВОЕ] + `profiles.avatar_url` | выбрать/загрузить/удалить | uploading/progress/error/preview |
| Настройки | `SettingsCompanyTab` | Данные компании | companies: name, industry, stage, size, regions[], contact_* | edit/save | как профиль |
| Настройки | `SettingsSecurityTab` | Пароль/2FA/сессии | auth + `user_sessions` [НОВОЕ] | смена пароля, 2FA toggle, завершить сессию/все | confirm-modal, error |
| Настройки | `SecuritySessionsList` | Активные сессии/устройства | user_sessions | terminate, terminate-all | empty/loading |
| Настройки | `SettingsNotificationsTab` | Настройки каналов | notification_settings [НОВОЕ] | toggle per (category×channel), тихие часы, частота дайджеста | optimistic toggle, saving |
| Настройки | `SettingsAppearanceTab` | Тема/плотность/шрифт | next-themes + profiles.preferences [НОВОЕ] | тема, плотность, размер шрифта, формат даты/чисел, стартовая страница | instant apply + persist |
| Настройки | `SettingsTeamTab` + `InviteMemberModal` | Команда | company_members [НОВОЕ] | пригласить, роль, удалить, повторить инвайт | empty/limit-reached |
| Настройки | `SettingsBillingTab` | Тариф/лимиты | Subscription + PaymentTransaction (реюз) | «Управлять» (stub→checkout) | stub-notice |
| Настройки | `IntegrationsGrid` + `IntegrationCard` | Интеграции | CrmIntegration [ЕСТЬ] + integration_connections [НОВОЕ] | подключить/настроить/отключить/синхр. | статусные бейджи, error, last-sync |
| Настройки | `ApiKeysPanel` | API-ключи | api_keys [НОВОЕ] | создать/показать-раз/отозвать | copy-once, revoke-confirm |
| Профиль | `ProfileHero` | Карточка пользователя | profiles + агрегаты | «Редактировать» → Настройки | read |
| Профиль | `ProfilePersonalInfo` | Личная информация | profiles | inline edit | dirty/save |
| Профиль | `ProfileSocials` | Соцсети | profiles.socials [НОВОЕ jsonb] | edit + валидация URL | invalid-url |
| Профиль | `ProfileActivityStats` | Активность | агрегаты (diagnostics/reports/survey) | — | loading/empty |
| Профиль | `ProfileRecentActivity` | Последние действия | ActivityLog(take:5) | «Весь журнал» → /activity | empty |
| Уведомления | `NotificationsPage` (client) | Список фида | notification | mark-read, mark-all, archive, delete, filter | loading/empty/error |
| Уведомления | `NotificationItem` | Запись | notification | click→link, read, archive | read/unread |
| Уведомления | `NotificationBell` (в Header) | Колокол+счётчик | notification (unread) + realtime | открыть, live-update | badge 0..99+ |
| Уведомления | `NotificationsFilters` | Табы/фильтры | — | по типу/статусу/приоритету, поиск | — |
| Журнал | `ActivityLogPage` (client) | Таблица событий | ActivityLog | фильтр/сортировка/пагинация/экспорт | loading/empty/error |
| Журнал | `ActivityLogRow` + `ActivityDetailDrawer` | Строка+детали | ActivityLog(+metadata before/after) | открыть детали | — |
| Общее | `ConfirmDialog`, `SaveBar` (sticky «есть несохранённые изменения»), `EmptyState`, `TabSkeleton`, `ErrorState`, `Toggle`(рабочий) | Переиспользуемые | — | — | все UX-состояния |

---

## 4. Полный список рабочих действий

| ID | Действие | Где | Что делает | API | Loading | Success | Error | Журнал | Уведомл. |
|---|---|---|---|---|---|---|---|---|---|
| A1 | Сохранить профиль | Настройки·Профиль / Профиль | Пишет full_name/position/organization/phone | `PATCH /api/v1/settings/profile` | btn spinner + disabled | toast «Сохранено» | inline field errors | `profile.updated` | нет |
| A2 | Сменить email | Настройки·Профиль | `supabase.auth.updateUser({email})` + подтверждение | `POST /api/v1/settings/email` | btn | «Письмо отправлено» | 422 занят/невалид | `security.email_change_requested` | да (security) |
| A3 | Загрузить аватар | Настройки·Профиль | Upload→Storage, пишет avatar_url | `POST /api/v1/settings/avatar` | progress % | превью+toast | тип/размер | `profile.avatar_changed` | нет |
| A4 | Сохранить компанию | Настройки·Компания | Upsert companies (свой user_id) | `PUT /api/v1/settings/company` (реюз onboarding/company) | btn | toast | validation | `company.updated` | нет |
| A5 | Сменить пароль | Настройки·Безопасн. | `auth.updateUser({password})` (требует текущий) | `POST /api/v1/settings/password` | btn | toast+relogin-hint | слабый/неверный | `security.password_changed` | да (critical) |
| A6 | Вкл/выкл 2FA | Настройки·Безопасн. | `Предположение` TOTP через Supabase MFA | `POST /api/v1/settings/2fa` | modal | QR/verify | invalid code | `security.2fa_enabled/disabled` | да (critical) |
| A7 | Завершить сессию | Настройки·Безопасн. | Удаляет сессию/устройство | `DELETE /api/v1/settings/sessions/[id]` | row spinner | список обновлён | 404 | `security.session_revoked` | да |
| A8 | Завершить все сессии | Настройки·Безопасн. | `auth.signOut({scope:'global'})` | `POST /api/v1/settings/sessions/revoke-all` | confirm→btn | редирект на /login | — | `security.all_sessions_revoked` | да (critical) |
| A9 | Переключить уведомление | Настройки·Уведомл. | Пишет notification_settings(category,channel) | `PATCH /api/v1/settings/notifications` | optimistic toggle | тихо | rollback+toast | `settings.notifications_changed` | нет |
| A10 | Сменить тему/вид | Настройки·Внешний вид | next-themes + persist preferences | `PATCH /api/v1/settings/preferences` | instant | — | — | `settings.appearance_changed` | нет |
| A11 | Пригласить в команду | Настройки·Команда | Создаёт invite (company_members) | `POST /api/v1/settings/team/invite` | btn | «Приглашение отправлено» | лимит тарифа/дубль | `team.member_invited` | да (team) |
| A12 | Изменить роль/удалить участника | Настройки·Команда | Обновляет/удаляет membership | `PATCH/DELETE /api/v1/settings/team/[id]` | row | обновлено | 403 | `team.role_changed/member_removed` | да (team) |
| A13 | Подключить интеграцию (CRM) | Настройки·Интегр. | Тест+сохранение creds | `POST /api/crm` [ЕСТЬ] | btn «Проверка…» | «Подключено» | connection_failed | `integration.connected` | да (integration) |
| A14 | Синхронизировать | Настройки·Интегр. | provider.syncAll | `POST /api/crm/sync` [ЕСТЬ] | «Синхр…» | счётчики сделок | sync_error | `integration.synced` | да если ошибка |
| A15 | Отключить интеграцию | Настройки·Интегр. | Удаляет connection | `DELETE /api/crm` [ЕСТЬ] | confirm | карточка→Доступно | — | `integration.disconnected` | да |
| A16 | Создать/отозвать API-ключ | Настройки·Интегр. | Генерит/ревокает ключ | `POST/DELETE /api/v1/settings/api-keys` | btn | ключ (показать раз) | — | `apikey.created/revoked` | да (critical) |
| A17 | Отметить уведомление прочитанным | Уведомления | `notification.update(isRead)` | `PATCH /api/notifications/[id]/read` [НОВОЕ] | optimistic | badge−1 | rollback | нет | нет |
| A18 | Прочитать все | Уведомления | updateMany isRead | `PATCH /api/notifications/read-all` [ЕСТЬ] | btn | badge=0 | rollback | нет | нет |
| A19 | Архивировать/удалить уведомление | Уведомления | archivedAt / delete | `PATCH/DELETE /api/notifications/[id]` [НОВОЕ] | swipe/row | из списка | rollback | нет | нет |
| A20 | Экспорт журнала CSV | Журнал | Стримит CSV по фильтру | `GET /api/v1/activity/export?…` | «Готовим…» | download | 413 too-large→сузить | нет | нет |

Все действия: защита от двойного клика (`disabled` во время in-flight + идемпотентность на бэке), toast-подтверждение, обновление данных на экране без перезагрузки (react-query invalidate / optimistic).

---

## 5. Модели данных

**Существующие — переиспользуем как есть** (`[ЕСТЬ]`): `profiles`, `companies`, `Notification`, `ActivityLog`, `AuditLog`, `CrmIntegration`, `Subscription`, `PaymentTransaction`.

**Правки существующих моделей:**

```ts
// profiles [ЕСТЬ] — добавить колонки (миграция)
type Profile = {
  id: string; email: string; full_name: string | null;
  role: 'super_admin'|'admin'|'manager'|'analyst'|'client'|'expert'|'owner';
  status: 'pending_approval'|'approved'|'rejected'|'requires_clarification';
  avatar_url: string | null; organization: string | null; position: string | null; phone: string | null;
  branding: { logo_url?: string; primary_color?: string; secondary_color?: string; product_name?: string } | null; // [ЕСТЬ]
  // [НОВОЕ]:
  preferences: {                    // внешний вид + локаль
    theme?: 'dark'|'light'|'system'; density?: 'compact'|'comfortable';
    font_scale?: number; date_format?: string; number_format?: string;
    locale?: 'ru'|'en'; timezone?: string; start_page?: string;
    reduce_motion?: boolean; high_contrast?: boolean;
  } | null;
  socials: { telegram?: string; whatsapp?: string; linkedin?: string; instagram?: string; facebook?: string; vk?: string; website?: string; work_phone?: string; secondary_email?: string } | null;
  created_at: string; updated_at: string;
};

// Notification [ЕСТЬ] — расширить (миграция): добавить link, actorId, metadata, readAt, archivedAt, category
type Notification = {
  id: string; userId: string;
  type: 'gri_updated'|'report'|'alert'|'project'|'team'|'system'   // [ЕСТЬ] enum — ЛИБО расширить,
       ; category: 'system'|'security'|'profile'|'settings'|'team'|'integration'|'report'|'diagnostic'|'billing'|'error'|'success'|'info'; // [НОВОЕ] гибкая категория (снимает несоответствие enum↔продюсеры)
  priority: 'critical'|'high'|'medium'|'low';
  title: string; body: string; isRead: boolean;
  entityType: string | null; entityId: string | null;
  link: string | null;         // [НОВОЕ] куда вести по клику
  actorId: string | null;      // [НОВОЕ] кто вызвал событие
  metadata: Json;              // [НОВОЕ]
  readAt: string | null; archivedAt: string | null; // [НОВОЕ]
  createdAt: string;
};

// ActivityLog [ЕСТЬ, но пустая] — журнал КЛИЕНТА. Добавить severity/ip/ua/status
type ActivityLog = {
  id: string; userId: string; clientId: string | null;
  action: string;            // 'profile.updated' | 'security.password_changed' | …
  entityType: string; entityId: string;
  description: string | null;         // [НОВОЕ] человекочитаемо
  metadata: Json;            // { before?, after?, ... }  (before/after хранить здесь)
  severity: 'info'|'warning'|'critical'; // [НОВОЕ]
  status: 'success'|'failure'; // [НОВОЕ]
  source: 'web'|'api'|'system'; // [НОВОЕ]
  ipAddress: string | null; userAgent: string | null; // [НОВОЕ]
  createdAt: string;
};
```

**Новые таблицы** (`[НОВОЕ]`):

```ts
type NotificationSetting = { // одна строка на (user × category)
  id: string; userId: string;
  category: Notification['category'];
  inApp: boolean; email: boolean; push: boolean; telegram: boolean;
  updatedAt: string;
  // @@unique([userId, category])
};

type UserSession = { // «активные сессии/устройства» (Supabase не даёт список из коробки)
  id: string; userId: string;
  device: string | null; browser: string | null; os: string | null;
  ipAddress: string | null; location: string | null;
  trusted: boolean; lastSeenAt: string; createdAt: string;
  // писать при логине (hook), чистить по TTL
};

type CompanyMember = { // «Команда» клиента (Предположение)
  id: string; companyId: string; userId: string | null; email: string;
  role: 'owner'|'admin'|'manager'|'analyst'|'viewer';
  status: 'invited'|'active'|'removed';
  invitedBy: string; invitedAt: string; joinedAt: string | null;
  // @@unique([companyId, email])
};

type ApiKey = { // выдача ключей (greenfield)
  id: string; userId: string; name: string;
  prefix: string; hashedKey: string; // хранить только hash
  scopes: string[]; lastUsedAt: string | null;
  createdAt: string; revokedAt: string | null;
};

type IntegrationConnection = { // generic — для не-CRM интеграций (Telegram/Sheets/Notion/…)
  id: string; userId: string; orgId: string | null;
  provider: 'telegram'|'whatsapp'|'google_sheets'|'google_drive'|'notion'|'slack'|'webhook'|'ozon'|'wildberries';
  status: 'available'|'coming_soon'|'connected'|'error'|'needs_setup';
  config: Json; lastSyncAt: string | null; lastError: string | null;
  createdAt: string; updatedAt: string;
  // @@unique([userId, provider])
};
```

Индексы: `notification(userId, isRead, archivedAt)`, `notification(userId, createdAt)`, `activity_log(userId, createdAt)`+`(clientId, createdAt)` [ЕСТЬ], `notification_setting @@unique(userId,category)`, `user_session(userId, lastSeenAt)`, `api_key(prefix)`, `company_member @@unique(companyId,email)`. Soft-delete: `notification.archivedAt`, `api_key.revokedAt`, `company_member.status`. `activity_log`/`audit_log` — **иммутабельные** (только INSERT/SELECT, без UPDATE/DELETE на уровне RLS).

---

## 6. API-контракты

Все `/api/v1/settings/*` — **auth-scoped на себя** (никогда не принимают чужой userId из тела; берут из сессии). Реюз паттерна `PATCH /api/expert/profile` (`route.ts:27-74`), но без role-gate и с self-scope.

```txt
GET  /api/v1/settings/profile        → { full_name, email, position, organization, phone, avatar_url, socials, preferences }
PATCH /api/v1/settings/profile       body: {full_name?, position?, organization?, phone?, socials?}
  200 {ok:true, data} · 401 · 422 {field errors} · side-effects: ActivityLog `profile.updated`
POST /api/v1/settings/avatar         multipart file → Storage bucket `avatars/{userId}` → profiles.avatar_url
  200 {url} · 413 (>2MB) · 415 (type) · side-effects: ActivityLog `profile.avatar_changed`
POST /api/v1/settings/email          body:{email} → auth.updateUser → confirm-mail. side-effects: ActivityLog+Notification(security)
POST /api/v1/settings/password       body:{current,new} → auth.updateUser. 422 weak/wrong. side-effects: ActivityLog+Notification(critical)
GET  /api/v1/settings/sessions       → UserSession[]
DELETE /api/v1/settings/sessions/[id]· POST /api/v1/settings/sessions/revoke-all (auth.signOut scope:global)
GET  /api/v1/settings/notifications  → NotificationSetting[]
PATCH /api/v1/settings/notifications body:{category, channel, enabled} → upsert. side-effects: ActivityLog
PATCH /api/v1/settings/preferences   body: Profile['preferences'] (partial). side-effects: ActivityLog `settings.appearance_changed`
PUT  /api/v1/settings/company        (реюз POST /api/v1/onboarding/company) → companies upsert. side-effects: ActivityLog `company.updated`
GET/POST/PATCH/DELETE /api/v1/settings/team[/…]   company_members CRUD + invite. side-effects: ActivityLog + Notification(team)
GET  /api/v1/billing                 → { tier, status, currentPeriodEnd, limits, transactions[] } (read-only, stub checkout link)
GET/POST/DELETE /api/crm             [ЕСТЬ] · POST /api/crm/sync [ЕСТЬ]
GET/POST/DELETE /api/v1/settings/integrations[/…]  integration_connections (не-CRM)
POST/DELETE /api/v1/settings/api-keys              выдача/отзыв (ключ отдаётся один раз)

# Уведомления
GET  /api/notifications              [ЕСТЬ] → notification[] (userId). Добавить ?filter=unread|category&cursor=
PATCH /api/notifications/[id]/read   [НОВОЕ] · PATCH /api/notifications/read-all [ЕСТЬ]
PATCH /api/notifications/[id]        [НОВОЕ] archive · DELETE /api/notifications/[id] [НОВОЕ]
GET  /api/notifications/unread-count [НОВОЕ] → {count} (для колокола до realtime)

# Журнал действий
GET  /api/v1/activity                [НОВОЕ] → ActivityLog[] (self/clientId), фильтры date/action/severity, cursor-пагинация
GET  /api/v1/activity/[id]           [НОВОЕ] → деталь (before/after)
GET  /api/v1/activity/export         [НОВОЕ] → text/csv (по фильтру)
```

**Для каждого endpoint (общее):** метод+URL выше; request/response — JSON `{ok, data|error}`; ошибки — корректные коды (400/401/403/404/409/422/429/500, не «200 на ошибке»); права — self-scope + проверка роли для team/billing; **side-effects** — какие ActivityLog-события и какие Notification создаются (колонки «Журнал»/«Уведомл.» в §4); rate-limit на мутирующих (реюз `isRateLimited`).

---

## 7. Логика уведомлений

**Единый продюсер `[НОВОЕ]` `createNotification({userId, category, priority, title, body, link?, actorId?, entityType?, entityId?, metadata?})`** — зеркало `logAudit` (`lib/audit.ts:41`). Вставляет строку в `notification` **и** (по настройкам пользователя из `notification_settings`) вызывает существующие каналы `notifyUser`/email/telegram (`lib/notifications.ts`). Снимает главный разрыв: сейчас `notifyAdmins` шлёт письма, но **не пишет in-app строку**.

- **Что создаёт уведомление (in-app + каналы по настройкам):** загрузка/готовность отчёта, завершение диагностики (`gri_updated` [ЕСТЬ продюсер]), обработка документов завершена, изменения в команде (инвайт/роль), подключение/ошибка интеграции, события безопасности (смена пароля/2FA/новый вход), биллинг (списание/смена тарифа), критические системные.
- **Что только пишется в журнал (без уведомления):** смена темы, сохранение профиля/компании (обычное), переключение настроек уведомлений, обычные просмотры.
- **Критические уведомления** (`priority:'critical'`, всегда игнорируют «тихие часы»): смена пароля, вкл/выкл 2FA, завершение всех сессий, новый вход с нового устройства, создание/отзыв API-ключа, ошибка биллинга.
- **Счётчик непрочитанных:** `NotificationBell` (в `Header.tsx`) хайдрит `unreadCount` из `GET /api/notifications/unread-count` на маунте, затем **realtime** (§ниже) инкрементит/декрементит; «Прочитать все» → `PATCH /api/notifications/read-all` (сейчас кнопка — no-op, `page.tsx:59`). Бейдж `0..99+`.
- **Realtime:** миграция — добавить `notifications` в publication `supabase_realtime` + `REPLICA IDENTITY FULL`; расширить `WatchedTable` (`lib/realtime/channels.ts:11`); новый хук `useRealtimeNotifications` по образцу `hooks/useRealtimePointA.ts:42` (инвалидирует ключ `['notifications']` + инкремент счётчика на INSERT). Fallback до realtime — polling `unread-count` раз в 30–60 c с in-flight-guard.
- **Архив/удаление:** `archive` = проставить `archivedAt` (скрыть из «Все/Непрочитанные», показать в «Архив»); `delete` = физическое удаление (или soft, по политике). Оба — optimistic с rollback.
- **Группировка по датам:** «Сегодня / Вчера / На этой неделе / Ранее» на клиенте по `createdAt` в таймзоне пользователя (`preferences.timezone`).
- **Переход по клику:** `notification.link` → `router.push`; при этом отметить прочитанным.
- **Enum-развязка:** ввести `category TEXT` рядом с `type` (продюсеры используют `file_uploaded/survey_completed/expert_case_created`, а enum их не знает — `schema.prisma:51`), чтобы не мигрировать enum на каждый новый тип.

---

## 8. Логика журнала действий

**Отдельный от `AuditLog`.** `AuditLog` = действия админа/эксперта (уже пишется, `lib/audit.ts`, читается `/api/admin/audit`). **`ActivityLog` = журнал КЛИЕНТА** (пустой сегодня) — его и наполняем для раздела «Журнал действий» клиента.

- **Писатель `[НОВОЕ]` `logActivity({userId, clientId?, action, entityType, entityId, description?, metadata?, severity?, status?, source?, req?})`** — зеркало `logAudit`; из `req` достаёт `ipAddress`/`userAgent`. Вызывается на всех клиентских событиях из §4 (профиль/компания/безопасность/уведомления/внешний вид/команда/интеграции/отчёты/входы/выходы/ошибки API).
- **Логируемые события:** вход/выход/неуспешный вход, смена пароля, вкл/выкл 2FA, обновление профиля/аватара/компании, изменение настроек уведомлений/темы, подключение/отключение/ошибка интеграции, загрузка/создание отчёта, инвайт/смена роли/удаление участника, смена тарифа, ошибка API, критические системные.
- **Поля записи:** id, createdAt, `actor` = userId (+ actor_name/role join), action, entity_type, entity_id, description, `before`/`after` (в `metadata`), ip_address, user_agent, severity, status, source, metadata.
- **Кто видит:** клиент — только свои (`userId`/`clientId` через индексы `schema.prisma:316-317`) под RLS; owner/admin — журнал своей организации; super_admin — всё. Никогда не показывать чужие записи.
- **Фильтры:** дата (range), тип события, severity, поиск по description/entity; сортировка по дате; cursor-пагинация (не offset).
- **Экспорт:** `GET /api/v1/activity/export` → CSV по текущему фильтру (стрим; при слишком большом объёме — 413 с подсказкой сузить период).
- **Иммутабельность:** RLS — только `SELECT` для пользователя, `INSERT` только сервис-ролью; `UPDATE/DELETE` запрещены политикой (журнал нельзя править/чистить из приложения).
- **before/after:** в детали (`ActivityDetailDrawer`) показывать дифф `metadata.before` vs `metadata.after` (подсветка изменённых полей).

---

## 9. UX-состояния (для каждого раздела)

Единые компоненты: `TabSkeleton` (skeleton), `EmptyState` (иконка+текст+CTA), `ErrorState` (текст+«Повторить»), `SaveBar` (sticky «Есть несохранённые изменения · Сохранить/Отменить»), `ConfirmDialog` (для критических), `Toggle`(рабочий, с `aria-checked`).

| Состояние | Проявление |
|---|---|
| **loading / skeleton** | На вход в таб/страницу — skeleton карточек (не пустой экран); react-query `isLoading`. |
| **empty** | Уведомления: «События пока отсутствуют» + объяснение что появится + ссылка в Настройки·Уведомления + «Обновить». Журнал: «Пока нет действий». Команда: «Вы пока один — пригласите участника». Не выглядит сломанным. |
| **error** | Явное сообщение + «Повторить» (не маскировать под empty). Ошибки API — понятный текст, не raw. |
| **success** | Toast (Sonner) «Сохранено»; данные на экране обновлены без reload. |
| **disabled** | Кнопки действий `disabled` во время in-flight (`aria-busy`), защита от double-submit. |
| **validation** | Инлайновые ошибки полей (email/URL соцсетей/пароль); блок submit пока невалидно. |
| **unsaved changes** | `SaveBar` + `beforeunload`/route-guard подтверждение при уходе с несохранёнными. |
| **no permission** | Таб/действие скрыты или заблокированы по роли/тарифу с подсказкой «Недоступно на вашем тарифе». |

Тёмная тема — обязательна (все токены уже тёмные). Доступность: `aria-label` на иконочных кнопках, focus-ring, keyboard-nav по табам (роль `tablist`/`tab`), контраст ≥ WCAG AA, `role="dialog"` + focus-trap в модалках.

---

## 10. Заглушки для будущих интеграций

| Интеграция | Статус сейчас | Что будет делать | Что показать сейчас | Кнопка | Будущий API |
|---|---|---|---|---|---|
| Bitrix24 | **Connected/Available [ЕСТЬ]** | Синк сделок/контактов | Реальная карточка + last-sync + счётчики | Подключить/Синхр./Отключить | `/api/crm` [ЕСТЬ] |
| AmoCRM | **Connected/Available [ЕСТЬ]** | То же | То же | То же | `/api/crm` [ЕСТЬ] |
| Telegram (клиенту) | **Скоро** (адаптер есть, env-gated) | Уведомления в TG клиенту | Карточка «Скоро» + пpreview пользы | «Уведомить меня» (disabled) | `/api/v1/settings/integrations/telegram` |
| WhatsApp | **Скоро** (адаптер есть) | Уведомления в WA | «Скоро» | disabled | — |
| Google Sheets | **Доступно (stub)** | Экспорт метрик/базы | Карточка + список доступов + placeholder-flow | «Подключить» → modal-заглушка | OAuth (позже) |
| Google Drive | **Скоро** | Хранение отчётов | «Скоро» | disabled | — |
| Notion | **Скоро** | Синк заметок/отчётов | «Скоро» | disabled | — |
| Slack | **Скоро** | Алерты в канал | «Скоро» | disabled | — |
| Webhooks | **Требуется настройка (stub)** | Исходящие вебхуки на события | Поле URL + список событий + тест (заглушка) | «Сохранить» (stub) | `integration_connections` |
| API keys | **Доступно [НОВОЕ]** | Доступ к API портала | Панель ключей | «Создать ключ» | `/api/v1/settings/api-keys` |
| Ozon / Wildberries | **Скоро** | Импорт продаж | «Скоро» + польза | disabled | — |

Карточка интеграции (единый вид): иконка · название · статус-бейдж (`Доступно`/`Скоро`/`Подключено`/`Ошибка`/`Требуется настройка`) · описание пользы · список требуемых доступов · дата последней синхронизации · лог синхронизации (для wired) · кнопка действия · обработка ошибок · отключение. Заглушки выглядят как полноценные карточки, а не «сломанные».

---

## 11. Пошаговый план реализации

**Этап 0 — фундамент (0.5–1 д):** миграции (`profiles.preferences/socials`, расширение `Notification`, поля `ActivityLog`, новые таблицы `notification_settings/user_sessions/company_members/api_keys/integration_connections`, Storage-bucket `avatars`, `notifications`→realtime-publication); RLS-политики (self-scope, иммутабельность журналов); хелперы `createNotification()` и `logActivity()`.

**Этап 1 — оболочка и навигация (0.5 д):** `SettingsShell`(server)+`SettingsClient`(client) с рабочими табами (`?tab=`), lazy-загрузка панелей табов (`next/dynamic`), `SaveBar`/`ConfirmDialog`/`EmptyState`/`ErrorState`/`Toggle`.

**Этап 2 — Профиль и настройки (2–3 д):** таб Профиль (edit+save, A1), Аватар (A3), Компания (A4, реюз onboarding/company), Внешний вид (A10, next-themes + preferences), Уведомления-настройки (A9, notification_settings), Профиль-страница (просмотр+инлайн-редакт+соцсети+активность+последние действия).

**Этап 3 — Уведомления (1–2 д):** переписать `notifications/page.tsx` на пользовательский `notification`-фид; `NotificationBell` с хайдратом счётчика; фильтры/группировка/архив/удаление (A17–A19); `createNotification` в ~20 продюсер-сайтах; realtime-хук.

**Этап 4 — Журнал действий (1–2 д):** `logActivity` в клиентских событиях; `/activity` (таблица+фильтры+пагинация+деталь+CSV); блок «Последние действия» в Профиле.

**Этап 5 — Интеграции и заглушки (1–2 д):** `IntegrationsGrid` — реальные CRM (реюз `/api/crm`) + качественные заглушки; `ApiKeysPanel`; generic `integration_connections`.

**Этап 6 — Безопасность и роли (1–2 д):** смена пароля (A5), сессии/устройства (A7–A8), 2FA (A6, `Предположение`), Команда (A11–A12), RLS/role-gates, «тихие часы».

**Этап 7 — QA и стабилизация (1 д):** чек-лист §14, e2e основных потоков, проверка realtime, ролей, пустых/ошибочных состояний, mobile.

---

## 12. Frontend-рекомендации (под стек проекта)

- **Компоненты:** `SettingsShell`(RSC) + `SettingsClient`(тонкий клиент с табами) + панель-на-таб (`next/dynamic`, ssr:false) — чтобы не тащить всё в один бандл (учёт находки аудита про гигантские `'use client'`).
- **Состояние/данные:** react-query для всех чтений (единые ключи `['settings','profile']`, `['notifications']`, `['activity',filters]`) — дедуп/кэш/persist уже настроены (`app/providers.tsx`). Мутации — `useMutation` + `onMutate` optimistic + `invalidateQueries`/rollback.
- **Формы:** `react-hook-form` + `zod` (уже в проекте) — контролируемые инпуты (уйти от `defaultValue`), инлайн-валидация, `isDirty` для `SaveBar`, `isSubmitting` для disabled.
- **Двойной клик/двойной submit:** `disabled={isPending}` + идемпотентные мутации; `keepPreviousData` для списков.
- **Realtime:** `useRealtimeNotifications` поверх `useRealtimeSync` (не изобретать канал вручную).
- **Toaster:** единый Sonner из `app/layout.tsx` (не плодить локальные — см. находку аудита о дублях).
- **Тема/вид:** `next-themes` мгновенно + debounce-persist в `preferences`; смонтировать `ThemeSwitcher` (сейчас определён, но нигде не подключён).
- **Аватар:** превью до загрузки, прогресс, клиент-сайд валидация типа/размера (≤2MB) до отправки.
- **Accessibility/mobile:** `role=tablist/tab`, focus-trap в модалках, нижняя навигация уже адаптивна; журнал на мобиле — карточный режим (как уже сделано для «Аудит базы»).

## 13. Backend-рекомендации

- **Архитектура:** тонкие route-handlers → сервисы (`lib/settings/*`, `lib/notifications/create.ts`, `lib/activity/log.ts`). Валидация zod на входе, self-scope из сессии (`getAdminSession`, уже обёрнут в `cache()`).
- **Audit/activity logging:** `logActivity()` вызывать в сервисах, не в компонентах; из `Request` доставать ip/ua; никогда не логировать секреты (пароли/ключи — только факт события).
- **Notification service:** `createNotification()` — единственная точка создания in-app + разветвление на каналы по `notification_settings`; каналы уже есть (`lib/notifications.ts`).
- **Integration service:** реюз `lib/crm/*`; generic-коннекторы через `integration_connections`; входящий webhook-receiver и выдача API-ключей — новые (`api_keys` хранить только hash, показывать ключ один раз).
- **Realtime gateway:** миграция publication + `REPLICA IDENTITY FULL` на `notifications`.
- **Очереди:** тяжёлое (рассылки, экспорт больших журналов) — через Inngest (уже в проекте), не в request-хендлере.
- **БД:** индексы из §5; журналы иммутабельны на уровне RLS; `updated_at`-триггеры (паттерн `profiles_updated_at` уже есть).
- **Ошибки/статусы:** корректные коды, единый формат `{ok,error}`, rate-limit на мутациях, без утечки внутренних ошибок клиенту.

---

## 14. QA-чеклист

- [ ] Настройки: каждый из 7 табов **переключается и рендерит свою панель** (не пусто).
- [ ] Профиль открывается; данные грузятся; редактирование сохраняется; ошибки валидации видны.
- [ ] Аватар: загрузка, превью, лимит 2MB/тип, обновление на экране.
- [ ] Настройки уведомлений: тумблеры **реально переключаются и сохраняются** (перезаход — состояние сохранено).
- [ ] Тема меняется мгновенно и переживает перезаход (persist).
- [ ] Компания сохраняется (companies upsert), без затрагивания чужих.
- [ ] Смена пароля/email/2FA: подтверждение, корректные ошибки, запись в журнал + уведомление.
- [ ] Сессии: список, завершить одну/все, «все» — редирект на /login.
- [ ] Уведомления: страница показывает **пользовательские** уведомления (не auditLog); отметка одного/всех прочитанными; счётчик-колокол обновляется; realtime — новое уведомление появляется без reload; архив/удаление; фильтры; пустое/loading/error состояния; переход по клику.
- [ ] Журнал: пополняется при действиях; фильтры/сортировка/пагинация; деталь before/after; экспорт CSV; иммутабельность (нельзя править).
- [ ] Интеграции: реальные CRM подключаются/синхронятся/отключаются; заглушки выглядят корректно со статус-бейджами.
- [ ] API-ключи: создание (показ один раз), отзыв.
- [ ] Команда: инвайт/роль/удаление; лимит тарифа.
- [ ] Кнопки не зависают; повторный клик не создаёт дубли; данные обновляются без перезагрузки.
- [ ] Ошибки API — понятные; **ноль ошибок в консоли**; realtime стабилен.
- [ ] Мобильная версия всех разделов; доступы по ролям соблюдаются (client/owner/admin); RLS не отдаёт чужое.

---

## 15. Backlog

| Приоритет | Задача | Раздел | Frontend | Backend | Готовность |
|---|---|---|---|---|---|
| **P0** | Оболочка Настроек + рабочие табы | Настройки | SettingsShell/Client, tab-роутинг | — | Табы переключаются, панели рендерятся |
| **P0** | Ред. профиля + сохранение | Профиль | RHF-форма, SaveBar | `PATCH /settings/profile` + logActivity | Данные сохраняются, валидация |
| **P0** | Настройки уведомлений (реальные тумблеры) | Настройки·Увед. | Toggle+optimistic | `notification_settings` + PATCH | Тумблеры сохраняются |
| **P0** | Уведомления: правильный источник + колокол | Уведомления | переписать page, NotificationBell | GET/read-all/unread-count | Фид пользователя, счётчик живой |
| **P0** | `createNotification` + инструментовка продюсеров | Уведомления | — | сервис + ~20 сайтов | In-app строки создаются |
| **P0** | RLS/self-scope/иммутабельность журналов | Все | — | политики | Чужое не отдаётся |
| **P1** | Realtime уведомлений | Уведомления | useRealtimeNotifications | миграция publication | Live без reload |
| **P1** | Журнал действий (`logActivity` + /activity) | Журнал | таблица/фильтры/деталь/CSV | logActivity + GET/export | События пишутся и видны |
| **P1** | Аватар (Storage) | Профиль | AvatarUploader | POST /settings/avatar | Загрузка+avatar_url |
| **P1** | Компания (таб) | Настройки·Комп. | форма | реюз onboarding/company | Сохранение |
| **P1** | Внешний вид (тема/вид + persist) | Настройки | смонтировать ThemeSwitcher+preferences | PATCH /settings/preferences | Persist |
| **P1** | Интеграции: CRM реальные + карточки | Настройки·Интегр. | IntegrationsGrid | реюз /api/crm | Подключение/синк/отключение |
| **P2** | Безопасность: пароль/сессии | Настройки·Безоп. | формы+список | password/sessions API + user_sessions | Работает |
| **P2** | Заглушки интеграций (Telegram/Sheets/…) | Настройки·Интегр. | IntegrationCard stubs | integration_connections | Аккуратные заглушки |
| **P2** | API-ключи | Настройки·Интегр. | ApiKeysPanel | api_keys API | Создать/отозвать |
| **P3** | Команда + инвайты | Настройки·Команда | таблица+модал | company_members API | Инвайт/роль/удаление |
| **P3** | 2FA (TOTP) | Настройки·Безоп. | QR/verify | Supabase MFA | Вкл/выкл |
| **P3** | Биллинг (read-only + stub checkout) | Настройки·Биллинг | карточка тарифа | GET /billing (реюз Subscription) | Показ тарифа/лимитов |

---

### Что прислать для точной реализации (если нужно углубить)
- Подтверждение продуктовых `Предположение`: модель «Команды» для клиента (под-пользователи компании?), нужен ли клиенту биллинг-таб сейчас, список приоритетных интеграций как «реальные» vs «заглушки», политика хранения уведомлений (архив vs жёсткое удаление), нужен ли 2FA в первом релизе.
- Дизайн-макеты (если есть) для табов Безопасность/Команда/Интеграции — сейчас их в интерфейсе нет вообще.
